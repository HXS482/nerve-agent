import React, { useState, useMemo, memo, useCallback } from 'react'
import { ChatMessage, ContentBlock } from '../../shared/types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

interface Props {
  message: ChatMessage
  prevRole?: MessageRole
  onRetry?: (message: ChatMessage) => void
}

// Cursor-inspired timeline pastel palette
const TIMELINE = {
  thinking: '#dfa88f', // peach
  grep: '#9fc9a2',     // mint
  read: '#9fbbe0',     // pastel blue
  edit: '#c0a8dd',     // lavender
  done: '#c08532',     // warm gold
  error: '#cf2d56',    // semantic error
} as const

// Tool-specific color palette — mapped to Cursor timeline tokens
const TOOL_COLORS: Record<string, { color: string; bg: string; icon: React.ReactNode }> = {
  Read: {
    color: TIMELINE.read,
    bg: 'rgba(159,187,224,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h4l2 2h6v8H2z" />
        <path d="M5 8h6M5 10.5h4" />
      </svg>
    ),
  },
  Write: {
    color: TIMELINE.done,
    bg: 'rgba(192,133,50,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 1.5l3 3L5 14H2v-3z" />
        <path d="M9.5 3.5l3 3" />
      </svg>
    ),
  },
  Edit: {
    color: TIMELINE.edit,
    bg: 'rgba(192,168,221,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
        <path d="M9.5 3.5l3 3" />
      </svg>
    ),
  },
  Bash: {
    color: TIMELINE.grep,
    bg: 'rgba(159,201,162,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
        <path d="M4.5 8l2.5 2L4.5 12M9 10h3" />
      </svg>
    ),
  },
  Glob: {
    color: TIMELINE.grep,
    bg: 'rgba(159,201,162,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2.5 4v7.5a1 1 0 001 1h9a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5h-3a1 1 0 00-1 1z" />
      </svg>
    ),
  },
  Grep: {
    color: TIMELINE.grep,
    bg: 'rgba(159,201,162,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="7" cy="7" r="4" />
        <path d="M10 10l3.5 3.5" />
      </svg>
    ),
  },
  Agent: {
    color: TIMELINE.thinking,
    bg: 'rgba(223,168,143,0.12)',
    icon: (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="10" height="9" rx="2" />
        <circle cx="6.5" cy="8" r="1" fill="currentColor" />
        <circle cx="9.5" cy="8" r="1" fill="currentColor" />
        <path d="M6 11c.8.5 3.2.5 4 0" />
      </svg>
    ),
  },
}

const DEFAULT_TOOL_COLOR = { color: 'var(--text-outline)', bg: 'var(--bg-surface-container)', icon: null }

function getToolStyle(name: string) {
  return TOOL_COLORS[name] || DEFAULT_TOOL_COLOR
}

function ToolIcon({ name, size = 14 }: { name: string; size?: number }) {
  const style = getToolStyle(name)
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center"
      style={{ width: size, height: size, color: style.color }}
    >
      {style.icon || (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <circle cx="8" cy="8" r="3" />
        </svg>
      )}
    </span>
  )
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

