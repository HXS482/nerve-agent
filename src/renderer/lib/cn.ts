/**
 * 极小的 className 拼接工具。
 *
 * 上游的 beui 组件用 `cn`（clsx + tailwind-merge）。这个项目没装那两个包，
 * 也不打算为一个字符串拼接引依赖：这里只需要「过滤假值 + 空格连接」。
 * 不做 tailwind-merge 的冲突消解 —— 用到的地方都是把调用方传的 className
 * 追加在末尾，CSS 里后写的规则本来就会赢，够用。
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []

  const walk = (value: ClassValue) => {
    if (!value) return
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value))
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item)
      return
    }
    for (const [key, on] of Object.entries(value)) {
      if (on) out.push(key)
    }
  }

  for (const input of inputs) walk(input)
  return out.join(' ')
}
