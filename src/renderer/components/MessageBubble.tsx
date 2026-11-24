import React, { useState, useEffect, useMemo, memo, useCallback } from 'react'
import { useImageSrc } from '../hooks/useImageSrc'
import { ChatMessage, ContentBlock } from '../../shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { groupBlocks, pairTools, deriveUnitStatus, TIMELINE, type UnitStatus } from './toolflow-utils'
import { ToolflowUnit } from './ToolflowUnit'
import { BotAvatar } from './BotList'
import { useRoutineStore } from '../stores/routineStore'
import { useChatStore } from '../stores/chatStore'

interface Props {
  message: ChatMessage
  prevRole?: MessageRole
  onRetry?: (message: ChatMessage) => void
  /** 该消息是否正在流式输出（用于思考块自动展开/收缩） */
  isStreaming?: boolean
}

// ─── URL handling ───────────────────────────────────────

const URL_RE = /https?:\/\/[^\s]+/g
const GITHUB_URL_RE = /https?:\/\/github\.com\/[^\s]+/g

function LinkIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 -54 1132 1132" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M567.946541 498.230212m-449.210729 0a449.210729 449.210729 0 1 0 898.421459 0 449.210729 449.210729 0 1 0-898.421459 0Z" opacity="0.15" />
      <path d="M477.3888 0C213.907576 0 0 223.135624 0 497.965176 0 772.806776 213.907576 995.930353 477.3888 995.930353c-241.230306-14.022776-437.067294-232.327529-437.067294-497.965177S236.158494 14.022776 477.3888 0zM643.409318 5.12c263.469176 0 477.376753 223.135624 477.376753 497.965176 0 274.8416-213.907576 497.965176-477.376753 497.965177 241.218259-14.010729 437.055247-232.315482 437.055247-497.965177 0-265.637647-195.836988-483.9424-437.055247-497.965176z" opacity="0.3" />
      <path d="M528.384 29.057506c-19.468047 0-35.273788 218.762541-35.273788 488.207059 0 269.456565 15.805741 488.207059 35.273788 488.207059-4.867012-122.048753-8.818447-298.791153-8.818447-488.207059 0-189.415906 3.951435-366.146259 8.818447-488.207059z" opacity="0.25" />
      <path d="M18.697035 487.171012c0 28.949082 237.796894 52.452894 530.697036 52.452894s530.697035-23.503812 530.697035-52.452894c-132.674259 7.240282-324.800753 13.119247-530.697035 13.119247s-398.022776-5.878965-530.697036-13.119247z" opacity="0.25" />
      <path d="M30.3104 527.7696c0 139.264 235.965741 252.325647 526.613082 252.325647s526.625129-113.061647 526.62513-252.325647c-24.070024 120.157365-251.759435 217.714447-526.62513 217.714447S54.380424 647.926965 30.3104 527.7696z" opacity="0.25" />
      <path d="M484.424282 10.252047c-139.251953 0-252.3136 224.087341-252.3136 500.097506 0 276.022212 113.061647 500.109553 252.3136 500.109553-120.157365-22.853271-217.714447-239.073882-217.714447-500.109553 0-261.023624 97.557082-477.244235 217.714447-500.097506z" opacity="0.25" />
      <path d="M28.178071 440.464565c0-139.264 238.748612-252.325647 532.829364-252.325647 294.080753 0 532.829365 113.061647 532.829365 252.325647-24.359153-120.169412-254.723012-217.726494-532.829365-217.726494S52.537224 320.295153 28.178071 440.464565z" opacity="0.25" />
      <path d="M595.437929 19.6608c139.264 0 252.325647 224.087341 252.325647 500.097506 0 276.022212-113.061647 500.109553-252.325647 500.109553C715.595294 997.014588 813.152376 780.793976 813.152376 519.758306c0-261.023624-97.557082-477.244235-217.714447-500.097506z" opacity="0.25" />
    </svg>
  )
}

function GithubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" style={{ flexShrink: 0 }}>
      <path d="M94,7399 C99.523,7399 104,7403.59 104,7409.253 C104,7413.782 101.138,7417.624 97.167,7418.981 C96.66,7419.082 96.48,7418.762 96.48,7418.489 C96.48,7418.151 96.492,7417.047 96.492,7415.675 C96.492,7414.719 96.172,7414.095 95.813,7413.777 C98.04,7413.523 100.38,7412.656 100.38,7408.718 C100.38,7407.598 99.992,7406.684 99.35,7405.966 C99.454,7405.707 99.797,7404.664 99.252,7403.252 C99.252,7403.252 98.414,7402.977 96.505,7404.303 C95.706,7404.076 94.85,7403.962 94,7403.958 C93.15,7403.962 92.295,7404.076 91.497,7404.303 C89.586,7402.977 88.746,7403.252 88.746,7403.252 C88.203,7404.664 88.546,7405.707 88.649,7405.966 C88.01,7406.684 87.619,7407.598 87.619,7408.718 C87.619,7412.646 89.954,7413.526 92.175,7413.785 C91.889,7414.041 91.63,7414.493 91.54,7415.156 C90.97,7415.418 89.522,7415.871 88.63,7414.304 C88.63,7414.304 88.101,7413.319 87.097,7413.247 C87.097,7413.247 86.122,7413.234 87.029,7413.87 C87.029,7413.87 87.684,7414.185 88.139,7415.37 C88.139,7415.37 88.726,7417.2 91.508,7416.58 C91.513,7417.437 91.522,7418.245 91.522,7418.489 C91.522,7418.76 91.338,7419.077 90.839,7418.982 C86.865,7417.627 84,7413.783 84,7409.253 C84,7403.59 88.478,7399 94,7399" transform="translate(-84, -7399)" />
    </svg>
  )
}

