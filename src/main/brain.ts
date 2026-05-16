import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, relative, basename, extname, resolve, isAbsolute, sep } from 'path'
import { homedir } from 'os'
import type { BrainNode, BrainLink, BrainGraphData, BrainFileContent } from '../shared/types'

// Scan multiple possible brain locations
const BRAIN_SEARCH_PATHS = [
  join(homedir(), '.nerve', '_brain'),
  join(homedir(), '.nerve', 'brain'),
  join(homedir(), '.nerve', 'memory'),
  // Obsidian vault paths
  join(homedir(), 'Documents', 'Obsidian', '_brain'),
  join(homedir(), 'Obsidian', '_brain'),
]

const SCHEMA_SEARCH_PATHS = [
  join(homedir(), '.nerve', '_schema'),
  join(homedir(), '.nerve', 'schema'),
]

// Node type → color mapping (used by renderer)
export const BRAIN_TYPE_COLORS: Record<string, string> = {
  identity: '#3b82f6',   // blue
  cache: '#10b981',      // green
  episodic: '#f59e0b',   // amber
  procedural: '#8b5cf6', // purple
  semantic: '#ec4899',   // pink
  schema: '#6b7280',     // gray
  unknown: '#6b7280',
}

function findBrainDir(): string | null {
  for (const p of BRAIN_SEARCH_PATHS) {
    if (existsSync(p) && statSync(p).isDirectory()) return p
  }
  return null
}

function findSchemaDir(): string | null {
  for (const p of SCHEMA_SEARCH_PATHS) {
    if (existsSync(p) && statSync(p).isDirectory()) return p
  }
  return null
}

// Recursively collect all .md files
function collectMarkdownFiles(dir: string, baseDir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results

  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath, baseDir))
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      results.push(fullPath)
    }
  }
  return results
}

// Parse YAML frontmatter (simple parser, no dependency)
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, string> = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/)
    if (kv) {
      frontmatter[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '')
    }
  }
  return { frontmatter, body: match[2] }
}

// Extract [[wiki-links]] from markdown body
function extractWikiLinks(body: string): string[] {
  const links: string[] = []
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match
  while ((match = regex.exec(body)) !== null) {
    links.push(match[1].trim())
  }
  return links
}

// Derive brain type from file path
function deriveType(filePath: string, brainDir: string): string {
  const rel = relative(brainDir, filePath).replace(/\\/g, '/')
  if (rel.startsWith('_identity')) return 'identity'
  if (rel.startsWith('_cache')) return 'cache'
  if (rel.startsWith('_episodic')) return 'episodic'
  if (rel.startsWith('_procedural')) return 'procedural'
  if (rel.startsWith('_semantic')) return 'semantic'
  return 'unknown'
}

// Build node ID from relative path (without extension)
function pathToId(filePath: string, brainDir: string): string {
  return relative(brainDir, filePath).replace(/\\/g, '/').replace(/\.md$/, '')
}

export function scanBrain(): BrainGraphData {
  const brainDir = findBrainDir()
  if (!brainDir) return { nodes: [], links: [] }

  const mdFiles = collectMarkdownFiles(brainDir, brainDir)
  const nodes: BrainNode[] = []
  const links: BrainLink[] = []
  const idSet = new Set<string>()
  const linkMap: { sourceId: string; targetName: string }[] = []

  for (const filePath of mdFiles) {
    const content = readFileSync(filePath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)
    const id = pathToId(filePath, brainDir)
    const type = deriveType(filePath, brainDir)
    const name = frontmatter['title'] || basename(filePath, '.md')
    const tags = frontmatter['tags']
      ? frontmatter['tags'].replace(/[\[\]]/g, '').split(',').map(t => t.trim())
      : []

    idSet.add(id)
    nodes.push({
      id,
      name,
      path: filePath,
      type,
      tags,
      size: content.length,
    })

    // Collect wiki-links for later resolution
    const wikiLinks = extractWikiLinks(body)
    for (const target of wikiLinks) {
      linkMap.push({ sourceId: id, targetName: target })
    }
  }

  // Resolve links: match target name to node IDs
  for (const { sourceId, targetName } of linkMap) {
    // Try exact ID match first
    if (idSet.has(targetName)) {
      links.push({ source: sourceId, target: targetName })
      continue
    }
    // Try matching by filename (last segment of ID)
    const matchNode = nodes.find(n => {
      const namePart = n.id.split('/').pop()
      return namePart === targetName || n.name === targetName
    })
    if (matchNode && matchNode.id !== sourceId) {
      links.push({ source: sourceId, target: matchNode.id })
    }
  }

  // Also scan schema directory as connected nodes
  const schemaDir = findSchemaDir()
  if (schemaDir) {
    const schemaFiles = collectMarkdownFiles(schemaDir, schemaDir)
    for (const filePath of schemaFiles) {
      const content = readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter(content)
      const id = 'schema/' + basename(filePath, '.md')
      const name = frontmatter['title'] || basename(filePath, '.md')

      if (!idSet.has(id)) {
        idSet.add(id)
        nodes.push({
          id,
          name,
          path: filePath,
          type: 'schema',
          size: content.length,
        })

        const wikiLinks = extractWikiLinks(body)
        for (const target of wikiLinks) {
          const matchNode = nodes.find(n => {
            const namePart = n.id.split('/').pop()
            return namePart === target || n.name === target
          })
          if (matchNode && matchNode.id !== id) {
            links.push({ source: id, target: matchNode.id })
          }
        }
      }
    }
  }

  return { nodes, links }
}

export function readBrainFile(filePath: string): BrainFileContent | null {
  try {
    // Path traversal guard: resolved path must be within one of the brain search paths
    const resolved = resolve(filePath)
    const allowedRoots = [...BRAIN_SEARCH_PATHS, ...SCHEMA_SEARCH_PATHS]
    const isAllowed = allowedRoots.some((root) => {
      const resolvedRoot = resolve(root)
      return resolved.startsWith(resolvedRoot + sep) || resolved === resolvedRoot
    })
    if (!isAllowed) return null

    if (!existsSync(resolved)) return null
    const content = readFileSync(resolved, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(content)
    return { path: resolved, content: body, frontmatter }
  } catch {
    return null
  }
}
