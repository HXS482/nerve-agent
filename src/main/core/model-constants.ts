/**
 * 共享模型常量 — context window 大小 & 每 token 成本
 */

// 兜底值：模型不在表里（公司代理/自建网关的私有模型，如 GLM-5.3-Flash）时用它。
// 调用方应该在启动时用 settings.contextWindow 把它顶掉。
export const FALLBACK_CONTEXT_WINDOW = 200_000

/**
 * 查表的 context window，支持非精确命中的私有模型名。
 * 按「最长前缀」优先：GLM-5.3 命中 512000，GLM-5.3-Flash 若单独登记则命中自己那条。
 * 用「模型名 startsWith 表内 key」而不是反过来，避免 'glm' 这种短 key 抢走更精确的条目。
 */
export function lookupContextWindow(
  modelId: string | undefined | null,
  table: Record<string, number> = CONTEXT_WINDOWS,
): number | undefined {
  if (!modelId) return undefined
  if (table[modelId]) return table[modelId]
  const lower = modelId.toLowerCase()
  let best: number | undefined
  let bestLen = 0
  for (const [key, value] of Object.entries(table)) {
    const k = key.toLowerCase()
    if (k.length > bestLen && lower.startsWith(k)) {
      best = value
      bestLen = k.length
    }
  }
  return best
}

export const CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus-4-20250514': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o1': 200_000,
  'o3': 200_000,
  // GLM (智谱 / 公司代理网关)
  'glm-5.3': 512_000,
  'glm-5.3-flash': 512_000,
  'glm-4': 128_000,
  // Google
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
}

export const COST_PER_TOKEN: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-20250514': { input: 0.015, output: 0.075 },
  'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5-20251001': { input: 0.001, output: 0.005 },
  // OpenAI
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  // Google
  'gemini-2.5-pro': { input: 0.00125, output: 0.01 },
  'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
}