function UrlLink({ url }: { url: string }) {
  const isGithub = GITHUB_URL_RE.test(url)
  // Reset lastIndex because test() with global regex advances lastIndex
  GITHUB_URL_RE.lastIndex = 0

  let label: string
  try {
    const u = new URL(url)
    if (isGithub) {
      const parts = u.pathname.split('/').filter(Boolean)
      label = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : u.hostname
    } else {
      label = u.hostname
    }
  } catch {
    label = url.length > 40 ? url.slice(0, 37) + '…' : url
  }

  return (
    <a
      href={url}
      onClick={(e) => { e.preventDefault(); window.claude?.openInBrowser?.('url', url) }}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 transition-colors"
      style={{
        background: 'var(--bg-surface-container-high)',
        border: '1px solid var(--border-subtle)',
        color: isGithub ? 'var(--text-on-surface)' : 'var(--accent-primary)',
        fontSize: '12px',
        textDecoration: 'none',
        cursor: 'pointer',
        verticalAlign: 'middle',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.8' }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
    >
      {isGithub ? <GithubIcon size={13} /> : <LinkIcon size={13} />}
      <span className="truncate" style={{ maxWidth: 300 }}>{label}</span>
    </a>
  )
}

function RichText({ text }: { text: string }) {
  const parts = text.split(URL_RE)
  const urls = text.match(URL_RE) || []
  if (urls.length === 0) return <>{text}</>
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {urls[i] && <UrlLink url={urls[i]} />}
        </span>
      ))}
    </>
  )
}

function UserAvatar() {
  return (
    <div
      className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-medium"
      style={{
        background: '#26251e',
        color: '#f7f7f4',
      }}
    >
      U
    </div>
  )
}

function formatMessageTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getMessageText(message: ChatMessage): string {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
}

function UserCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
  }, [text])

  if (!text) return null

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center justify-center transition-colors"
      title={copied ? 'Copied' : 'Copy'}
      style={{
        width: 24,
        height: 24,
        color: copied ? 'var(--accent-primary)' : 'var(--text-outline)',
        background: 'transparent',
        border: 'none',
        borderRadius: 6,
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      {copied ? (
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 5" />
        </svg>
      ) : (
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="4" width="8" height="9" rx="2" />
          <path d="M3 11V4.5A1.5 1.5 0 014.5 3H10" />
        </svg>
      )}
    </button>
  )
}

