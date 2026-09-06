/** Edit 工具的匹配与应用逻辑（纯函数，与 IO 解耦便于单测） */

export interface EditSuccess {
  ok: true
  content: string
  replacements: number
  /** 命中的是行尾空白容错匹配 */
  fuzzy: boolean
  /** 首个变更行号（1-based） */
  firstChangedLine: number
}

export interface EditFailure {
  ok: false
  error: string
}

const rtrim = (s: string) => s.replace(/[ \t]+$/, '')

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/** 行尾空白容错：滑动窗口逐行 rtrim 比较，返回首个命中位置（1-based） */
function findTrailingWsMatch(content: string, oldString: string): { startLine: number; lineCount: number } | null {
  const oldLines = oldString.split('\n').map(rtrim)
  if (oldLines.every((l) => l === '')) return null // 全空白串不做容错匹配
  const lines = content.split('\n')
  const n = oldLines.length
  for (let i = 0; i + n <= lines.length; i++) {
    let ok = true
    for (let j = 0; j < n; j++) {
      if (rtrim(lines[i + j]) !== oldLines[j]) { ok = false; break }
    }
    if (ok) return { startLine: i + 1, lineCount: n }
  }
  return null
}

/** 找不到时给出最接近的位置提示，帮助模型自我修正 */
const squash = (s: string) => s.trim().replace(/\s+/g, ' ')

function closestMatchHint(content: string, oldString: string): string | null {
  const lines = content.split('\n')
  const oldLines = oldString.split('\n')
  const first = squash(oldLines[0])
  if (!first) return null
  for (let i = 0; i < lines.length; i++) {
    if (squash(lines[i]) === first) {
      return oldLines.length === 1
        ? `closest match at line ${i + 1} (whitespace differs)`
        : `first line matches at line ${i + 1} — check whitespace of the following lines`
    }
  }
  return null
}

/** 成功回执的 diff 摘要：- 旧 / + 新，各最多 12 行、总长 1500 字符 */
export function diffSnippet(oldString: string, newString: string): string {
  const fmt = (s: string, sign: string) =>
    s.split('\n').slice(0, 12).map((l) => sign + (l.length > 120 ? l.slice(0, 120) + '…' : l)).join('\n')
  let d = fmt(oldString, '- ') + '\n' + fmt(newString, '+ ')
  if (d.length > 1500) d = d.slice(0, 1500) + '\n…'
  return d
}

export function applyEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): EditSuccess | EditFailure {
  if (!oldString) return { ok: false, error: 'old_string must not be empty' }

  const occurrences = countOccurrences(content, oldString)

  if (occurrences === 0) {
    // 模型经常丢失行尾空白，先试容错匹配
    const relaxed = findTrailingWsMatch(content, oldString)
    if (!relaxed) {
      const hint = closestMatchHint(content, oldString)
      return { ok: false, error: `old_string not found${hint ? ` — ${hint}` : ''}` }
    }
    const lines = content.split('\n')
    lines.splice(relaxed.startLine - 1, relaxed.lineCount, ...newString.split('\n'))
    return { ok: true, content: lines.join('\n'), replacements: 1, fuzzy: true, firstChangedLine: relaxed.startLine }
  }

  if (occurrences > 1 && !replaceAll) {
    return { ok: false, error: `old_string found ${occurrences} times. Provide more surrounding context to make it unique, or set replace_all: true.` }
  }

  const head = content.slice(0, content.indexOf(oldString))
  return {
    ok: true,
    content: content.split(oldString).join(newString),
    replacements: occurrences,
    fuzzy: false,
    firstChangedLine: head.split('\n').length,
  }
}
