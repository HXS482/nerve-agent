/**
 * stageAdapter —— Stage 模式的数据适配层
 *
 * 把 chatStore 的消息流转成 Stage 视图模型（轮次/卡片/旁白/批注）。
 * Stage 组件只消费这里的输出，不直接解析消息——与 ChatPanel 彻底解耦。
 */

import type { ChatMessage } from '../../shared/types'
import { groupBlocks, pairTools } from '../components/toolflow-utils'
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

// ─── 代码块抽取 ───
// 从 assistant 文本里抽出 ``` 围栏代码块作为产物卡，剩余文字仍走旁白/批注。
// 只认「开栅栏后换行」的块级围栏；行内单反引号、未闭合围栏保持原样。

export interface ExtractedCodeBlock {
  language: string
  code: string
  /** 围栏前的引导短句（30 字内、冒号结尾，如"输出："）——绑定为该代码块的 caption */
  caption?: string
}

/** Write 写入的代码文件扩展名（用于给围栏代码块卡关联真实文件名） */
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|c|cpp|h|hpp|cs|rb|php|swift|kt|sh|sql|css|scss|less|json|yaml|yml|toml|vue|svelte)$/i

export function extractCodeBlocks(text: string): { prose: string; codeBlocks: ExtractedCodeBlock[] } {
  const codeBlocks: ExtractedCodeBlock[] = []
  const parts: string[] = []
  const FENCE = /```([A-Za-z0-9+#.-]*)\s*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let last = 0
  while ((m = FENCE.exec(text)) !== null) {
    let before = text.slice(last, m.index)
    last = m.index + m[0].length
    const code = m[2].replace(/\n+$/, '')
    if (!code.trim()) {
      parts.push(before)
      continue
    }
    // 引导短句（围栏正上方一行、≤30 字、冒号结尾，如"输出："）归入该代码块的 caption，
    // 不再流落为整轮的悬空批注
    let caption: string | undefined
    const leadMatch = before.match(/(?:^|\n)([^\n]{1,30}[:：])\s*$/)
    if (leadMatch) {
      caption = leadMatch[1].trim()
      before = before.slice(0, before.length - leadMatch[0].length)
    }
    parts.push(before)
    codeBlocks.push({ language: m[1], code, caption })
  }
  parts.push(text.slice(last))
  return { prose: parts.join('').replace(/\n{3,}/g, '\n\n').trim(), codeBlocks }
}

// ─── 正文图片引用抽取 ───
// 模型走 skill/Bash 等路径生图时图片块不进消息流，但正文会提及画廊路径。
// 把正文里带目录的图片路径抽成图片卡（裸文件名无分隔符的不认，避免误伤），路径文本从旁白剥离。
const IMAGE_REF_RE = /(?<!\w)[\w\\/:\-.]+[\\/][\w\\/:\-.]*\.(?:png|jpe?g|gif|webp|svg|bmp)\b/gi

export function extractImageRefs(text: string): { prose: string; images: string[] } {
  const cleaned = text.replace(/`([^`]+\.(?:png|jpe?g|gif|webp|svg|bmp))`/gi, '$1')
  const images = [...new Set(cleaned.match(IMAGE_REF_RE) ?? [])]
  const prose = cleaned.replace(IMAGE_REF_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { prose, images }
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
    // GenerateImage 全生命周期：未出结果 → 生成中占位卡；出结果 → 同 id 换成真实图片卡。
    // 消息级编号保证占位卡与图片卡 id 一致，React 不重挂载，图片在同一画框内浮现。
    const genMeta = (input: Record<string, unknown> | undefined) => ({
      prompt: typeof input?.prompt === 'string' ? input.prompt : undefined,
      resolution: typeof input?.size === 'string' ? input.size.replace(/x/gi, ' × ') : undefined,
    })
    const completedGens: { n: number; input?: Record<string, unknown> }[] = []
    let genIdx = 0
    // Write 写入的代码文件：用于给同消息的代码块卡关联真实文件名（不单独落卡，避免与围栏代码块重复）
    const writeFiles: { fileName: string; content: string }[] = []
    // 结果与图片块分两条 IPC 事件到达，中间空窗期占位卡必须保持生成中状态（不卸载），
    // 图片块流入后同一张卡内完成动画→图片的浮现；只队尾消息可能有在途图片，历史消息不补。
    const isLastMsg = msg === messages[messages.length - 1]
    groupBlocks(msg.content).forEach((g, gi) => {
      // 工具调用/thinking 抽离到全局 ToolSpot / ThinkSpot，不落卡；
      // 但 GenerateImage 未出结果时落一张「生成中」占位卡，结果到达后由真实图片卡替换
      if (g.kind === 'toolflow') {
        pairTools(g.blocks).tools.forEach((p, pi) => {
          if (p.use.type !== 'tool_use') return
          if (p.use.name === 'GenerateImage') {
            const n = genIdx++
            if (!p.result) {
              r.artifactCards.push({ id: `${msg.id}:gen${n}`, kind: 'image', ...genMeta(p.use.input), timestamp: msg.timestamp })
            } else if (!p.result.is_error) {
              completedGens.push({ n, input: p.use.input })
            }
            return
          }
          // Write 生成 .html（可交互网页/小游戏）→ WebScreen 卡，写入完成后出现
          if (p.use.name === 'Write' && p.result && !p.result.is_error) {
            const input = p.use.input
            const filePath = typeof input?.file_path === 'string' ? input.file_path : ''
            const content = typeof input?.content === 'string' ? input.content : ''
            if (/\.html?$/i.test(filePath) && content) {
              r.artifactCards.push({
                id: `${msg.id}:web${gi}-${pi}`,
                kind: 'web',
                html: content,
                label: filePath.split(/[/\\]/).pop(),
                timestamp: msg.timestamp,
              })
            } else if (content && CODE_FILE_RE.test(filePath)) {
              const fileName = filePath.split(/[/\\]/).pop()
              if (fileName) writeFiles.push({ fileName, content })
            }
          }
        })
        return
      }
      const b = g.block
      if (b.type === 'text' && b.text?.trim()) {
        // 代码块抽离为产物卡（StageCodeCard 渲染），剩余文字走旁白/批注；
        // 围栏代码块与本消息 Write 写入的代码文件内容匹配时，头栏挂上真实文件名
        const { prose: proseNoCode, codeBlocks } = extractCodeBlocks(b.text)
        codeBlocks.forEach((cb, ci) => {
          const snippet = cb.code.trim().slice(0, 80)
          const wf = snippet ? writeFiles.find((w) => w.content.includes(snippet)) : undefined
          r.artifactCards.push({ id: `${msg.id}:cd${gi}-${ci}`, kind: 'code', code: cb.code, language: cb.language || undefined, label: wf?.fileName, caption: cb.caption, timestamp: msg.timestamp })
        })
        // 正文中的图片路径引用（skill/Bash 生图等非 GenerateImage 路径）抽为图片卡
        const { prose, images } = extractImageRefs(proseNoCode)
        images.forEach((src, ii) => {
          if (r.artifactCards.some((c) => c.kind === 'image' && c.block?.src === src)) return
          r.artifactCards.push({ id: `${msg.id}:imt${gi}-${ii}`, kind: 'image', block: { type: 'image', src }, timestamp: msg.timestamp })
        })
        if (prose.trim()) r.textSegments.push(prose)
      }
      else if (b.type === 'image' && b.src) {
        const gen = completedGens.shift()
        if (gen) r.artifactCards.push({ id: `${msg.id}:gen${gen.n}`, kind: 'image', block: b, ...genMeta(gen.input), timestamp: msg.timestamp })
        // 正文引用已落卡的同图不重复落卡
        else if (!r.artifactCards.some((c) => c.kind === 'image' && c.block?.src === b.src)) {
          r.artifactCards.push({ id: `${msg.id}:im${gi}`, kind: 'image', block: b, timestamp: msg.timestamp })
        }
      }
      else if (b.type === 'file') r.artifactCards.push({ id: `${msg.id}:fl${gi}`, kind: 'file', block: b, timestamp: msg.timestamp })
    })
    // 已出结果但图片块尚未流入（IPC 空窗）→ 占位卡保持生成中，等图片块到达后同 id 换图
    if (isLastMsg) {
      completedGens.forEach((gen) =>
        r.artifactCards.push({ id: `${msg.id}:gen${gen.n}`, kind: 'image', ...genMeta(gen.input), timestamp: msg.timestamp }),
      )
    }
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
  // 批注 = 生成过程的文字摘要；若文字全被引导短句吸收成卡片 caption，用 caption 兜底，保证批注按钮不消失
  const focusAnnotations = focusRound && focusHasArtifact
    ? (focusRound.textSegments.length > 0
        ? focusRound.textSegments
        : focusRound.artifactCards.map((c) => c.caption).filter((c): c is string => !!c))
    : []

  const cards: StageCardEntry[] = []
  // 画布只展示焦点轮（默认最新轮）的产物；发出新指令等待回复时清空画布等待当前交互。
  // 旧轮产物不堆积——通过消息列表选中回看；CoverFlow 走 listSessionImageCards 全量数据源。
  const cardRounds = awaitingReply || !focusRound ? [] : [focusRound]
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

/** 会话内全部已出图的图片卡（CoverFlow 数据源：不随焦点轮切换/画布清空变化） */
export function listSessionImageCards(messages: ChatMessage[]): StageCardData[] {
  return groupRounds(messages).flatMap((r) =>
    r.artifactCards.filter((c) => c.kind === 'image' && c.block?.src),
  )
}