export const MessageBubble = memo(function MessageBubble({ message, prevRole, onRetry, isStreaming }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const sameRole = prevRole === message.role
  const handleRetry = useCallback(() => { onRetry?.(message) }, [onRetry, message])

  /*
   * 思考：内容在工具流里，开关在卡片头部的火花图标上。
   *
   * 状态必须提到这里 —— 图标和正文不在同一个子树里。默认收起：思考是过程，
   * 不该抢正文的位置；但进行中要自动展开，否则用户看不出它还在动。
   */
  const thinkInfo = useMemo(() => {
    if (message.role !== 'assistant') return null
    const groups = groupBlocks(message.content)
    const flows = groups.filter((g) => g.kind === 'toolflow') as Array<{ kind: 'toolflow'; blocks: ContentBlock[] }>
    const text = flows.map((f) => pairTools(f.blocks).reasoningText).join('')
    if (!text.trim()) return null
    const status: UnitStatus = flows.some((f) => deriveUnitStatus(f.blocks) === 'active') ? 'active' : 'done'
    return { text, status }
  }, [message])
  const [thinkOpen, setThinkOpen] = useState(false)
  const thinkWorking = thinkInfo?.status === 'active'
  // 进行中自动展开、结束自动收起；用户手动点过之后就不再干预。
  const [thinkTouched, setThinkTouched] = useState(false)
  useEffect(() => {
    if (thinkTouched) return
    setThinkOpen(thinkWorking)
  }, [thinkWorking, thinkTouched])
  const mb = sameRole ? 'mb-2' : ''

  if (isSystem) {
    return (
      <div className="flex justify-center animate-fade-in py-2" data-slot="message" data-from="system">
        <span
          className="px-3 py-1 rounded-full"
          style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-outline)', background: 'var(--bg-surface-container)' }}
        >
          {message.content.map((block, i) => <span key={i}>{block.text}</span>)}
        </span>
      </div>
    )
  }

  if (isUser) {
    const textBlocks = message.content.filter((b) => b.type === 'text' && b.text)
    const imageBlocks = message.content.filter((b) => b.type === 'image' && b.src)
    const fileBlocks = message.content.filter((b) => b.type === 'file')
    const text = getMessageText(message)

    return (
      <div className="animate-fade-in flex flex-col items-end" data-slot="message" data-from="user" style={{ marginBottom: sameRole ? 6 : 32 }}>
        {/* Image thumbnails */}
        {imageBlocks.length > 0 && (
          <div className="flex gap-1.5 mb-1.5">
            {imageBlocks.map((block, i) => (
              <div key={i} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)', maxWidth: 260 }}>
                <ImageView src={block.src!} />
              </div>
            ))}
          </div>
        )}

          {/* File attachments */}
        {fileBlocks.map((block, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg mb-1"
            style={{ background: 'var(--bg-surface-container-high)', border: '1px solid var(--border-subtle)', fontSize: '11px', color: 'var(--text-on-surface-variant)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{block.fileName}</span>
            <span style={{ color: 'var(--text-outline-variant)' }}>
              {block.fileSize != null ? (block.fileSize < 1024 ? `${block.fileSize} B` : block.fileSize < 1048576 ? `${(block.fileSize / 1024).toFixed(1)} KB` : `${(block.fileSize / 1048576).toFixed(1)} MB`) : ''}
            </span>
          </div>
        ))}

        {/* Text bubble */}
        {textBlocks.length > 0 && (
          <div
            className="user-bubble rounded-lg"
            style={{
              padding: '5px 9px',
              display: 'inline-block',
              maxWidth: '80%',
              wordBreak: 'break-word',
            }}
          >
            {textBlocks.map((block, i) => (
              <p key={i} className="whitespace-pre-wrap"
                style={{ color: 'var(--text-on-user-bubble)', fontSize: '12.5px', lineHeight: 1.55 }}>
                <RichText text={block.text} />
              </p>
            ))}
          </div>
        )}

        {/* Timestamp + copy button */}
        <div className="flex items-center justify-end gap-1 mt-1" style={{ paddingRight: 2 }}>
          <span style={{ fontSize: '10px', color: 'var(--text-outline-variant)' }}>
            {formatMessageTime(message.timestamp)}
          </span>
          <UserCopyButton text={text} />
        </div>
      </div>
    )
  }

  /*
   * 另一个 Bot 的答复（交接的 relay 落地）。
   *
   * 刻意**不走** renderBlocks：那段话里没有工具调用、没有 thinking，它就是一段正文，
   * 需要的只是一个落款 —— 谁是说的。画上它的头像和名字，用户看到的就是
   * 「我问的那个 Bot 回来答了」，而不是「本会话的 Bot 忽然用别人的口气讲话」。
   *
   * 这个分支必须排在普通 assistant 之前：否则 answeredBy 只被当成装饰，
   * 那段话会被当成当前 Bot 的正文渲染，落款等于没生效。
   */
  if (message.answeredBy) {
    const text = getMessageText(message)
    return (
      <div className="animate-fade-in" data-slot="message" data-from="assistant" style={{ marginBottom: sameRole ? 8 : 20 }}>
        <HandoffSpeaker botId={message.answeredBy} name={message.answeredByName} />
        <div
          className="rounded-lg"
          style={{
            background: 'var(--bg-surface-container)',
            padding: '6px 10px',
            border: '1px solid var(--border-subtle)',
            display: 'inline-block',
            maxWidth: '80%',
            wordBreak: 'break-word',
            marginTop: 4,
          }}
        >
          <p className="whitespace-pre-wrap" style={{ color: 'var(--text-on-surface)', fontSize: '12.5px', lineHeight: 1.55 }}>
            <RichText text={text} />
          </p>
        </div>
        <div className="flex items-center gap-1 mt-1" style={{ paddingRight: 2 }}>
          <span style={{ fontSize: '10px', color: 'var(--text-outline-variant)' }}>
            {formatMessageTime(message.timestamp)}
          </span>
          <UserCopyButton text={text} />
        </div>
      </div>
    )
  }

  // Assistant message: 归组分发
  /*
   * 这条消息里作为 image block 出现的图。正文里的同名引用会被它挡掉。
   *
   * 事故现场：模型在正文里写了 `![晨报](...png)`，同时 moveImageToGallery 的产物
   * 又被追加成 image block —— 同一张图渲染两遍，用户看到两份晨报。
   * 两个来源都是合法数据，只能在渲染层去重。
   */
  const imageBlockKeys = new Set(
    message.content.filter((b) => b.type === 'image' && b.src).map((b) => imageKey(b.src as string)),
  )
  /*
   * 图片从卡片里拿出来单独排。
   *
   * 事故现场：晨报这种一张 900×2400 的长图塞进气泡卡片，卡片有 8px/12px 的内边距
   * 加描边，于是图片四周多出一圈深灰底色 —— 深灰框包着米白大图，两边都不像。
   *
   * 卡片是「一段话」的容器，图片是「一件东西」。混在一起时两种尺寸体系打架：
   * 文字要窄边距才读得舒服，图片要撑满才显得完整。
   */
  const imageBlocks = message.content.filter((b) => b.type === 'image' && b.src)
  const cardContent = message.content.filter((b) => b.type !== 'image')

  /*
   * 把一行消息切成「段」，而不是一律平铺。
   *
   * 参考形态（用户给的那张）：工具链**裸排**在页面背景上，正文则被一个
   * 圆角卡片包住 —— 两段视觉性质不同的内容，各自用合适的容器：
   *   · 工具链是「过程」，读的时候是扫一眼，越轻越好，不该有边框；
   *   · 正文是「结论」，是用户真正要读的东西，需要一个边界把视线框住，
   *     否则它会和上面的工具行连成一片、分不清哪句是总结。
   *
   * 连续的 inline 块（text / image 之外的所有块）合并进同一张卡片 ——
   * 一句话被拆成多个 text block 是模型分段造成的，不该渲染成多个盒子。
   */
  type Segment =
    | { kind: 'toolflow'; blocks: ContentBlock[] }
    | { kind: 'card'; blocks: ContentBlock[] }

  const segments: Segment[] = []
  for (const group of groupBlocks(cardContent)) {
    if (group.kind === 'toolflow') {
      segments.push({ kind: 'toolflow', blocks: group.blocks })
    } else {
      const last = segments[segments.length - 1]
      if (last && last.kind === 'card') last.blocks.push(group.block)
      else segments.push({ kind: 'card', blocks: [group.block] })
    }
  }

  const renderSegments = () =>
    segments.map((seg, idx) => {
      if (seg.kind === 'toolflow') {
        return (
          <ToolflowUnit
            key={`tf-${idx}`}
            blocks={seg.blocks}
            isStreaming={isStreaming}
            {...(thinkInfo ? { think: { open: thinkOpen, onToggle: () => { setThinkTouched(true); setThinkOpen((v) => !v) } } } : {})}
          />
        )
      }
      return (
        <div key={`card-${idx}`} className="assistant-card">
          {seg.blocks.map((block, i) => (
            <ContentBlockView key={`in-${i}`} block={block} skipImages={imageBlockKeys} />
          ))}
        </div>
      )
    })
  const fileRefs = message.content
    .filter((b) => b.type === 'tool_use' && (b.name === 'Write' || b.name === 'Edit'))
    .map((b) => b.input?.file_path as string)
    .filter(Boolean)

  return (
    <div className="animate-fade-in" data-slot="message" data-from="assistant" style={{ marginBottom: sameRole ? 14 : 34 }}>
      <SpeakerLine
        {...(thinkInfo
          ? {
              think: {
                working: thinkWorking,
                open: thinkOpen,
                onToggle: () => {
                  setThinkTouched(true)
                  setThinkOpen((v) => !v)
                },
              },
            }
          : {})}
        />

      {/* 工具链裸排、正文装卡片 —— 见上面 segments 的说明 */}
      <div className="toolflow-body">
        {renderSegments()}
        {fileRefs.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {[...new Set(fileRefs)].map((fp, i) => <FileReferenceCard key={i} filePath={fp} />)}
          </div>
        )}
        {imageBlocks.map((b, i) => (
          <ImageView key={`img-${i}`} src={b.src as string} />
        ))}
      </div>

      <MessageActions message={message} onRetry={handleRetry} />
    </div>
  )
})

