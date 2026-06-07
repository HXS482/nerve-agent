/**
 * 统一 Token 估算器
 *
 * 策略：中文字符 / 1.7 + 其他字符 / 4
 * 比纯 /4 更准确，尤其在中文为主的对话场景
 */

export function estimateTokens(text: string): number {
  let cn = 0
  let other = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e80) cn++
    else other++
  }
  return Math.ceil(cn / 1.7 + other / 4)
}

/**
 * 对任意值估算 token — 先 JSON.stringify 再估算文本
 * 适用于 message entry 等结构化对象
 */
export function estimateObjectTokens(obj: unknown): number {
  return estimateTokens(JSON.stringify(obj))
}
