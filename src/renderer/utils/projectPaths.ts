// 项目路径工具：兼容 win/posix 分隔符与结尾斜杠，供项目选择器与 Stage 会话列表共用

export interface PathSegment {
  name: string
  path: string
}

/** 路径末段（C:\a\b\ → b） */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

/** 上一级目录；已在盘根 / 文件系统根 / 相对路径时返回 null */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (!trimmed || /^[a-zA-Z]:$/.test(trimmed)) return null
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'))
  if (idx < 0) return null
  const parent = trimmed.slice(0, idx)
  if (parent === '') return '/'
  // C:\Users → C:\（盘符要带回分隔符才能当根用）
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}\\` : parent
}

/** 面包屑：逐级累积出「名字 + 可直接跳转的完整路径」 */
export function pathSegments(path: string): PathSegment[] {
  const trimmed = path.replace(/[\\/]+$/, '')
  // 盘符开头（C:）即使已经剥掉结尾斜杠也按 win 处理，否则 C:\ 会被拼成 C:/
  const sep = /^[a-zA-Z]:/.test(trimmed) || trimmed.includes('\\') ? '\\' : '/'
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  const segments: PathSegment[] = []
  let acc = ''
  for (const part of parts) {
    if (!acc) acc = sep === '/' ? `/${part}` : `${part}${sep}`
    else acc = acc.endsWith(sep) ? acc + part : `${acc}${sep}${part}`
    segments.push({ name: part, path: acc })
  }
  return segments
}