/**
 * 正文归属：这一轮是哪个 Bot 在说话。
 *
 * 只在「换人」时画一次（`!sameRole`）—— 连续多条 assistant 消息属于同一轮，
 * 每句都标一遍反而吵。
 *
 * 取的是当前 activeBot：用户在一个会话里看到的助手消息，就是这个会话绑定的 Bot
 * 说的。这个假设在多 Bot 下成立的前提是「一个会话只属于一个 Bot」—— 当前代码确实如此
 * （session meta 里存 botId），交接答复那一路另有 answeredBy 走 HandoffSpeaker。
 */
function SpeakerLine({ think }: {
  /**
   * 思考开关键：有思考内容时才出现，画在名字右边。
   *
   * 为什么放这儿 —— 「思考完成」那行字原来是卡片内单独的一行 header，
   * 视觉上把一条消息切成了两段。它本来就是这条消息的属性，和名字同级。
   */
  think?: { working: boolean; open: boolean; onToggle: () => void }
}) {
  const activeBotId = useChatStore((s) => s.activeBotId)
  const bots = useRoutineStore((s) => s.bots)
  const bot = activeBotId ? bots.find((b) => b.id === activeBotId) ?? null : null
  if (!bot) return null
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 7,
      }}
    >
      <BotAvatar bot={bot} size={20} animate={false} />
      <span style={{ fontSize: 11.5, fontWeight: 650, color: 'var(--text-on-surface)' }}>
        {bot.name}
      </span>
      {bot.group ? (
        <span style={{ fontSize: 8.5, color: 'var(--text-outline-variant)' }}>· {bot.group}</span>
      ) : null}
      {think && <ThinkToggle {...think} />}
    </div>
  )
}

