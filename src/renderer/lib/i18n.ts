/**
 * 极小的文案钩子（beUI 的 useMessages 精简版）。
 *
 * 上游组件库里所有可见文案都走 useMessages(namespace, defaults, overrides)，
 * 好处是组件本身不硬编码语言，调用方可以整包覆盖。移植时保留这个契约，
 * 但先只实现「默认中文 + 调用方覆盖」—— 没有 locale 切换层。
 */
import { useMemo } from 'react'

type Messages = Record<string, string>
type Substitutions = Record<string, string | number>

export function useMessages<T extends Messages>(
  _namespace: string,
  defaults: T,
  overrides?: Partial<T>,
): (key: keyof T & string, substitutions?: Substitutions) => string {
  return useMemo(() => {
    const merged = { ...defaults, ...(overrides ?? {}) } as Messages
    return (key: string, substitutions?: Substitutions) => {
      const template = merged[key] ?? key
      if (!substitutions) return template
      return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
        name in substitutions ? String(substitutions[name]) : whole,
      )
    }
  }, [defaults, overrides])
}
