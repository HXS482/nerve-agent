/**
 * MemoryBrowser — IPC data source for the new MemoryBrowser UI.
 * Replaces brain.ts by querying TencentDB SQLite directly.
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, readdirSync } from 'fs'

const TAG = '[MemoryBrowser]'

interface MemoryAtom {
  id: string
  content: string
  type: string
  priority: string
  scene_name: string
  tags: string[]
  created: string
  access_count: number
}

interface SceneBlock {
  filename: string
  summary: string
  heat: number
  updated: string
}

interface PersonaCard {
  content: string
  updated: string
}

interface ConvEntry {
  id: string
  session_key: string
  role: string
  content: string
  created: string
}

export interface MemoryBrowserData {
  L0: ConvEntry[]
  L1: MemoryAtom[]
  L2: SceneBlock[]
  L3: PersonaCard
}

function getDataDir(): string {
  return join(homedir(), '.nerve', 'memory-tdai')
}

function getDbPath(): string {
  return join(getDataDir(), 'vectors.db')
}

function getL2Dir(): string {
  return join(getDataDir(), 'scene_blocks')
}

function getL3Path(): string {
  return join(getDataDir(), 'persona.md')
}

/**
 * Scan memory data from TencentDB SQLite + filesystem.
 * Returns L0-L3 layered data for the MemoryBrowser UI.
 */
export function scanMemoryBrowser(): MemoryBrowserData {
  const dbPath = getDbPath()
  const empty: MemoryBrowserData = { L0: [], L1: [], L2: [], L3: { content: '', updated: '' } }

  if (!existsSync(dbPath)) {
    console.log(`${TAG} No database found at ${dbPath}`)
    return empty
  }

  try {
    // Lazy-require better-sqlite3 to avoid loading at module init
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })

    // L0: Recent conversations
    let L0: ConvEntry[] = []
    try {
      const rows = db.prepare(`
        SELECT id, session_key, role, content, created
        FROM conversations
        ORDER BY created DESC
        LIMIT 50
      `).all()
      L0 = rows.map((r: any) => ({
        id: String(r.id),
        session_key: String(r.session_key || ''),
        role: String(r.role || ''),
        content: String(r.content || ''),
        created: String(r.created || ''),
      }))
    } catch {
      // Table may not exist yet
    }

    // L1: Structured memory atoms
    let L1: MemoryAtom[] = []
    try {
      const rows = db.prepare(`
        SELECT id, content, type, priority, scene_name, tags, created, access_count
        FROM memories
        ORDER BY created DESC
        LIMIT 100
      `).all()
      L1 = rows.map((r: any) => ({
        id: String(r.id),
        content: String(r.content || ''),
        type: String(r.type || 'unknown'),
        priority: String(r.priority || 'medium'),
        scene_name: String(r.scene_name || ''),
        tags: r.tags ? String(r.tags).split(',').filter(Boolean) : [],
        created: String(r.created || ''),
        access_count: Number(r.access_count || 0),
      }))
    } catch {
      // Table may not exist yet
    }

    db.close()

    // L2: Scene blocks from filesystem
    const L2 = scanL2SceneBlocks()

    // L3: Persona
    const L3 = scanL3Persona()

    return { L0, L1, L2, L3 }
  } catch (err) {
    console.error(`${TAG} scanMemoryBrowser error:`, err)
    return empty
  }
}

function scanL2SceneBlocks(): SceneBlock[] {
  const dir = getL2Dir()
  if (!existsSync(dir)) return []

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.md'))
    return files.map(filename => {
      const filePath = join(dir, filename)
      const content = readFileSync(filePath, 'utf-8')
      const stat = require('fs').statSync(filePath)
      // Extract summary from first paragraph
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
      const summary = lines[0]?.slice(0, 120) || ''
      return {
        filename,
        summary,
        heat: 0,
        updated: stat.mtime.toISOString(),
      }
    })
  } catch {
    return []
  }
}

function scanL3Persona(): PersonaCard {
  const path = getL3Path()
  if (!existsSync(path)) return { content: '', updated: '' }

  try {
    const content = readFileSync(path, 'utf-8')
    const stat = require('fs').statSync(path)
    return { content, updated: stat.mtime.toISOString() }
  } catch {
    return { content: '', updated: '' }
  }
}

/**
 * Read content for a specific memory item by type and id.
 */
export function readMemoryContent(type: string, id: string): string | null {
  const dbPath = getDbPath()
  if (!existsSync(dbPath)) return null

  try {
    const Database = require('better-sqlite3')
    const db = new Database(dbPath, { readonly: true })

    if (type === 'L1') {
      const row = db.prepare('SELECT content FROM memories WHERE id = ?').get(id)
      db.close()
      return row ? String(row.content) : null
    }

    if (type === 'L0') {
      const row = db.prepare('SELECT content FROM conversations WHERE id = ?').get(id)
      db.close()
      return row ? String(row.content) : null
    }

    db.close()
    return null
  } catch {
    return null
  }
}