/**
 * 火花图标：思考的开关，贴在名字右边。
 *
 * 不带文字。原来那行「思考完成」有 13px 字重加换行，在一条短消息里比正文还显眼；
 * 而它想表达的只是「这条消息里有思考过程，点开能看」。一个图标就够了。
 * 进行中时图标换成流光/旋转，把「还在想」这个信息留在原地。
 */
function ThinkToggle({ working, open, onToggle }: { working: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={working ? '思考中' : '思考过程'}
      aria-expanded={open}
      aria-label={working ? '思考中' : '思考过程'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        marginLeft: 1,
        borderRadius: 5,
        cursor: 'pointer',
        background: open ? 'var(--bg-surface-container-high)' : 'transparent',
        border: 'none',
        color: working ? 'var(--text-on-surface)' : 'var(--text-outline-variant)',
        transition: 'background .12s, color .12s',
      }}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="currentColor"
        style={{
          animation: working ? 'think-spark 1.2s ease-in-out infinite' : undefined,
          transformOrigin: 'center',
        }}
      >
        <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
      </svg>
    </button>
  )
}

/**
 * 交接答复的落款：谁在说这段话。
 *
 * 头像是那个 Bot 自己的（同一个 BotAvatar 组件，侧栏里长什么样这里就长什么样），
 * 所以用户不需要读名字也能认出「这是我问的那个」。
 *
 * 找不到 Bot（刚被删掉）时退回一个名字方块：答案已经写进会话了，
 * 落款丢了比头像难看糟糕得多。
 */
function HandoffSpeaker({ botId, name }: { botId: string; name?: string }) {
  const bots = useRoutineStore((s) => s.bots)
  const bot = bots.find((b) => b.id === botId)
  const label = bot?.name || name || 'Bot'

  return (
    <div className="flex items-center gap-1.5">
      {bot ? (
        <BotAvatar bot={bot} size={18} animate={false} />
      ) : (
        <div
          className="shrink-0 rounded-full flex items-center justify-center"
          style={{ width: 18, height: 18, background: 'var(--bg-surface-container-high)', fontSize: 9, color: 'var(--text-on-surface-variant)' }}
        >
          {label.slice(0, 1)}
        </div>
      )}
      <span style={{ fontSize: '11px', color: 'var(--text-on-surface-variant)' }}>{label}</span>
      <span style={{ fontSize: '10px', color: 'var(--text-outline-variant)' }}>· 交接答复</span>
    </div>
  )
}

function FileReferenceCard({ filePath }: { filePath: string }) {
  const fileName = filePath.split(/[\\]/).pop() || filePath

  const handleOpen = () => {
    window.claude.openInBrowser('file', filePath)
  }

  /* 裸行：不套容器（无边框/底色/内边距），只剩 图标+文件名，点哪儿都是打开。
     完整路径放 title 兜底；行内截断，不撑破消息列。 */
  return (
    <button
      type="button"
      className="flex items-center gap-2 max-w-full cursor-pointer transition-opacity hover:opacity-80"
      onClick={handleOpen}
      title={filePath}
      style={{ background: 'transparent', border: 'none', padding: '3px 0', textAlign: 'left' }}
    >
      <svg
        className="shrink-0"
        width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text-warning)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      >
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span
        className="truncate"
        style={{ fontSize: '11.5px', lineHeight: 1.35, color: 'var(--text-on-surface)' }}
      >
        {fileName}
      </span>
    </button>
  )
}

const CopyButton = memo(function CopyButton({ fullText }: { fullText: string }) {
  const [copied, setCopied] = useState(false)
  const handleClick = useCallback(() => {
    navigator.clipboard.writeText(fullText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }, [fullText])

  return (
    <button
      onClick={handleClick}
      className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
      style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline)', background: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)'; e.currentTarget.style.color = 'var(--text-on-surface-variant)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-outline)' }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8l3.5 3.5L13 5" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M3 11V3.5A.5.5 0 013.5 3H11" />
        </svg>
      )}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
})

const RetryButton = memo(function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      onClick={onRetry}
      className="flex items-center gap-1 px-2 py-1 rounded-md transition-colors"
      style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline)', background: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container)'; e.currentTarget.style.color = 'var(--text-on-surface-variant)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-outline)' }}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 8a6 6 0 0110.47-4M14 8a6 6 0 01-10.47 4" />
        <path d="M14 2v4h-4M2 14v-4h4" />
      </svg>
      <span>Retry</span>
    </button>
  )
})

