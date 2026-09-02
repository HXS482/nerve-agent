/**
 * stageAdapter —— Stage 模式的数据适配层
 *
 * 把 chatStore 的消息流转成 Stage 视图模型（轮次/卡片/旁白/批注）。
 * Stage 组件只消费这里的输出，不直接解析消息——与 ChatPanel 彻底解耦。
 */

import type { ChatMessage } from '../../shared/types'
import { groupBlocks } from '../components/toolflow-utils'
import type { StageCardData } from '../components/Stage/StageCard'

export interface StageRound {
  id: string
  startTs: number
  artifactCards: StageCardData[]
  textSegments: string[]
  /** 该轮的用户消息文本（仅 fromUser 轮有值） */
  userText: string
  /** false = 会话恢复时 assistant 开头的孤儿轮（auto-*），不进消息列表 */
  fromUser: boolean
}

export interface StageCardEntry {
  card: StageCardData
  annotations?: string[]
}

/** 用户消息列表行（含 agent 尚未回复的空轮——刚发的消息立刻出现） */
export interface StageRoundSummary {
  id: string
  ts: number
  userText: string
  hasArtifacts: boolean
  hasText: boolean
}

export interface StageViewModel {
  /** 待渲染卡片（含批注归属）；有效选中轮时只含该轮 */
  cards: StageCardEntry[]
  /** 焦点轮为纯文字轮时的旁白文本（空串 = 不显示旁白） */
  narrationText: string
  /** 焦点轮 id（旁白渐现动画的 key + 列表高亮行判定） */
  focusRoundId: string | null
  /** 用户消息列表数据源 */
  rounds: StageRoundSummary[]
}

// ─── 轮次状态机 ───
// 一轮 = 一条用户消息 → agent 完成回复。
// 纯文字轮：文字走旁白（不落地）；混合轮：产物卡 + 弹幕批注。
// 无选中时焦点永远是最新轮；选中旧轮可回看，旧轮文字只在被选中时渲染。

function groupRounds(messages: ChatMessage[]): StageRound[] {
  const rounds: StageRound[] = []
  let current: StageRound | null = null
  const newRound = (id: string, startTs: number, userText: string, fromUser: boolean): StageRound => {
    current = { id, startTs, artifactCards: [], textSegments: [], userText, fromUser }
    rounds.push(current)
    return current
  }

  for (const msg of messages) {
    if (msg.role === 'user') {
      // 用户消息开启新一轮；文字进消息列表，附件作为产物卡
      const userText = msg.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => b.text!)
        .join(' ')
      const r = newRound(msg.id, msg.timestamp, userText, true)
      msg.content.forEach((b, i) => {
        if (b.type === 'image' && b.src) r.artifactCards.push({ id: `${msg.id}:im${i}`, kind: 'image', block: b, timestamp: msg.timestamp })
        if (b.type === 'file') r.artifactCards.push({ id: `${msg.id}:fl${i}`, kind: 'file', block: b, timestamp: msg.timestamp })
      })
      continue
    }
    if (msg.role !== 'assistant') continue
    const r = current ?? newRound(`auto-${msg.id}`, msg.timestamp, '', false)
    groupBlocks(msg.content).forEach((g, gi) => {
      // 工具调用/thinking 抽离到全局 ToolSpot / ThinkSpot，不落卡
      if (g.kind === 'toolflow') return
      const b = g.block
      if (b.type === 'text' && b.text?.trim()) r.textSegments.push(b.text)
      else if (b.type === 'image' && b.src) r.artifactCards.push({ id: `${msg.id}:im${gi}`, kind: 'image', block: b, timestamp: msg.timestamp })
      else if (b.type === 'file') r.artifactCards.push({ id: `${msg.id}:fl${gi}`, kind: 'file', block: b, timestamp: msg.timestamp })
    })
  }
  return rounds
}

export function buildStageView(messages: ChatMessage[], selectedRoundId?: string | null): StageViewModel {
  const allRounds = groupRounds(messages)
  // 空轮（用户只发了文字、agent 尚未回复的瞬间）不参与焦点/卡片，但进列表
  const liveRounds = allRounds.filter((r) => r.artifactCards.length > 0 || r.textSegments.length > 0)

  // 焦点轮：有效选中优先，否则最新轮；选中空轮/悬空 id 时回落最新，回复流入后自动跳正
  const focused = (selectedRoundId && liveRounds.find((r) => r.id === selectedRoundId)) || null
  const focusRound = focused ?? liveRounds[liveRounds.length - 1]

  // 新一轮刚发出（用户消息已开轮、回复尚未产出任何内容）且未手动选轮：
  // 立即清空上一轮旁白，而不是等本轮思考完成、新文字流入后才替换
  const lastRound = allRounds[allRounds.length - 1]
  const awaitingReply =
    !focused &&
    !!lastRound &&
    lastRound.fromUser &&
    lastRound.artifactCards.length === 0 &&
    lastRound.textSegments.length === 0

  const focusHasArtifact = (focusRound?.artifactCards.length ?? 0) > 0
  // 纯文字轮 → 旁白；混合轮 → 批注
  const narrationText = !awaitingReply && focusRound && !focusHasArtifact ? focusRound.textSegments.join('\n') : ''
  const focusAnnotations = focusRound && focusHasArtifact ? focusRound.textSegments : []

  const cards: StageCardEntry[] = []
  // 有效选中 → 画布只留该轮卡片；否则积累全部轮
  const cardRounds = focused ? [focusRound] : liveRounds
  for (const r of cardRounds) {
    const ann = r === focusRound ? focusAnnotations : undefined
    // 批注停靠在该轮最后一张产物卡上沿
    const lastArtifactIdx = r.artifactCards.length - 1
    r.artifactCards.forEach((c, ci) =>
      cards.push({ card: c, annotations: ann && ci === lastArtifactIdx ? ann : undefined }),
    )
  }

  const rounds: StageRoundSummary[] = allRounds
    .filter((r) => r.fromUser && r.userText)
    .map((r) => ({
      id: r.id,
      ts: r.startTs,
      userText: r.userText,
      hasArtifacts: r.artifactCards.length > 0,
      hasText: r.textSegments.length > 0,
    }))

  return {
    cards,
    narrationText,
    focusRoundId: focusRound?.id ?? null,
    rounds,
  }
}
