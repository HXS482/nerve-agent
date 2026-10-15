import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * 合并 Tailwind class —— clsx 处理条件类名，tailwind-merge 解决冲突
 * （后者覆盖前者，如 `p-2 p-4` → `p-4`）。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