const FeedbackButtons = memo(function FeedbackButtons() {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null)

  return (
    <>
      <button
        onClick={() => setFeedback(feedback === 'up' ? null : 'up')}
        className="flex items-center px-2 py-1 rounded-md transition-colors"
        style={{
          fontSize: 'var(--fs-xs)',
          color: feedback === 'up' ? TIMELINE.done : 'var(--text-outline)',
          background: feedback === 'up' ? 'rgba(192,133,50,0.1)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!feedback || feedback !== 'up') { e.currentTarget.style.background = 'var(--bg-surface-container)'; e.currentTarget.style.color = 'var(--text-on-surface-variant)' } }}
        onMouseLeave={(e) => { if (feedback !== 'up') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-outline)' } }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill={feedback === 'up' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 14V7.5L2 7.5V14h3zM5 7.5L8 2a2 2 0 012 2v3.5h3.5a1.5 1.5 0 011.46 1.85l-1.2 5A1.5 1.5 0 0112.3 15H5" />
        </svg>
      </button>
      <button
        onClick={() => setFeedback(feedback === 'down' ? null : 'down')}
        className="flex items-center px-2 py-1 rounded-md transition-colors"
        style={{
          fontSize: 'var(--fs-xs)',
          color: feedback === 'down' ? TIMELINE.error : 'var(--text-outline)',
          background: feedback === 'down' ? 'rgba(207,45,86,0.1)' : 'transparent',
        }}
        onMouseEnter={(e) => { if (!feedback || feedback !== 'down') { e.currentTarget.style.background = 'var(--bg-surface-container)'; e.currentTarget.style.color = 'var(--text-on-surface-variant)' } }}
        onMouseLeave={(e) => { if (feedback !== 'down') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-outline)' } }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill={feedback === 'down' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 2v6.5L14 8.5V2h-3zM11 8.5L8 14a2 2 0 01-2-2v-3.5H2.5A1.5 1.5 0 011.04 6.65l1.2-5A1.5 1.5 0 013.7 1H11" />
        </svg>
      </button>
    </>
  )
})

function MessageActions({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const fullText = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  if (!fullText) return null

  return (
    <div
      className="flex items-center gap-1 mt-2 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200"
      style={{ transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
    >
      <CopyButton fullText={fullText} />
      {onRetry && <RetryButton onRetry={onRetry} />}
      <FeedbackButtons />
      {message.cost !== undefined && (
        <span
          className="tabular-nums px-1.5"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline-variant)' }}
        >
          ${message.cost.toFixed(3)}
        </span>
      )}
    </div>
  )
}

/**
 * 图片路径的归一化键：只取文件名，统一小写、正斜杠。
 *
 * 同一张图在这条消息里会以两种形态各出现一次：
 *   1. 正文里的 markdown 链接（模型自己写的 `![](H:\...\x.png)`）
 *   2. 系统追加的 image block（产物图自动入消息）
 * 两条路径的写法可能一个反斜杠一个正斜杠，所以按键比对而不是直接比字符串。
 */
function imageKey(src: string): string {
  const base = src.split(/[\/]/).pop() ?? src
  return base.toLowerCase()
}

const IMAGE_PATH_RE = /(?<!\w)[\w\\/:\-.]+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/gi

function isImageUrl(src: string): boolean {
  return /^https?:\/\//i.test(src)
}

function ImageView({ src }: { src: string }) {
  const [error, setError] = useState(false)
  const label = src.split(/[/\\]/).pop() || src
  const isLocal = !src.startsWith('data:') && !isImageUrl(src)
  const localSrc = useImageSrc(isLocal ? src : null)
  if (error) {
    return (
      <div className="my-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-surface-container)', color: 'var(--text-outline)', border: '1px solid var(--border-subtle)' }}>
        Image not found: {label}
      </div>
    )
  }

  const resolved = isLocal ? (localSrc ?? '') : src

  return (
    <div style={{ marginTop: 6 }}>
      {resolved && (
        <img
          src={resolved}
          alt={label}
          className="rounded-xl max-w-full max-h-[512px] object-contain"
          style={{ border: '1px solid var(--border-subtle)', display: 'block' }}
          onError={() => setError(true)}
        />
      )}
    </div>
  )
}

function extractText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (React.isValidElement(children) && (children as any).props.children)
    return extractText((children as any).props.children)
  return ''
}

function CodeBlock({ language, codeText, children }: {
  language?: string; codeText?: string; children: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    if (!codeText) return
    navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  const hasHeader = !!language || !!codeText
  const lines = codeText?.split('\n') || []
  const showLineNumbers = !!language && lines.length > 3

  return (
    <div className="group/code" style={{ borderRadius: '8px', overflow: 'hidden', marginBlock: '0.75rem', border: '1px solid var(--border-subtle)', fontFamily: "'JetBrains Mono', 'Fira Code', var(--font-mono)" }}>
      {hasHeader && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: 'var(--bg-surface-container)' }}>
          {language ? (
            <span style={{ fontSize: '10px', color: 'var(--text-outline-variant)', fontFamily: 'var(--font-mono)' }}>
              {language}
            </span>
          ) : <span />}
          {codeText && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 opacity-0 group-hover/code:opacity-100 transition-opacity"
              style={{ fontSize: '10px', color: copied ? '#34d399' : 'var(--text-outline-variant)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px', borderRadius: 'var(--radius-sm)' }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8l3.5 3.5L13 5" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="5" width="8" height="8" rx="1.5" />
                  <path d="M3 11V3.5A.5.5 0 013.5 3H11" />
                </svg>
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', background: 'var(--bg-surface-container-lowest)', overflowX: 'auto' }}>
        {showLineNumbers && (
          <div
            style={{
              padding: '8px 0',
              paddingRight: '8px',
              paddingLeft: '10px',
              textAlign: 'right',
              userSelect: 'none',
              color: 'var(--text-outline-variant)',
              fontSize: '11px',
              lineHeight: '1.65',
              flexShrink: 0,
              minWidth: '32px',
              opacity: 0.5,
            }}
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <pre style={{ margin: 0, border: 'none', borderRadius: 0, background: 'transparent', overflowX: 'auto', flex: 1 }}>
          {children}
        </pre>
      </div>
    </div>
  )
}

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: any) => (
    <h1 className="font-bold" style={{ color: 'var(--text-on-surface)', fontSize: 'clamp(18px, calc(18px + 0.3vw), 22px)', lineHeight: 1.3, marginTop: '2em', marginBottom: '0.75em', paddingBottom: '0.5em', borderBottom: '1px solid var(--border-subtle)' }}>
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="font-semibold" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-lg)', marginTop: '1.6em', marginBottom: '0.6em', paddingBottom: '0.4em', borderBottom: '1px solid var(--border-subtle)' }}>
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="font-semibold" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-md)', marginTop: '1.3em', marginBottom: '0.5em' }}>
      {children}
    </h3>
  ),
  h4: ({ children }: any) => (
    <h4 className="font-bold" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-base)', lineHeight: 1.4, marginTop: '1.1em', marginBottom: '0.4em' }}>
      {children}
    </h4>
  ),
  h5: ({ children }: any) => (
    <h5 className="font-medium" style={{ color: 'var(--text-on-surface-variant)', fontSize: 'var(--fs-sm)', lineHeight: 1.4, marginTop: '1em', marginBottom: '0.3em' }}>
      {children}
    </h5>
  ),
  h6: ({ children }: any) => (
    <h6 className="font-medium" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.4, marginTop: '1em', marginBottom: '0.3em' }}>
      {children}
    </h6>
  ),
  p: ({ children }: any) => (
    <p className="my-4" style={{ color: 'var(--text-on-surface)', lineHeight: '1.7' }}>
      {children}
    </p>
  ),
  code: ({ className, children, node, ...props }: any) => {
    const isInPre = node?.parent?.tagName === 'pre'
    if (!className && !isInPre) {
      return <code style={{ color: '#60a5fa', fontFamily: 'var(--font-mono)' }} {...props}>{children}</code>
    }
    return <code className={className} {...props}>{children}</code>
  },
  pre: ({ children }: any) => {
    let language: string | undefined
    let codeText: string | undefined
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === 'code') {
        const match = ((child as any).props.className || '').match(/language-(\w+)/)
        if (match) language = match[1]
        codeText = extractText((child as any).props.children)
      }
    })
    return <CodeBlock language={language} codeText={codeText}>{children}</CodeBlock>
  },
  a: ({ children, href }: any) => (
    <a
      href={href}
      className="no-underline hover:underline"
      style={{ color: 'var(--accent-primary)', borderBottom: '1px solid transparent', transition: 'border-color 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderBottomColor = 'var(--accent-primary)' }}
      onMouseLeave={(e) => { e.currentTarget.style.borderBottomColor = 'transparent' }}
      onClick={(e) => { e.preventDefault(); window.claude?.openInBrowser?.('url', href) }}
    >
      {children}
    </a>
  ),
  strong: ({ children }: any) => (
    <strong className="font-bold" style={{ color: 'var(--text-on-surface)' }}>
      {children}
    </strong>
  ),
  em: ({ children }: any) => (
    <em className="italic" style={{ color: 'var(--text-on-surface-variant)' }}>
      {children}
    </em>
  ),
  ol: ({ children }: any) => (
    <ol className="my-3" style={{ paddingLeft: '1.5em' }}>
      {children}
    </ol>
  ),
  ul: ({ children }: any) => (
    <ul className="my-3" style={{ paddingLeft: '1.5em' }}>
      {children}
    </ul>
  ),
  li: ({ children }: any) => (
    <li className="leading-relaxed mb-1" style={{ color: 'var(--text-on-surface)', fontSize: '12.5px' }}>
      {children}
    </li>
  ),
  blockquote: ({ children }: any) => (
    <blockquote
      className="border-l-[3px] pl-4 my-3"
      style={{
        borderColor: 'var(--accent-primary)',
        color: 'var(--text-on-surface-variant)',
        background: 'rgba(173, 198, 255, 0.04)',
        borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        padding: '8px 14px',
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-8" style={{ border: 'none', height: 1, background: 'linear-gradient(90deg, transparent, var(--border-default), transparent)' }} />
  ),
  table: ({ children }: any) => (
    <div className="my-3 overflow-x-auto" style={{ borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
      <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }: any) => (
    <th
      className="text-left py-2.5 px-3 font-medium text-[11px]"
      style={{
        color: 'var(--text-outline)',
        borderBottom: '2px solid var(--border-default)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        background: 'var(--bg-surface-container)',
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }: any) => (
    <td
      className="py-2 px-3"
      style={{
        color: 'var(--text-on-surface)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {children}
    </td>
  ),
  img: ({ src, alt }: any) => {
    if (src && IMAGE_PATH_RE.test(src)) {
      return <ImageView src={src} />
    }
    return <img src={src} alt={alt} className="rounded-xl max-w-full max-h-[512px] object-contain my-2" style={{ border: '1px solid var(--border-subtle)' }} />
  },
}

export function ContentBlockView({ block, skipImages }: { block: ContentBlock; skipImages?: Set<string> }) {
  if (block.type === 'image' && block.src) {
    return <ImageView src={block.src} />
  }

  if (block.type === 'text' && block.text) {
    /*
     * 先摘掉「已经有 image block」的 markdown 图片引用。
     *
     * 只在这一处摘：正文里的 ![](x.png)、裸路径 x.png、`x.png` 三种写法
     * 最终都会走到同一个路径，从源头删掉引用比在三个渲染点各拦一次可靠。
     */
    const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g
    let text = block.text.replace(mdImageRe, (whole: string, src: string) => {
      const clean = src.trim()
      // 已经有 image block 的：整段删掉（否则同一张图会画两遍）
      if (skipImages?.has(imageKey(clean))) return ''
      // 没有 image block 的：退化成裸路径，交给下面的 split 渲染。
      // 不能原样保留 markdown 语法 —— split(IMAGE_PATH_RE) 会把 "![alt](" 和 ")" 当普通文本留下，
      // 屏幕上就会出现 "![晨报](" 这种残句。
      return clean
    })
    /*
     * 模型自己的引用标记：`[已生成图片: xxx.png]`。
     *
     * 无条件删掉，不比对文件名。原因：
     *   - 这个标记是人写给**历史回放**看的（让模型知道生成过什么），不是给
     *     界面看的；真正的图片由 image block 渲染，标记在任何情况下都是重复。
     *   - 按文件名比对会漏：标记里可能只有一个裸文件名，而 image block 存的是
     *     绝对路径，两边不一定对得上（曾经就是这样漏掉一行断头话）。
     *   - 它必须排在下面那条「裸路径」规则**之前**。后者只认文件名，会把标记
     *     里的路径抹掉却把 `[已生成图片: ` 留在屏幕上。
     */
    text = text.replace(/\[\s*已生成图片[:：][^\]]*\]/g, '')

    // 裸路径 / 反引号路径：按 token 逐个判断，命中就整段抹掉
    text = text.replace(/`?[\w\/:\-.]+\.(?:png|jpe?g|gif|webp|svg|bmp)`?/gi,
      (m: string) => (skipImages?.has(imageKey(m.replace(/`/g, ''))) ? '' : m),
    )
    if (!text.trim()) return null

    // Strip backticks from potential image paths before matching
    const cleaned = text.replace(/`([^`]+\.(?:png|jpe?g|gif|webp|svg|bmp))`/gi, '$1')
    // Split text by image file paths, render images inline
    const parts = cleaned.split(IMAGE_PATH_RE)
    const matches = cleaned.match(IMAGE_PATH_RE) || []
    /*
     * 去重：这条消息已经有 image block 的图，正文里就别再画一遍。
     * 两处都画是「同一张晨报出现两次」的直接原因。
     */
    const already = (src: string) => skipImages?.has(imageKey(src)) ?? false
    if (matches.some((m) => !already(m))) {
      return (
        <div style={{ color: 'var(--text-on-surface)', fontSize: '12.5px', lineHeight: 1.6 }}>
          {parts.map((part, i) => (
            <span key={i}>
              {part && (
                <span className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={MARKDOWN_COMPONENTS}>
                    {part}
                  </ReactMarkdown>
                </span>
              )}
              {matches[i] && !already(matches[i]) && <ImageView src={matches[i]} />}
            </span>
          ))}
        </div>
      )
    }
    return (
      <div
        className="prose"
        data-slot="message-bubble-content"
        style={{
          color: 'var(--text-on-surface)',
          fontSize: '12.5px',
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeHighlight, { detect: false }]]}
          components={MARKDOWN_COMPONENTS}
        >
          {text}
        </ReactMarkdown>
      </div>
    )
  }

  return null
}
