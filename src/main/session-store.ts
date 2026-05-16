import { mkdir, readFile, writeFile, unlink, readdir, access, stat, rename } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'

interface SessionKey {
  sessionId: string
  branchId?: string
  subpath?: string
}

interface SessionSummary {
  sessionId: string
  title?: string
  firstPrompt?: string
  summary?: string
  customTitle?: string
  lastModified?: number
  createdAt?: number
  tag?: string
  [key: string]: unknown
}

interface BranchesData {
  active: string
  branches: Record<string, { head: string; name?: string }>
}

export class FileSessionStore {
  private baseDir: string

  private constructor(baseDir: string) {
    this.baseDir = baseDir
  }

  static async create(baseDir: string): Promise<FileSessionStore> {
    const store = new FileSessionStore(baseDir)
    await mkdir(baseDir, { recursive: true })
    return store
  }

  private entryPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.jsonl`)
  }

  private branchesPath(sessionId: string): string {
    return join(this.baseDir, `${sessionId}.branches.json`)
  }

  private async loadBranches(sessionId: string): Promise<BranchesData> {
    const p = this.branchesPath(sessionId)
    try {
      await access(p)
      const raw = await readFile(p, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return { active: 'main', branches: { main: { head: '' } } }
    }
  }

  private async saveBranches(sessionId: string, data: BranchesData): Promise<void> {
    await writeFile(this.branchesPath(sessionId), JSON.stringify(data, null, 2), 'utf-8')
  }

  private async migrateIfNeeded(sessionId: string, entries: any[]): Promise<any[]> {
    if (entries.length === 0) return entries
    if (entries[0].id) return entries

    let lastId: string | null = null
    for (const e of entries) {
      e.id = randomUUID()
      e.parentId = lastId
      lastId = e.id
    }

    const filePath = this.entryPath(sessionId)
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(filePath, lines, 'utf-8')

    const branches: BranchesData = {
      active: 'main',
      branches: { main: { head: entries[entries.length - 1].id } },
    }
    await this.saveBranches(sessionId, branches)

    return entries
  }

  private async readAllEntries(sessionId: string): Promise<any[] | null> {
    const filePath = this.entryPath(sessionId)
    let raw: string
    try {
      await access(filePath)
      raw = await readFile(filePath, 'utf-8')
    } catch {
      return null
    }

    if (!raw.trim()) return []

    const entries: any[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line))
      } catch (err) {
        console.error(`[SessionStore] Failed to parse line in ${filePath}:`, err)
      }
    }

    return this.migrateIfNeeded(sessionId, entries)
  }

  async append(key: SessionKey, entries: unknown[]): Promise<void> {
    const filePath = this.entryPath(key.sessionId)
    const branches = await this.loadBranches(key.sessionId)
    let currentParent = branches.branches[branches.active]?.head || null

    const enriched = entries.map((e: any) => {
      const id = e.id || randomUUID()
      const parentId = e.parentId !== undefined ? e.parentId : currentParent
      currentParent = id
      return { ...e, id, parentId }
    })

    const lines = enriched.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(filePath, lines, { flag: 'a', encoding: 'utf-8' })

    // Update head to last entry
    const lastEntry = enriched[enriched.length - 1]
    if (!branches.branches[branches.active]) {
      branches.branches[branches.active] = { head: '' }
    }
    branches.branches[branches.active].head = lastEntry.id
    await this.saveBranches(key.sessionId, branches)

  }

  async load(key: SessionKey): Promise<unknown[] | null> {
    const allEntries = await this.readAllEntries(key.sessionId)
    if (!allEntries) return null
    if (allEntries.length === 0) return []

    // Build id→entry index
    const byId = new Map<string, any>()
    for (const e of allEntries) {
      if (e.id) byId.set(e.id, e)
    }

    // Determine which head to walk from
    const branchId = key.branchId
    let head: string
    if (branchId) {
      const branches = await this.loadBranches(key.sessionId)
      head = branches.branches[branchId]?.head || ''
    } else {
      // Legacy: no branch file, walk the full list
      const branches = await this.loadBranches(key.sessionId)
      head = branches.branches[branches.active]?.head || ''
    }

    if (!head || !byId.has(head)) {
      // Fallback: walk entire list (legacy sessions or corrupted branches)
      return allEntries
    }

    // Walk from head back to root via parentId
    const chain: any[] = []
    let current = byId.get(head)
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      chain.push(current)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }

    chain.reverse()
    return chain
  }

  async listSessions(): Promise<{ sessionId: string; mtime: number }[]> {
    let files: string[]
    try {
      await access(this.baseDir)
      files = await readdir(this.baseDir)
    } catch {
      return []
    }

    const sessions: { sessionId: string; mtime: number }[] = []

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      const parts = file.replace('.jsonl', '').split('.')
      if (parts.length > 1) continue

      const sessionId = parts[0]
      const filePath = join(this.baseDir, file)
      const fileStat = await stat(filePath)
      sessions.push({ sessionId, mtime: fileStat.mtimeMs })
    }

    return sessions
  }

  async listSessionSummaries(): Promise<SessionSummary[]> {
    const sessions = await this.listSessions()
    const summaries: SessionSummary[] = []

    for (const { sessionId, mtime } of sessions) {
      let entries: unknown[] | null
      try {
        entries = await this.load({ sessionId })
      } catch (err) {
        console.error(`[SessionStore] Failed to load session ${sessionId}:`, err)
        continue
      }
      if (!entries) continue

      const summary: SessionSummary = {
        sessionId,
        lastModified: mtime,
        createdAt: mtime,
      }

      for (const entry of entries) {
        const e = entry as Record<string, unknown>
        if (e.type === 'user' && e.message) {
          const msg = e.message as Record<string, unknown>
          const content = msg.content
          if (typeof content === 'string') {
            summary.firstPrompt = content.slice(0, 100)
          } else if (Array.isArray(content)) {
            const textBlock = content.find((c: Record<string, unknown>) => c.type === 'text')
            if (textBlock && typeof textBlock.text === 'string') {
              summary.firstPrompt = textBlock.text.slice(0, 100)
            }
          }
          break
        }
      }

      for (const entry of entries) {
        const e = entry as Record<string, unknown>
        if (e.type === 'tag' && typeof e.tag === 'string') {
          summary.tag = e.tag
        }
      }

      summaries.push(summary)
    }

    return summaries
  }

  async delete(key: SessionKey): Promise<void> {
    const filePath = this.entryPath(key.sessionId)
    try {
      await access(filePath)
      await unlink(filePath)
    } catch { /* not found, ignore */ }

    const branchesFile = this.branchesPath(key.sessionId)
    try {
      await access(branchesFile)
      await unlink(branchesFile)
    } catch { /* not found, ignore */ }

  }

  async replace(key: SessionKey, entries: unknown[]): Promise<void> {
    const filePath = this.entryPath(key.sessionId)
    const tmpPath = filePath + '.tmp'
    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n'
    await writeFile(tmpPath, lines, 'utf-8')
    await rename(tmpPath, filePath)

    // Rebuild branch head from last entry
    const lastEntry = entries[entries.length - 1] as any
    if (lastEntry?.id) {
      const branches = await this.loadBranches(key.sessionId)
      if (branches.branches[branches.active]) {
        branches.branches[branches.active].head = lastEntry.id
      }
      await this.saveBranches(key.sessionId, branches)
    }
  }

  // --- Tree operations ---

  async branch(sessionId: string, fromEntryId: string, branchName?: string): Promise<string> {
    const branches = await this.loadBranches(sessionId)
    const name = branchName || `branch-${Date.now()}-${randomUUID().slice(0, 8)}`

    // Verify the entry exists
    const allEntries = await this.readAllEntries(sessionId)
    if (!allEntries || !allEntries.find((e: any) => e.id === fromEntryId)) {
      throw new Error(`Entry ${fromEntryId} not found in session ${sessionId}`)
    }

    branches.branches[name] = { head: fromEntryId, name }
    branches.active = name
    await this.saveBranches(sessionId, branches)
    return name
  }

  async switchBranch(sessionId: string, branchName: string): Promise<void> {
    const branches = await this.loadBranches(sessionId)
    if (!branches.branches[branchName]) {
      throw new Error(`Branch "${branchName}" not found in session ${sessionId}`)
    }
    branches.active = branchName
    await this.saveBranches(sessionId, branches)
  }

  async listBranches(sessionId: string): Promise<Array<{ name: string; head: string; active: boolean }>> {
    const branches = await this.loadBranches(sessionId)
    return Object.entries(branches.branches).map(([name, data]) => ({
      name,
      head: data.head,
      active: name === branches.active,
    }))
  }
}
