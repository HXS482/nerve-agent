/**
 * 共享模型常量 — context window 大小 & 每 token 成本
 *
 * agent-core.ts 和 compactor.ts 共用，避免重复定义
 */

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