// Timeline group: vertical line + toggle dot + tool rows
function ToolTimeline({ pairs }: { pairs: { use: ContentBlock; result?: ContentBlock }[] }) {
  const [expanded, setExpanded] = useState(false)
  const [expandedDetail, setExpandedDetail] = useState<Record<number, boolean>>({})
  const hasRunning = pairs.some((p) => !p.result)
  const hasError = pairs.some((p) => p.result?.is_error)
  const dotColor = hasRunning ? TIMELINE.thinking : hasError ? TIMELINE.error : TIMELINE.done

  return (
    <div className="flex gap-2.5 mb-3 group/timeline">
      {/* Vertical line column */}
      <div className="flex flex-col items-center shrink-0" style={{ width: 16 }}>
        {/* Toggle dot */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="relative shrink-0 transition-transform hover:scale-125"
          style={{ width: 8, height: 8, marginTop: 6 }}
        >
          <span
            className={`absolute inset-0 rounded-full ${hasRunning ? 'animate-pulse-soft' : ''}`}
            style={{ background: dotColor }}
          />
        </button>
        {/* Vertical line */}
        <div
          className="flex-1 w-px mt-1 transition-all"
          style={{
            background: expanded ? 'var(--border-subtle)' : 'transparent',
            maxHeight: expanded ? 2000 : 0,
            opacity: expanded ? 1 : 0,
          }}
        />
      </div>

      {/* Tool rows */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1 pt-0.5">
        {/* Always show first tool name as preview */}
        {(() => {
          const firstName = pairs[0]?.use.name || 'tool'
          const firstSummary = getToolSummary(firstName, pairs[0]?.use.input)
          return (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 py-0.5 text-left transition-colors hover:opacity-80"
              style={{ fontSize: 'var(--fs-sm)' }}
            >
              <ToolIcon name={firstName} />
              <span style={{ color: getToolStyle(firstName).color }}>{firstName}</span>
              {!expanded && firstSummary && (
                <span className="truncate font-mono" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)' }}>
                  {firstSummary}
                </span>
              )}
              {!expanded && pairs.length > 1 && (
                <span style={{ color: 'var(--text-outline-variant)', fontSize: 'var(--fs-xs)' }}>
                  +{pairs.length - 1}
                </span>
              )}
              <span className="ml-auto shrink-0" style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline-variant)' }}>
                {hasRunning ? '' : hasError ? '✕' : '✓'}
              </span>
            </button>
          )
        })()}

        {/* Expanded rows */}
        {expanded && pairs.map((pair, idx) => {
          const name = pair.use.name || 'tool'
          const summary = getToolSummary(name, pair.use.input)
          const isError = pair.result?.is_error
          const isRunning = !pair.result
          const detailOpen = expandedDetail[idx] || false
          const hasDetail = getToolDetail(name, pair.use.input, pair.result)
          return (
            <div key={idx}>
              <div
                className="flex items-center gap-2 py-0.5"
                style={{ fontSize: 'var(--fs-sm)', cursor: hasDetail ? 'pointer' : 'default' }}
                onClick={() => hasDetail && setExpandedDetail((s) => ({ ...s, [idx]: !s[idx] }))}
              >
                <ToolIcon name={name} />
                <span style={{ color: getToolStyle(name).color }}>{name}</span>
                {summary && (
                  <span className="truncate font-mono" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)' }}>
                    {summary}
                  </span>
                )}
                <span className="ml-auto shrink-0" style={{ fontSize: 'var(--fs-xs)' }}>
                  {isRunning ? (
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse-soft inline-block" style={{ background: TIMELINE.thinking }} />
                  ) : isError ? (
                    <span style={{ color: TIMELINE.error }}>✕</span>
                  ) : (
                    <span style={{ color: TIMELINE.done }}>✓</span>
                  )}
                </span>
              </div>
              {detailOpen && hasDetail && (
                <div
                  className="ml-6 my-1 rounded-lg overflow-hidden"
                  style={{
                    background: 'var(--bg-surface-container-lowest)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: 'var(--fs-xs)',
                    fontFamily: 'var(--font-mono)',
                    maxHeight: 400,
                    overflowY: 'auto',
                  }}
                >
                  <pre className="p-3 whitespace-pre-wrap break-all" style={{ color: 'var(--text-on-surface-variant)', margin: 0 }}>
                    {hasDetail}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Standalone tool row (for inline display outside groups)
function ToolRow({ block, index }: { block: ContentBlock; index: number }) {
  if (block.type === 'tool_use') {
    const name = block.name || 'tool'
    const summary = getToolSummary(name, block.input)
    const style = getToolStyle(name)
    return (
      <div className="flex items-center gap-2 py-0.5" style={{ fontSize: 'var(--fs-sm)' }}>
        <ToolIcon name={name} />
        <span style={{ color: style.color }}>{name}</span>
        {summary && (
          <span className="truncate font-mono" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)' }}>
            {summary}
          </span>
        )}
      </div>
    )
  }

  if (block.type === 'tool_result') {
    const isError = block.is_error
    return (
      <div className="flex items-center gap-2 py-0.5" style={{ fontSize: 'var(--fs-sm)' }}>
        <span style={{ color: isError ? TIMELINE.error : TIMELINE.done, fontSize: 'var(--fs-xs)' }}>
          {isError ? '✕' : '✓'}
        </span>
      </div>
    )
  }

  return null
}

function getToolSummary(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return ''
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const path = (input.file_path as string) || ''
    return path.split(/[/\\]/).slice(-2).join('/') || path
  }
  if (name === 'Bash') {
    const cmd = input.command as string
    return cmd?.length > 50 ? cmd.slice(0, 50) + '...' : cmd || ''
  }
  if (name === 'Glob' || name === 'Grep') {
    return (input.pattern as string) || ''
  }
  if (name === 'Agent') {
    return (input.description as string) || ''
  }
  return ''
}

function getToolDetail(name: string, input: Record<string, unknown> | undefined, result?: ContentBlock): string {
  if (!input) return ''
  if (name === 'Write') {
    return (input.content as string) || ''
  }
  if (name === 'Edit') {
    const parts: string[] = []
    if (input.old_string) parts.push(`- ${String(input.old_string).slice(0, 500)}`)
    if (input.new_string) parts.push(`+ ${String(input.new_string).slice(0, 500)}`)
    return parts.join('\n')
  }
  if (name === 'Read' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  if (name === 'Bash') {
    const cmd = `$ ${input.command || ''}`
    const out = result && typeof result.content === 'string' ? result.content : ''
    return out ? `${cmd}\n${out.slice(0, 3000)}` : cmd
  }
  if (name === 'Grep' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  if (name === 'Glob' && result && typeof result.content === 'string') {
    return result.content.slice(0, 3000)
  }
  return ''
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

export const MessageBubble = memo(function MessageBubble({ message, prevRole, onRetry }: Props) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const sameRole = prevRole === message.role
  const handleRetry = useCallback(() => { onRetry?.(message) }, [onRetry, message])
  const mb = sameRole ? 'mb-2' : ''

  if (isSystem) {
    return (
      <div className="flex justify-center animate-fade-in py-2">
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
    return (
      <div className="animate-fade-in flex justify-end" style={{ paddingInline: 'var(--sp-md)', marginBottom: sameRole ? 8 : 48 }}>
        <div style={{ maxWidth: '100%' }}>
          {message.content.map((block, i) => {
            if (block.type === 'image' && block.src) {
              return <ImageView key={i} src={block.src} />
            }
            if (block.type === 'file') {
              return (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
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
              )
            }
            if (block.type === 'text' && block.text) {
              return (
                <p key={i} className="whitespace-pre-wrap"
                  style={{ color: 'var(--text-on-surface)', fontSize: '13px', lineHeight: 1.6 }}>
                  <RichText text={block.text} />
                </p>
              )
            }
            return null
          })}
        </div>
      </div>
    )
  }

  // Assistant message
  const otherBlocks = message.content.filter((b) => b.type !== 'thinking')

  const renderBlocks = () => {
    const result: React.ReactNode[] = []
    let i = 0
    let toolIdx = 0
    while (i < otherBlocks.length) {
      const block = otherBlocks[i]
      if (block.type === 'tool_use' || block.type === 'tool_result') {
        // Collect consecutive tool blocks
        const toolGroup: ContentBlock[] = []
        while (i < otherBlocks.length && (otherBlocks[i].type === 'tool_use' || otherBlocks[i].type === 'tool_result')) {
          toolGroup.push(otherBlocks[i])
          i++
        }
        // Pair tool_use with their tool_result
        const pairs: { use: ContentBlock; result?: ContentBlock }[] = []
        for (const b of toolGroup) {
          if (b.type === 'tool_use') {
            pairs.push({ use: b })
          } else if (b.type === 'tool_result') {
            const last = pairs[pairs.length - 1]
            if (last && !last.result) {
              last.result = b
            } else {
              // Orphan result, render as standalone
              pairs.push({ use: b, result: undefined })
            }
          }
        }
        result.push(
          <ToolTimeline
            key={`tc-${toolIdx++}`}
            pairs={pairs}
          />
        )
      } else {
        result.push(<ContentBlockView key={i} block={block} />)
        i++
      }
    }
    return result
  }

  const fileRefs = otherBlocks
    .filter((b) => b.type === 'tool_use' && (b.name === 'Write' || b.name === 'Edit'))
    .map((b) => b.input?.file_path as string)
    .filter(Boolean)

  return (
      <div className="animate-fade-in flex justify-center group/msg" style={{ marginBottom: sameRole ? 8 : 48 }}>
        <div style={{ maxWidth: 'var(--bubble-max-w)', width: '100%' }}>
        {renderBlocks()}
        {fileRefs.length > 0 && (
          <div className="mt-2 flex flex-col gap-2">
            {[...new Set(fileRefs)].map((fp, i) => <FileReferenceCard key={i} filePath={fp} />)}
          </div>
        )}
        <MessageActions message={message} onRetry={handleRetry} />
      </div>
    </div>
  )
})

function FileReferenceCard({ filePath }: { filePath: string }) {
  const fileName = filePath.split(/[/\\]/).pop() || filePath
  const ext = fileName.split('.').pop()?.toUpperCase() || ''

  const handleOpen = () => {
    window.claude.openInBrowser('file', filePath)
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-opacity hover:opacity-80"
      style={{ border: '1px solid var(--border-subtle)', background: 'var(--bg-surface-container-low)' }}
      onClick={handleOpen}
    >
      <svg className="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-outline)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="truncate" style={{ fontSize: '13px', color: 'var(--text-on-surface)' }}>{fileName}</div>
        <div style={{ fontSize: '11px', color: 'var(--text-outline)' }}>
          {ext ? `文档 · ${ext}` : '文档'}
        </div>
      </div>
      <span className="shrink-0" style={{ fontSize: '11px', color: 'var(--text-outline)' }}>打开方式 ▾</span>
    </div>
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

const IMAGE_PATH_RE = /(?<!\w)[\w\\/:\-.]+\.(?:png|jpe?g|gif|webp|svg|bmp)\b/gi

function isImageUrl(src: string): boolean {
  return /^https?:\/\//i.test(src)
}

function ImageView({ src }: { src: string }) {
  const [error, setError] = useState(false)
  const label = src.split(/[/\\]/).pop() || src
  if (error) {
    return (
      <div className="my-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'var(--bg-surface-container)', color: 'var(--text-outline)', border: '1px solid var(--border-subtle)' }}>
        Image not found: {label}
      </div>
    )
  }

  let resolved: string
  if (src.startsWith('data:')) {
    resolved = src
  } else if (isImageUrl(src)) {
    resolved = src
  } else if (src.includes('.nerve/gallery/') || src.includes('.nerve\\gallery\\') || src.includes('.nerve/images/') || src.includes('.nerve\\images\\')) {
    // Internal gallery path — use file:// protocol
    resolved = `file:///${src.replace(/\\/g, '/')}`
  } else {
    resolved = `file:///${src.replace(/\\/g, '/')}`
  }

  return (
    <div className="my-3">
      <img
        src={resolved}
        alt={label}
        className="rounded-xl max-w-full max-h-[512px] object-contain"
        style={{ border: '1px solid var(--border-subtle)' }}
        onError={() => setError(true)}
      />
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
  return (
    <div className="group/code" style={{ borderRadius: '12px', overflow: 'hidden', marginBlock: '0.75rem', border: '1px solid var(--border-subtle)', fontFamily: "'JetBrains Mono', 'Fira Code', var(--font-mono)" }}>
      {(language || codeText) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-surface-container)', borderBottom: '1px solid var(--border-subtle)' }}>
          {language ? (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {language}
            </span>
          ) : <span />}
          {codeText && (
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 opacity-0 group-hover/code:opacity-100 transition-opacity"
              style={{ fontSize: 'var(--fs-xs)', color: copied ? '#34d399' : 'var(--text-outline)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}
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
          )}
        </div>
      )}
      <pre style={{ margin: 0, border: 'none', borderRadius: 0, background: 'var(--bg-surface-container-lowest)', overflowX: 'auto' }}>
        {children}
      </pre>
    </div>
  )
}

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: any) => (
    <h1 className="font-bold mt-8 mb-3" style={{ color: 'var(--text-on-surface)', fontSize: 'clamp(18px, calc(18px + 0.3vw), 22px)', lineHeight: 1.3 }}>
      {children}
    </h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="font-semibold mt-6 mb-2" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-lg)' }}>
      {children}
    </h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="font-semibold mt-5 mb-1.5" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-md)' }}>
      {children}
    </h3>
  ),
  h4: ({ children }: any) => (
    <h4 className="font-bold mt-4 mb-1" style={{ color: 'var(--text-on-surface)', fontSize: 'var(--fs-base)', lineHeight: 1.4 }}>
      {children}
    </h4>
  ),
  h5: ({ children }: any) => (
    <h5 className="font-medium mt-3 mb-1" style={{ color: 'var(--text-on-surface-variant)', fontSize: 'var(--fs-sm)', lineHeight: 1.4 }}>
      {children}
    </h5>
  ),
  h6: ({ children }: any) => (
    <h6 className="font-medium mt-3 mb-1" style={{ color: 'var(--text-outline)', fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.4 }}>
      {children}
    </h6>
  ),
  p: ({ children }: any) => (
    <p className="my-4" style={{ color: 'var(--text-on-surface)', lineHeight: '1.7' }}>
      {children}
    </p>
  ),
  code: ({ className, children, ...props }: any) => {
    const isInline = !className
    if (isInline) {
      return (
        <code
          className="px-1.5 py-0.5 rounded-md"
          style={{ fontSize: 'var(--fs-xs)', background: 'var(--bg-surface-container-high)', color: '#f07178', fontFamily: 'var(--font-mono)' }}
          {...props}
        >
          {children}
        </code>
      )
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
      style={{ color: 'var(--accent-primary)' }}
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
    <li className="leading-relaxed mb-1" style={{ color: 'var(--text-on-surface)', fontSize: '13px' }}>
      {children}
    </li>
  ),
  blockquote: ({ children }: any) => (
    <blockquote
      className="border-l-[3px] pl-4 my-3"
      style={{
        borderColor: 'var(--accent-primary)',
        color: 'var(--text-on-surface-variant)',
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => (
    <hr className="my-8" style={{ borderColor: 'var(--border-default)', opacity: 0.5 }} />
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
        borderBottom: '1px solid var(--border-default)',
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

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'image' && block.src) {
    return <ImageView src={block.src} />
  }

  if (block.type === 'text' && block.text) {
    // Strip backticks from potential image paths before matching
    const cleaned = block.text.replace(/`([^`]+\.(?:png|jpe?g|gif|webp|svg|bmp))`/gi, '$1')
    // Split text by image file paths, render images inline
    const parts = cleaned.split(IMAGE_PATH_RE)
    const matches = cleaned.match(IMAGE_PATH_RE) || []
    if (matches.length > 0) {
      return (
        <div style={{ color: 'var(--text-on-surface)', fontSize: '13px', lineHeight: 1.7 }}>
          {parts.map((part, i) => (
            <span key={i}>
              {part && (
                <span className="prose">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={MARKDOWN_COMPONENTS}>
                    {part}
                  </ReactMarkdown>
                </span>
              )}
              {matches[i] && <ImageView src={matches[i]} />}
            </span>
          ))}
        </div>
      )
    }
    return (
      <div
        className="prose"
        style={{
          color: 'var(--text-on-surface)',
          fontSize: '13px',
          lineHeight: 1.7,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={MARKDOWN_COMPONENTS}
        >
          {block.text}
        </ReactMarkdown>
      </div>
    )
  }

  if (block.type === 'thinking' && block.thinking) {
    return (
      <details className="group mb-3">
        <summary
          className="cursor-pointer transition-colors select-none flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-[var(--bg-surface-container)]"
          style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-outline)' }}
        >
          <svg
            className="w-2.5 h-2.5 transition-transform duration-150 group-open:rotate-90"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            viewBox="0 0 16 16"
          >
            <path d="M6 4l4 4-4 4" />
          </svg>
          <span style={{ color: TIMELINE.thinking }}>Thinking</span>
        </summary>
        <div
          className="mt-1.5 whitespace-pre-wrap rounded-xl leading-relaxed max-h-60 overflow-y-auto"
          style={{ fontSize: 'var(--fs-xs)', padding: 'var(--sp-sm)', color: 'var(--text-on-surface-variant)', background: 'var(--bg-surface-container)', border: '1px solid var(--border-subtle)', fontFamily: 'var(--font-mono)' }}
        >
          {block.thinking}
        </div>
      </details>
    )
  }

  if (block.type === 'tool_use') {
    return <ToolRow block={block} index={0} />
  }

  if (block.type === 'tool_result') {
    return <ToolRow block={block} index={0} />
  }

  return null
}
