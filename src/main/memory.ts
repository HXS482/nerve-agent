import { readdir, readFile, writeFile, rename, stat, mkdir } from 'fs/promises'
import { join, extname, basename } from 'path'
import { homedir } from 'os'
import Anthropic from '@anthropic-ai/sdk'
import type { ClaudeSettings } from './settings'

// ─── Constants ────────────────────────────────────────────

const BRAIN_DIR = join(homedir(), '.nerve', '_brain')
const IDENTITY_DIR = join(BRAIN_DIR, '_identity')
const PROCEDURAL_DIR = join(BRAIN_DIR, '_procedural')
const EPISODIC_DIR = join(BRAIN_DIR, '_episodic')

const TOKEN_BUDGET_IDENTITY = 500
const TOKEN_BUDGET_PROCEDURAL = 1000
const TOKEN_BUDGET_EPISODIC = 3000
const CHARS_PER_TOKEN = 4

const MIN_ACCESS_COUNT = 1
const MIN_RELEVANCE_SCORE = 1
const MIN_MESSAGE_LENGTH = 3
const DEDUP_THRESHOLD = 0.6

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'ought',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'it', 'its', 'they', 'them', 'their', 'this', 'that',
  'these', 'those', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'not', 'no', 'nor', 'but', 'or', 'and', 'if', 'then',
  'else', 'so', 'just', 'also', 'very', 'too', 'quite', 'rather',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'about', 'like', 'through', 'after', 'over', 'between',
  'out', 'against', 'during', 'without', 'before', 'under', 'around',
  'among', 'up', 'down', 'off', 'above', 'below', 'each', 'every',
  'all', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
  'than', 'too', 'any', 'much', 'own', 'same', 'here', 'there',
  'now', 'then', 'once', 'only', 'even', 'still', 'already', 'yet',
  'well', 'back', 'even', 'new', 'one', 'two', 'first', 'last',
  'next', 'many', 'make', 'like', 'get', 'got', 'go', 'went',
  'come', 'came', 'see', 'saw', 'know', 'knew', 'think', 'thought',
  'say', 'said', 'take', 'took', 'give', 'gave', 'let', 'put',
  'keep', 'kept', 'try', 'tried', 'want', 'use', 'used', 'find',
  'found', 'tell', 'told', 'ask', 'asked', 'work', 'worked',
  'seem', 'feel', 'left', 'right', 'thing', 'things', 'way',
  'really', 'okay', 'sure', 'yeah', 'yes', 'thanks', 'thank',
  'please', 'sorry', 'help', 'need', 'don', 'doesn', 'didn',
  'won', 'wouldn', 'couldn', 'shouldn', 'isn', 'aren', 'wasn',
  'weren', 'hasn', 'haven', 'hadn', 'let', 'that', 'the',
])

// ─── Mutex (promise chain — no dropped extractions) ──────

let extractionChain: Promise<void> = Promise.resolve()

// ─── Types ────────────────────────────────────────────────

interface MemoryFile {
  path: string
  frontmatter: Record<string, any>
  body: string
  mtime: number
}

interface ExtractedMemory {
  content: string
  category: 'preference' | 'decision' | 'fact' | 'workflow'
  confidence: 'high' | 'medium' | 'low'
  tags: string[]
}

// ─── Frontmatter ──────────────────────────────────────────

