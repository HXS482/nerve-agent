// src/renderer/lib/diff-parser.ts

export interface DiffLine {
  type: 'add' | 'delete' | 'context' | 'hunk'
  content: string
  oldLine: number | null
  newLine: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  oldPath: string
  status: 'M' | 'A' | 'D' | 'R' | 'C'
  additions: number
  deletions: number
  hunks: DiffHunk[]
}

export interface ParsedDiff {
  files: DiffFile[]
}

function parseHunkHeader(header: string): [number, number, number, number] {
  const m = header.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
  if (!m) return [0, 0, 0, 0]
  return [
    parseInt(m[1], 10),
    m[2] !== undefined ? parseInt(m[2], 10) : 1,
    parseInt(m[3], 10),
    m[4] !== undefined ? parseInt(m[4], 10) : 1,
  ]
}

function parseHunk(hunkLines: string[], oldStart: number, newStart: number): DiffHunk {
  const header = hunkLines[0] ?? ''
  const lines: DiffLine[] = []
  let oldLine = oldStart
  let newLine = newStart

  for (let i = 1; i < hunkLines.length; i++) {
    const raw = hunkLines[i]
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', content: raw.slice(1), oldLine: null, newLine: newLine++ })
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'delete', content: raw.slice(1), oldLine: oldLine++, newLine: null })
    } else if (raw.startsWith('\\')) {
      continue
    } else {
      const content = raw.startsWith(' ') ? raw.slice(1) : raw
      lines.push({ type: 'context', content, oldLine: oldLine++, newLine: newLine++ })
    }
  }

  return { header, lines }
}

function parseFileChunk(chunk: string): DiffFile | null {
  const lines = chunk.split('\n')
  if (lines.length === 0) return null

  const diffGitLine = lines[0]
  const gitMatch = diffGitLine.match(/^diff --git a\/(.*) b\/(.*)$/)
  let path = gitMatch ? gitMatch[2] : ''
  let oldPath = gitMatch ? gitMatch[1] : path

  let status: DiffFile['status'] = 'M'
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('rename from ')) {
      status = 'R'
      oldPath = line.slice('rename from '.length)
    } else if (line.startsWith('rename to ')) {
      path = line.slice('rename to '.length)
    } else if (line.startsWith('copy from ')) {
      status = 'C'
      oldPath = line.slice('copy from '.length)
    } else if (line.startsWith('copy to ')) {
      path = line.slice('copy to '.length)
    } else if (line.startsWith('new file')) {
      status = 'A'
    } else if (line.startsWith('deleted file')) {
      status = 'D'
    }
  }

  for (const line of lines) {
    if (line.startsWith('--- a/')) {
      oldPath = line.slice(6)
    } else if (line.startsWith('--- /dev/null')) {
      status = 'A'
    } else if (line.startsWith('+++ b/')) {
      path = line.slice(6)
    } else if (line.startsWith('+++ /dev/null')) {
      status = 'D'
    }
  }

  const hunks: DiffHunk[] = []
  let currentHunkLines: string[] = []
  let inHunk = false

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (inHunk && currentHunkLines.length > 0) {
        const header = currentHunkLines[0]
        const [oldStart, , newStart] = parseHunkHeader(header)
        const hunk = parseHunk(currentHunkLines, oldStart, newStart)
        additions += hunk.lines.filter((l) => l.type === 'add').length
        deletions += hunk.lines.filter((l) => l.type === 'delete').length
        hunks.push(hunk)
      }
      currentHunkLines = [line]
      inHunk = true
    } else if (inHunk) {
      currentHunkLines.push(line)
    }
  }

  if (inHunk && currentHunkLines.length > 0) {
    const header = currentHunkLines[0]
    const [oldStart, , newStart] = parseHunkHeader(header)
    const hunk = parseHunk(currentHunkLines, oldStart, newStart)
    additions += hunk.lines.filter((l) => l.type === 'add').length
    deletions += hunk.lines.filter((l) => l.type === 'delete').length
    hunks.push(hunk)
  }

  if (hunks.length === 0) return null

  return { path, oldPath, status, additions, deletions, hunks }
}

export function parseUnifiedDiff(raw: string): ParsedDiff {
  if (!raw) return { files: [] }

  const lines = raw.split('\n')
  const fileChunks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.startsWith('diff --git ') && current.length > 0) {
      fileChunks.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) {
    fileChunks.push(current.join('\n'))
  }

  const files = fileChunks
    .map(parseFileChunk)
    .filter((f): f is DiffFile => f !== null)

  return { files }
}