function parseFrontmatter(content: string): { frontmatter: Record<string, any>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, any> = {}
  const lines = match[1].split('\n')
  for (const line of lines) {
    // Simple key: value
    const kv = line.match(/^([\w-]+)\s*:\s*(.+)$/)
    if (kv) {
      const key = kv[1]
      let val: any = kv[2].trim().replace(/^["']|["']$/g, '')
      // Parse arrays: [a, b, c]
      if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map((s: string) => s.trim().replace(/^["']|["']$/g, ''))
      }
      // Parse numbers
      else if (/^\d+$/.test(val)) val = parseInt(val, 10)
      frontmatter[key] = val
    }
  }
  return { frontmatter, body: match[2] }
}

function serializeFrontmatter(frontmatter: Record<string, any>, body: string): string {
  const lines = ['---']
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`)
    } else {
      lines.push(`${key}: ${value}`)
    }
  }
  lines.push('---')
  lines.push('')
  lines.push(body)
  return lines.join('\n')
}

// ─── File scanning ────────────────────────────────────────

async function scanMemoryDir(dir: string): Promise<MemoryFile[]> {
  const results: MemoryFile[] = []
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return results
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const filePath = join(dir, entry)
    try {
      const content = await readFile(filePath, 'utf-8')
      const fileStat = await stat(filePath)
      const { frontmatter, body } = parseFrontmatter(content)
      results.push({ path: filePath, frontmatter, body, mtime: fileStat.mtimeMs })
    } catch {
      // skip unreadable files
    }
  }
  return results
}

// ─── Keywords ─────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const segments: string[] = []

  // Split on punctuation and whitespace
  const parts = text
    .toLowerCase()
    .replace(/[，。！？、；：""''（）【】《》…—\-.,!?;:'"()\[\]{}<>]+/g, '|')
    .split('|')
    .filter(s => s.length > 0)

  for (const part of parts) {
    // Split on common Chinese particles/suffixes
    const tokens = part.split(/(?<=[的了吗呢吧啊哦嗯呀嘛])|(?=[的了吗呢吧啊哦嗯呀])/)
    for (const token of tokens) {
      if (/[一-鿿]/.test(token)) {
        // Short tokens (2-4 chars) are likely words
        if (token.length >= 2 && token.length <= 4) {
          segments.push(token)
        }
        // For longer tokens, generate aligned 2-char chunks (not sliding window)
        if (token.length > 4) {
          for (let i = 0; i < token.length - 1; i += 2) {
            segments.push(token.slice(i, i + 2))
          }
          // Also add the last 2 chars if not already captured
          if (token.length % 2 === 1) {
            segments.push(token.slice(-2))
          }
        }
      } else if (token.length > 0) {
        segments.push(token)
      }
    }
  }

  return [...new Set(segments)].filter(w => !STOP_WORDS.has(w))
}

// ─── Relevance scoring ───────────────────────────────────

function scoreRelevance(keywords: string[], file: MemoryFile): number {
  if (keywords.length === 0) return 0

  const haystack = [
    basename(file.path, '.md'),
    file.frontmatter.name || '',
    Array.isArray(file.frontmatter.tags) ? file.frontmatter.tags.join(' ') : '',
    file.body.slice(0, 500),
  ].join(' ').toLowerCase()

  let score = 0
  for (const kw of keywords) {
    let idx = 0
    while ((idx = haystack.indexOf(kw, idx)) !== -1) {
      score++
      idx += kw.length
    }
  }
  return score
}

// ─── Token estimation ────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '...'
}

// ─── Atomic write ─────────────────────────────────────────

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + '.tmp'
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, filePath)
}

// ─── Frontmatter update ──────────────────────────────────

async function updateFrontmatter(filePath: string, updates: Record<string, any>): Promise<void> {
  const content = await readFile(filePath, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)
  Object.assign(frontmatter, updates)
  const serialized = serializeFrontmatter(frontmatter, body)
  await atomicWrite(filePath, serialized)
}

// ─── L1 Identity: always inject ───────────────────────────

export async function loadIdentity(): Promise<string> {
  const files = await scanMemoryDir(IDENTITY_DIR)
  if (files.length === 0) return ''

  const parts: string[] = []
  let totalTokens = 0

  for (const file of files) {
    const text = `[Identity] ${file.body.trim()}`
    const tokens = estimateTokens(text)
    if (totalTokens + tokens > TOKEN_BUDGET_IDENTITY) break
    parts.push(text)
    totalTokens += tokens
  }

  return parts.join('\n\n')
}

// ─── L2 Procedural: conditional inject ────────────────────

export async function loadProcedural(): Promise<string> {
  const files = await scanMemoryDir(PROCEDURAL_DIR)
  if (files.length === 0) return ''

  // Filter: only files with access_count >= MIN_ACCESS_COUNT
  const qualified = files.filter(f => {
    const count = f.frontmatter.access_count ?? 0
    return count >= MIN_ACCESS_COUNT
  })

  if (qualified.length === 0) return ''

  // Sort by last_accessed descending
  qualified.sort((a, b) => {
    const ta = a.frontmatter.last_accessed ? new Date(a.frontmatter.last_accessed).getTime() : 0
    const tb = b.frontmatter.last_accessed ? new Date(b.frontmatter.last_accessed).getTime() : 0
    return tb - ta
  })

  const parts: string[] = []
  let totalTokens = 0

  for (const file of qualified) {
    const text = `[Procedure] ${file.body.trim()}`
    const tokens = estimateTokens(text)
    if (totalTokens + tokens > TOKEN_BUDGET_PROCEDURAL) break
    parts.push(text)
    totalTokens += tokens
  }

  return parts.join('\n\n')
}

// ─── L3 Episodic: keyword retrieval ───────────────────────

export async function loadEpisodic(userMessage: string, excludePaths?: Set<string>): Promise<string> {
  // Search both episodic and procedural directories
  const [episodicFiles, proceduralFiles] = await Promise.all([
    scanMemoryDir(EPISODIC_DIR),
    scanMemoryDir(PROCEDURAL_DIR),
  ])
  const allFiles = [...episodicFiles, ...proceduralFiles]
  if (allFiles.length === 0) return ''

  // Dedup: exclude files already injected in L2
  const files = excludePaths
    ? allFiles.filter(f => !excludePaths.has(f.path))
    : allFiles

  const keywords = extractKeywords(userMessage)
  if (keywords.length === 0) return ''

  const scored: Array<{ file: MemoryFile; score: number }> = []
  for (const file of files) {
    const score = scoreRelevance(keywords, file)
    if (score >= MIN_RELEVANCE_SCORE) {
      scored.push({ file, score })
    }
  }

  if (scored.length === 0) return ''

  // Sort by score descending, then mtime descending
  scored.sort((a, b) => b.score - a.score || b.file.mtime - a.file.mtime)

  const top = scored.slice(0, 5)
  const parts: string[] = []
  let totalTokens = 0

  for (const { file } of top) {
    // Take up to 3 lines for better context (not just first line)
    const lines = file.body.trim().split('\n').filter(l => l.trim()).slice(0, 3)
    const text = `[Recalled Memory] ${lines.join(' ')}`
    const tokens = estimateTokens(text)
    if (totalTokens + tokens > TOKEN_BUDGET_EPISODIC) break
    parts.push(text)
    totalTokens += tokens
  }

  // Bump access_count for matched files
  for (const { file } of top) {
    const currentCount = file.frontmatter.access_count ?? 0
    updateFrontmatter(file.path, {
      access_count: currentCount + 1,
      last_accessed: new Date().toISOString(),
    }).catch(() => { /* silent */ })
  }

  return parts.join('\n\n')
}

// ─── Build memory context ─────────────────────────────────

export async function buildMemoryContext(
  baseSystemPrompt: string,
  userMessage: string,
): Promise<{ systemPrompt: string; episodicMessage: string | null }> {
  // L1 + L2 in parallel
  const [identity, procedural, proceduralFiles] = await Promise.all([
    loadIdentity(),
    loadProcedural(),
    scanMemoryDir(PROCEDURAL_DIR),
  ])

  let systemPrompt = baseSystemPrompt
  if (identity) systemPrompt += '\n\n' + identity
  if (procedural) systemPrompt += '\n\n' + procedural

  // L3: keyword retrieval, excluding files already in L2
  const l2Paths = new Set(
    proceduralFiles
      .filter(f => (f.frontmatter.access_count ?? 0) >= MIN_ACCESS_COUNT)
      .map(f => f.path)
  )
  const episodic = await loadEpisodic(userMessage, l2Paths)
  const episodicMessage = episodic || null

  return { systemPrompt, episodicMessage }
}

// ─── JSON parse fallback ──────────────────────────────────

function parseExtractedJSON(raw: string): ExtractedMemory[] | null {
  // Level 1: direct JSON.parse
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return validateMemories(parsed)
    if (typeof parsed === 'object' && parsed !== null) return validateMemories([parsed])
  } catch { /* try next level */ }

  // Level 2: regex extract array
  const arrayMatch = raw.match(/\[[\s\S]*\]/)
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0])
      if (Array.isArray(parsed)) return validateMemories(parsed)
    } catch { /* try next level */ }
  }

  // Level 3: extract individual objects
  const objects: any[] = []
  const objRegex = /\{[^{}]*\}/g
  let match
  while ((match = objRegex.exec(raw)) !== null) {
    try {
      objects.push(JSON.parse(match[0]))
    } catch { /* skip malformed object */ }
  }

  if (objects.length > 0) return validateMemories(objects)
  return null
}

function validateMemories(items: any[]): ExtractedMemory[] {
  const valid: ExtractedMemory[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    if (typeof item.content !== 'string' || !item.content.trim()) continue

    const category = item.category
    if (!['preference', 'decision', 'fact', 'workflow'].includes(category)) continue

    const confidence = item.confidence
    if (!['high', 'medium', 'low'].includes(confidence)) continue

    // Low confidence → discard
    if (confidence === 'low') continue

    const tags = Array.isArray(item.tags) ? item.tags.filter((t: any) => typeof t === 'string') : []

    valid.push({
      content: item.content.trim(),
      category,
      confidence,
      tags,
    })
  }
  return valid
}

// ─── Deduplication ────────────────────────────────────────

function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  return intersection / Math.max(wordsA.size, wordsB.size)
}

async function isDuplicate(content: string, targetDir: string): Promise<MemoryFile | null> {
  const existing = await scanMemoryDir(targetDir)
  for (const file of existing) {
    const overlap = computeWordOverlap(content, file.body)
    if (overlap > DEDUP_THRESHOLD) return file
  }
  return null
}

// ─── Write memory ─────────────────────────────────────────

// Check if memory is about naming the agent, and update identity self.md
async function tryUpdateIdentity(memory: ExtractedMemory): Promise<boolean> {
  const content = memory.content.toLowerCase()
  // Patterns: "用户将助手命名为X", "助手叫X", "called X", "name is X", "口头禅是X"
  const nameMatch = content.match(/(?:命名为|叫做?|名称[是为]|叫[你她它他]|名字[是为]|name[sd]?\s+(?:to\s+)?(?:is\s+)?)\s*['"]?([^'"，,。.\s]{1,20})['"]?/i)
  const catchphraseMatch = content.match(/(?:口头禅|catchphrase|slogan)[是为]?\s*['"]?([^'"，,。.\s]{1,20})['"]?/i)

  if (!nameMatch && !catchphraseMatch) return false

  const selfPath = join(IDENTITY_DIR, 'self.md')
  try {
    const existing = await readFile(selfPath, 'utf-8')
    const { frontmatter, body } = parseFrontmatter(existing)
    let updatedBody = body

    if (nameMatch) {
      const newName = nameMatch[1]
      updatedBody = updatedBody
        .replace(/我是\s*\S+/, `我是${newName}`)
        .replace(/I am\s*\S+/, `I am ${newName}`)
      frontmatter.name = newName
      frontmatter.aliases = [...new Set([...(frontmatter.aliases || []), newName])]
      console.log(`[Memory] Identity updated: name → "${newName}"`)
    }

    if (catchphraseMatch) {
      const phrase = catchphraseMatch[1]
      // Append catchphrase to identity if not already present
      if (!updatedBody.includes(phrase)) {
        updatedBody = updatedBody.trimEnd() + `\n口头禅：${phrase}\n`
      }
      frontmatter.catchphrase = phrase
      console.log(`[Memory] Identity updated: catchphrase → "${phrase}"`)
    }

    await atomicWrite(selfPath, serializeFrontmatter(frontmatter, updatedBody))
    return true
  } catch {
    return false
  }
}

async function writeMemory(memory: ExtractedMemory): Promise<void> {
  // Check if this is a naming memory — update identity first
  if (memory.category === 'preference') {
    const updated = await tryUpdateIdentity(memory)
    if (updated) return // identity updated, skip procedural write for naming
  }

  const isPreference = memory.category === 'preference' || memory.category === 'workflow'
  const targetDir = isPreference ? PROCEDURAL_DIR : EPISODIC_DIR
  const prefix = isPreference ? 'preference' : 'decision'

  // Check for duplicate
  const dup = await isDuplicate(memory.content, targetDir)
  if (dup) {
    // Bump access_count on existing file
    const currentCount = dup.frontmatter.access_count ?? 0
    await updateFrontmatter(dup.path, {
      access_count: currentCount + 1,
      last_accessed: new Date().toISOString(),
    })
    return
  }

  // Ensure directory exists
  await mkdir(targetDir, { recursive: true })

  // Generate filename
  const slug = memory.content
    .toLowerCase()
    .replace(/[^\w\s一-鿿-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50) || Date.now().toString(36)
  const filename = `${prefix}-${slug}.md`
  const filePath = join(targetDir, filename)

  const frontmatter: Record<string, any> = {
    name: slug,
    description: memory.content.slice(0, 100),
    tags: memory.tags,
    confidence: memory.confidence,
    category: memory.category,
    access_count: 1,
    last_accessed: new Date().toISOString(),
    created: new Date().toISOString(),
  }

  const content = serializeFrontmatter(frontmatter, memory.content)
  await atomicWrite(filePath, content)
}

// ─── Extraction prompt ────────────────────────────────────

function buildExtractionPrompt(userMessage: string, assistantResponse: string): string {
  return `Analyze this conversation and extract durable knowledge. Only extract:
- User preference explicitly stated or confirmed (e.g., "I prefer X", "always do Y")
- Technical decision made together (e.g., "we chose React over Vue")
- Fact the user corrected or confirmed twice
- Workflow pattern the user explicitly described

Do NOT extract:
- One-off requests or questions
- Information appearing only once without confirmation
- Implementation details that belong in code
- Speculative or uncertain statements

Output JSON array. Each item:
{
  "content": "Concise declarative sentence",
  "category": "preference" | "decision" | "fact" | "workflow",
  "confidence": "high" | "medium" | "low",
  "tags": ["keyword1", "keyword2", "broader_term1", "broader_term2"]
}

Tag rules:
- Include the specific term (e.g., "科幻片")
- ALSO include broader related terms that someone might use when searching (e.g., "电影", "娱乐", "推荐")
- Include 3-6 tags total, mixing specific and broad terms

Confidence rules:
- "high": user explicitly stated, repeated, or confirmed
- "medium": strongly implied by context or confirmed once
- "low": inferred from single mention — SKIP, do not include

If nothing worth extracting, output: []

Conversation:
User: ${userMessage}
Assistant: ${assistantResponse}`
}

// ─── Extraction pipeline ──────────────────────────────────

export async function extractMemory(
  userMessage: string,
  assistantResponse: string,
  settings: ClaudeSettings,
): Promise<void> {
  // Gate: minimum message length
  if (userMessage.length < MIN_MESSAGE_LENGTH) return

  // Chain onto the previous extraction — never drop
  extractionChain = extractionChain.then(() => doExtract(userMessage, assistantResponse, settings))
}

async function doExtract(
  userMessage: string,
  assistantResponse: string,
  settings: ClaudeSettings,
): Promise<void> {
  try {
    // Call extraction LLM (uses dedicated extraction provider if configured)
    const ext = settings.extraction
    let sdkBaseURL: string
    let authToken: string
    let modelName: string

    if (ext && ext.baseURL && ext.authToken) {
      sdkBaseURL = ext.baseURL.replace(/\/+$/, '')
      authToken = ext.authToken
      modelName = ext.model || 'deepseek-chat'
    } else {
      sdkBaseURL = (settings.baseURL || 'https://api.anthropic.com').replace(/\/+$/, '')
      authToken = settings.authToken
      modelName = 'claude-haiku-4-5-20251001'
    }
    if (sdkBaseURL.endsWith('/v1')) sdkBaseURL = sdkBaseURL.slice(0, -3)

    // Use Anthropic SDK for Anthropic-compatible endpoints, raw fetch for others
    const isAnthropicEndpoint = sdkBaseURL.includes('anthropic.com')
      || sdkBaseURL.endsWith('/anthropic')
      || sdkBaseURL.endsWith('/anthropic/')
    let text: string

    // 30s timeout for extraction
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 30_000)

    try {
      if (isAnthropicEndpoint) {
        const client = new Anthropic({ apiKey: authToken, baseURL: sdkBaseURL })
        const response = await client.messages.create({
          model: modelName,
          max_tokens: 1024,
          messages: [{ role: 'user', content: buildExtractionPrompt(userMessage, assistantResponse) }],
          temperature: 0,
        }, { signal: ac.signal })
        text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
      } else {
        // OpenAI-compatible endpoint (DeepSeek, MiMo, etc.)
        const response = await fetch(`${sdkBaseURL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
          body: JSON.stringify({
            model: modelName,
            max_tokens: 1024,
            messages: [{ role: 'user', content: buildExtractionPrompt(userMessage, assistantResponse) }],
            temperature: 0,
          }),
          signal: ac.signal,
        })
        if (!response.ok) {
          console.error(`[Memory] extraction HTTP ${response.status}: ${response.statusText}`)
          return
        }
        const json = await response.json()
        text = json.choices?.[0]?.message?.content || ''
      }
    } finally {
      clearTimeout(timeout)
    }

    if (!text) return

    // Parse with 3-level fallback
    const memories = parseExtractedJSON(text)
    if (!memories || memories.length === 0) return

    // Write each memory (with dedup)
    for (const memory of memories) {
      await writeMemory(memory)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[Memory] extraction timed out')
    } else {
      console.error('[Memory] extraction failed:', err)
    }
  }
}
