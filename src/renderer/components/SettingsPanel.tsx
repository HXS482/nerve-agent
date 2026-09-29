import { useState, useEffect, useRef } from 'react'
import {
  Settings as SettingsIcon, Heart, User, Activity, Server, Sparkles, Mic, MessageSquare,
  Package, Plus, X, Eye, EyeOff,
} from 'lucide-react'
import { ClaudeConfig, GatewayChannel, ChannelPlatform, CHANNEL_FIELDS, CHANNEL_PLATFORM_LABELS } from '../../shared/types'
import { useChatStore, CONVERSATION_WIDTH_MIN, CONVERSATION_WIDTH_MAX } from '../stores/chatStore'
import { isVideoBg, isHtmlBg, htmlForIframe } from './Stage/StageBgMedia'

interface Props {
  config: ClaudeConfig
  onUpdateConfig: (partial: Partial<ClaudeConfig>) => void
  onOpenProjectPicker: () => void
  onClose: () => void
}

type Tab = 'general' | 'soul' | 'persona' | 'provider' | 'mcp' | 'skills' | 'voice' | 'channels' | 'plugins'

const EFFORTS: ClaudeConfig['effort'][] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_MODES: ClaudeConfig['permissionMode'][] = ['default', 'acceptEdits', 'auto', 'bypassPermissions']

// 存的是 API enum，界面说人话
const EFFORT_LABELS: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max',
}
const PERMISSION_LABELS: Record<string, string> = {
  default: 'Ask each time',
  acceptEdits: 'Accept edits',
  auto: 'Auto',
  bypassPermissions: 'Skip all checks',
}
const PERMISSION_HINTS: Record<string, string> = {
  default: 'Every write waits for your confirmation.',
  acceptEdits: 'File edits go through; commands still ask.',
  auto: 'Reads and edits run unattended.',
  bypassPermissions: 'Nothing is checked. Sandboxed environments only.',
}

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'soul', label: 'Soul', icon: Heart },
  { id: 'persona', label: 'Persona', icon: User },
  { id: 'provider', label: 'Provider', icon: Activity },
  { id: 'mcp', label: 'MCP Servers', icon: Server },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'channels', label: 'Channels', icon: MessageSquare },
  { id: 'plugins', label: 'Plugins', icon: Package },
]

// --- Shared UI Primitives ---

/** 设置分组：uppercase 段标题在卡外（ChunUI 段标题范式），内容包进分组大卡，
    整组以 settings-reveal 入场（错峰延迟由 CSS nth-child 接管） */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-reveal">
      <div style={{ margin: '0 14px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-outline)' }}>
          {title}
        </div>
        {hint && (
          <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 4, maxWidth: 520 }}>
            {hint}
          </div>
        )}
      </div>
      <div className="settings-group-card">{children}</div>
    </div>
  )
}

/** 设置行：紧凑控件右对齐（stack 缺省）；表单/宽控件用 stack 全宽堆在 label 下。
    行节奏对齐 ChunUI：minHeight 44，左右内边距 14 与分组卡圆角呼应 */
function Row({ label, hint, stack, children }: { label: string; hint?: string; stack?: boolean; children: React.ReactNode }) {
  if (stack) {
    return (
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 3 }}>{hint}</div>}
        <div style={{ marginTop: 10, minWidth: 0 }}>{children}</div>
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        minHeight: 44,
        padding: '10px 14px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 3 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  )
}

function PillGroup({ options, value, onChange, renderLabel }: {
  options: string[]
  value: string
  onChange: (v: string) => void
  renderLabel?: (v: string) => React.ReactNode
}) {
  return (
    <div className="flex flex-wrap" style={{ gap: 6 }}>
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className="transition-colors cursor-pointer"
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              fontSize: 13,
              fontWeight: active ? 600 : 400,
              background: active ? 'var(--accent-soft)' : 'var(--bg-surface-container-high)',
              color: active ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
              border: `1px solid ${active ? 'var(--accent-line)' : 'transparent'}`,
            }}
          >
            {renderLabel ? renderLabel(opt) : opt}
          </button>
        )
      })}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', mono, rightSlot }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  mono?: boolean
  rightSlot?: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full outline-none transition-colors"
        style={{
          padding: rightSlot ? '7px 34px 7px 10px' : '7px 10px',
          borderRadius: 'var(--radius-md)',
          fontSize: 13,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          background: 'var(--bg-surface-container-high)',
          color: 'var(--text-on-surface)',
          border: '1px solid var(--border-subtle)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none' }}
      />
      {rightSlot && (
        <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
          {rightSlot}
        </div>
      )}
    </div>
  )
}

/** 多行键值输入：TextInput 的 textarea 版（env / headers 共用） */
function MultilineInput({ value, onChange, placeholder, rows = 3 }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full outline-none transition-colors resize-none"
      style={{
        padding: '7px 10px',
        borderRadius: 'var(--radius-md)',
        fontSize: 13,
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg-surface-container-high)',
        color: 'var(--text-on-surface)',
        border: '1px solid var(--border-subtle)',
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)' }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none' }}
    />
  )
}

function PrimaryButton({ children, onClick, disabled }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer transition-colors"
      style={{
        padding: '8px 16px',
        borderRadius: 'var(--radius-md)',
        fontSize: 13,
        fontWeight: 600,
        background: 'var(--accent-primary)',
        color: 'var(--accent-on-primary)',
        opacity: disabled ? 0.5 : 1,
        border: 'none',
      }}
    >
      {children}
    </button>
  )
}

function SecondaryButton({ children, onClick, disabled }: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer transition-colors"
      style={{
        padding: '8px 16px',
        borderRadius: 'var(--radius-md)',
        fontSize: 13,
        fontWeight: 500,
        background: 'var(--bg-surface-container-high)',
        color: 'var(--text-on-surface)',
        border: '1px solid var(--border-subtle)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface-variant)', marginBottom: 5 }}>
      {children}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--text-outline)', marginTop: 6 }}>
      {children}
    </div>
  )
}

/** 开关：状态由位置和 On/Off 承担，不用发光点也不用等宽大写 */
function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="cursor-pointer transition-colors"
      style={{
        width: 40, height: 22, borderRadius: 11, padding: 3,
        background: on ? 'var(--accent-primary)' : 'var(--bg-surface-container-highest)',
        border: '1px solid var(--border-subtle)',
        display: 'flex', alignItems: 'center',
        justifyContent: on ? 'flex-end' : 'flex-start',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
    </button>
  )
}

/** 纯图标按钮：删除、显隐等无文字动作 */
function IconButton({ onClick, label, children, danger }: {
  onClick: () => void
  label: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="cursor-pointer transition-colors"
      style={{
        padding: 4, borderRadius: 'var(--radius-sm)', color: 'var(--text-outline)',
        background: 'transparent', border: 'none', display: 'flex',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = danger ? 'var(--text-danger)' : 'var(--text-on-surface)' }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
    >
      {children}
    </button>
  )
}

/** 状态靠字承载，颜色只做辅助；不再是一个同色系染满的盒子 */
function StatusBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, fontSize: 13 }}>
      <span style={{ fontWeight: 600, color: ok ? 'var(--text-success)' : 'var(--text-danger)' }}>
        {ok ? 'Passed' : 'Failed'}
      </span>
      <span style={{ color: 'var(--text-on-surface-variant)' }}>{text}</span>
    </div>
  )
}

// --- Plugins Tab ---

interface PluginInfo {
  id: string
  version: string
  description: string
  trust: string
  toolCount: number
  enabled: boolean
}

function PluginsTab() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [loading, setLoading] = useState(true)

  const loadPlugins = async () => {
    setLoading(true)
    try {
      const list = await (window as any).claude.getPlugins()
      setPlugins(list || [])
    } catch { setPlugins([]) }
    setLoading(false)
  }

  useEffect(() => { loadPlugins() }, [])

  const handleToggle = async (pluginId: string, enabled: boolean) => {
    await (window as any).claude.togglePlugin(pluginId, enabled)
    await loadPlugins()
  }

  const handleReload = async (pluginId: string) => {
    await (window as any).claude.reloadPlugin(pluginId)
    await loadPlugins()
  }

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-outline)', padding: '20px 0' }}>Loading plugins…</div>
  }

  return (
    <div>
      <Section title="Plugins" hint="Drop a plugin folder into ~/.nerve/plugins/ to install it.">
        {plugins.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-outline)' }}>
            None installed.
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 4 }}>
            {plugins.map(plugin => (
              <div key={plugin.id} style={{ padding: '9px 10px', borderRadius: 'var(--radius-sm)' }}>
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center" style={{ gap: 10 }}>
                    <Toggle
                      on={plugin.enabled}
                      onChange={() => handleToggle(plugin.id, !plugin.enabled)}
                      label={`Toggle ${plugin.id}`}
                    />
                    <span style={{ fontSize: 12, fontWeight: 500, color: plugin.enabled ? 'var(--text-on-surface)' : 'var(--text-outline)' }}>
                      {plugin.id}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-outline)' }}>{plugin.version}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-outline)' }}>{plugin.trust}</span>
                  </div>
                  <SecondaryButton onClick={() => handleReload(plugin.id)}>Reload</SecondaryButton>
                </div>

                {/* Description */}
                {plugin.description && (
                  <p style={{ fontSize: 11, marginTop: 4, marginBottom: 0, lineHeight: 1.5, color: 'var(--text-outline)' }}>{plugin.description}</p>
                )}

                {plugin.toolCount > 0 && (
                  <div style={{ fontSize: 11, marginTop: 4, color: 'var(--text-outline)' }}>
                    {plugin.toolCount} {plugin.toolCount === 1 ? 'tool' : 'tools'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// --- Main Panel ---

export function SettingsPanel({ config, onUpdateConfig, onOpenProjectPicker, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('general')

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 animate-fade-in"
        style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed z-50 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(720px, calc(100vw - 48px))',
          height: 'min(560px, calc(100vh - 48px))',
          display: 'flex',
          background: 'var(--dynamic-island-bg)',
          backdropFilter: 'var(--dynamic-island-blur)',
          WebkitBackdropFilter: 'var(--dynamic-island-blur)',
          border: '1px solid var(--dynamic-island-border)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-pop)',
          overflow: 'hidden',
        }}
      >
        {/* Left sidebar */}
        <div
          className="shrink-0 flex flex-col"
          style={{
            width: 172,
            borderRight: '1px solid var(--border-subtle)',
            background: 'var(--bg-mica-sidebar)',
          }}
        >
          {/* Sidebar header */}
          <div
            className="no-select"
            style={{ padding: '18px 18px 12px' }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-on-surface)' }}>
              Settings
            </div>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-col" style={{ padding: '0 8px 10px', gap: 1 }}>
            {TABS.map((t) => {
              const active = tab === t.id
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex items-center transition-colors cursor-pointer"
                  style={{
                    gap: 9,
                    padding: '7px 10px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'var(--accent-soft)' : 'transparent',
                    color: active ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'var(--bg-surface-container-high)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <Icon size={15} strokeWidth={1.5} />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header — 只放关闭键，tab 名由侧栏高亮项承担，不重复印两遍 */}
          <div
            className="flex items-center justify-end shrink-0"
            style={{ padding: '12px 14px 12px 20px' }}
          >
            <IconButton onClick={onClose} label="Close settings">
              <X size={15} strokeWidth={1.5} />
            </IconButton>
          </div>

          {/* Tab content — scrollable */}
          <div className="settings-body flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '0 24px 24px' }}>
            {tab === 'general' && (
              <GeneralTab config={config} onUpdateConfig={onUpdateConfig} onOpenProjectPicker={onOpenProjectPicker} />
            )}
            {tab === 'soul' && <SoulTab />}
            {tab === 'persona' && <PersonaTab />}
            {tab === 'provider' && <ProviderTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'voice' && <VoiceTab />}
            {tab === 'channels' && <ChannelsTab />}
            {tab === 'plugins' && <PluginsTab />}
          </div>
        </div>
      </div>
    </>
  )
}

// --- General Tab ---

function GeneralTab({ config, onUpdateConfig, onOpenProjectPicker }: {
  config: ClaudeConfig
  onUpdateConfig: (partial: Partial<ClaudeConfig>) => void
  onOpenProjectPicker: () => void
}) {
  const providers = useChatStore((s) => s.providers)
  const providerModels = useChatStore((s) => s.providerModels)

  // Build provider list: anthropic base + any from store
  const allProviderIds = ['anthropic', ...providers.map((p) => p.id).filter((id) => id !== 'anthropic')]
  const activeProvider = config.provider || 'anthropic'

  // Models for the active provider
  const activeModels = providerModels[activeProvider] || []
  const hasModels = activeModels.length > 0

  return (
    <div>
      <Section
        title="Model"
        hint="Provider picks the endpoint and credentials; the top bar switches between its models."
      >
        <Row label="Provider group">
          <PillGroup
            options={allProviderIds}
            value={activeProvider}
            onChange={(id) => {
              const newModels = providerModels[id] || []
              const currentModel = config.model
              const modelExistsInNewProvider = newModels.some((m) => m === currentModel)
              if (newModels.length > 0 && !modelExistsInNewProvider) {
                // Current model is not in the new provider's list — switch to first available
                onUpdateConfig({ provider: id, model: newModels[0] })
              } else {
                onUpdateConfig({ provider: id })
              }
            }}
          />
        </Row>

        <Row
          label="Effort"
          hint={hasModels ? undefined : 'No models fetched for this group yet.'}
        >
          <PillGroup
            options={EFFORTS}
            value={config.effort}
            onChange={(e) => onUpdateConfig({ effort: e as ClaudeConfig['effort'] })}
            renderLabel={(e) => EFFORT_LABELS[e] ?? e}
          />
        </Row>

        <Row label="Permission mode" hint={PERMISSION_HINTS[config.permissionMode]}>
          <PillGroup
            options={PERMISSION_MODES}
            value={config.permissionMode}
            onChange={(pm) => onUpdateConfig({ permissionMode: pm as ClaudeConfig['permissionMode'] })}
            renderLabel={(pm) => PERMISSION_LABELS[pm] ?? pm}
          />
        </Row>
      </Section>

      <Section title="Workspace">
        <Row label="Working directory" stack>
          <div className="flex items-center" style={{ gap: 10 }}>
            <span
              className="truncate"
              style={{ fontSize: 12, color: 'var(--text-on-surface-variant)', fontFamily: 'var(--font-mono)' }}
            >
              {config.cwd || 'Not set'}
            </span>
            <SecondaryButton onClick={onOpenProjectPicker}>Change</SecondaryButton>
          </div>
        </Row>

        <Row label="Stage background" hint="Shown behind the Stage view." stack>
          <StageBgPicker />
        </Row>

        <Row label="Conversation width" hint="Message text and the input bar share this limit." stack>
          <ConversationWidthControl />
        </Row>
      </Section>
    </div>
  )
}

// 会话宽度上限：正文列与底部输入栏共用，改一处两边同步收窄
function ConversationWidthControl() {
  const conversationWidth = useChatStore((s) => s.conversationWidth)
  const setConversationWidth = useChatStore((s) => s.setConversationWidth)
  const limited = conversationWidth > 0
  // 0（不限）落在滑杆量程之外，否则最左档会误读成 480px；拖到最左即回到不限
  const sliderValue = limited ? conversationWidth : CONVERSATION_WIDTH_MIN
  const fill = ((sliderValue - CONVERSATION_WIDTH_MIN) / (CONVERSATION_WIDTH_MAX - CONVERSATION_WIDTH_MIN)) * 100

  return (
    <div>
      <div className="flex items-center" style={{ gap: 12 }}>
        <input
          type="range"
          min={CONVERSATION_WIDTH_MIN}
          max={CONVERSATION_WIDTH_MAX}
          step={20}
          value={sliderValue}
          onChange={(e) => {
            const v = Number(e.target.value)
            setConversationWidth(v <= CONVERSATION_WIDTH_MIN ? 0 : v)
          }}
          className="settings-slider flex-1"
          style={{ '--fill': `${fill}%` } as React.CSSProperties}
        />
        <span
          className="tabular-nums"
          style={{ width: 54, textAlign: 'right', fontSize: 11, color: 'var(--text-outline)' }}
        >
          {limited ? `${conversationWidth}px` : 'Full'}
        </span>
        {limited && <SecondaryButton onClick={() => setConversationWidth(0)}>Reset</SecondaryButton>}
      </div>
      <Hint>Applies instantly. Drag the handle all the way left to follow the window again.</Hint>
    </div>
  )
}

// 选图/视频/HTML：图片 canvas 压缩（限宽 1920，jpeg q82）存 data URL；
// 视频落盘（~/.nerve/stage-bg）存 nerve-file URL；HTML 存 data:text/html;base64（沙箱 iframe 渲染）
function StageBgPicker() {
  const stageBg = useChatStore((s) => s.stageBg)
  const setStageBg = useChatStore((s) => s.setStageBg)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    if (file.type.startsWith('video/')) {
      const ext = '.' + (file.name.split('.').pop() || 'mp4')
      const url = await window.claude.saveStageBg(await file.arrayBuffer(), ext)
      setStageBg(url)
      return
    }
    // HTML 动态背景：内容转 data:text/html;base64（自包含，重启仍在）
    if (file.type === 'text/html' || /\.html?$/i.test(file.name)) {
      const text = await file.text()
      // UTF-8 → 二进制 → base64（中文等多字节安全）
      const bytes = new TextEncoder().encode(text)
      let bin = ''
      bytes.forEach((b) => { bin += String.fromCharCode(b) })
      setStageBg('data:text/html;base64,' + btoa(bin))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, 1920 / img.width)
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        setStageBg(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  const video = stageBg && isVideoBg(stageBg)
  const html = stageBg && isHtmlBg(stageBg)

  return (
    <div>
      <div
        style={{
          width: 260, aspectRatio: '16/10', borderRadius: 'var(--radius-md)', overflow: 'hidden',
          border: '1px solid var(--border-subtle)',
          background: stageBg ? '#0a0a0a' : 'var(--bg-surface-container-high)',
          marginBottom: 10,
          position: 'relative',
        }}
      >
        {!stageBg && (
          <div
            style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, color: 'var(--text-outline)',
            }}
          >
            No background
          </div>
        )}
        {video && (
          <video
            src={stageBg}
            autoPlay
            muted
            loop
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        )}
        {html && stageBg && (
          <iframe
            srcDoc={htmlForIframe(stageBg)}
            sandbox="allow-scripts"
            title="Stage background preview"
            style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
          />
        )}
      </div>
      <div className="flex items-center" style={{ gap: 8 }}>
        <SecondaryButton onClick={() => fileRef.current?.click()}>Choose file</SecondaryButton>
        {stageBg && (
          <SecondaryButton onClick={() => setStageBg(null)}>Reset</SecondaryButton>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*,.html,.htm"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleFile(f)
            e.target.value = ''
          }}
        />
      </div>
      <Hint>
        Images are re-encoded to 1920px wide JPEG. Video (mp4/webm) loops muted. HTML runs in a
        sandboxed, non-interactive frame. Saved locally, applied immediately.
      </Hint>
    </div>
  )
}

// --- Soul / Persona Tab（共用一个编辑器） ---

function PromptEditorTab({ field, description }: { field: 'soul' | 'persona'; description: string }) {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    window.claude.getNerveSettings().then((s: any) => setText(s[field] || '')).catch(() => {})
  }, [field])

  const handleSave = async () => {
    const result = await window.claude.saveNerveSettings({ [field]: text })
    if (!result || !result.ok) {
      setSaved(false)
      setSaveError(result?.error || 'Save failed')
      return
    }
    setSaveError(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <Section title={field === 'soul' ? 'Soul' : 'Persona'} hint={description}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 320,
            resize: 'vertical',
            padding: '12px 14px',
            borderRadius: 0,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-on-surface)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            lineHeight: 1.6,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div className="settings-card-pad flex items-center justify-end" style={{ gap: 10 }}>
          {saveError && (
            <span style={{ fontSize: 12, color: 'var(--text-danger)' }}>{saveError}</span>
          )}
          {saved && (
            <span style={{ fontSize: 12, color: 'var(--text-on-surface-variant)' }}>Saved</span>
          )}
          <PrimaryButton onClick={handleSave}>Save</PrimaryButton>
        </div>
      </Section>
    </div>
  )
}

function SoulTab() {
  return (
    <PromptEditorTab
      field="soul"
      description="Agent 的行为准则与能力边界（system prompt 第一层）。保存后立即生效。"
    />
  )
}

function PersonaTab() {
  return (
    <PromptEditorTab
      field="persona"
      description="Agent 的人设与说话风格（system prompt 第二层，跟在 Soul 后面）。保存后立即生效。"
    />
  )
}

// --- Provider Tab ---

type ProviderType = 'anthropic' | 'openai' | 'google'

interface ProviderEntry {
  id: string
  type: ProviderType
  baseURL: string
  authToken: string
  models?: string[]
}

function ProviderTab() {
  const setProviderModels = useChatStore((s) => s.setProviderModels)
  const [providers, setProviders] = useState<Record<string, { type: ProviderType; baseURL: string; authToken: string; models?: string[] }>>({})
  const [defaultProvider, setDefaultProvider] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [newId, setNewId] = useState('')
  const [newType, setNewType] = useState<ProviderType>('openai')
  const [newURL, setNewURL] = useState('')
  const [newKey, setNewKey] = useState('')
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [newAlias, setNewAlias] = useState('')
  const [newModelId, setNewModelId] = useState('')
  const [fetchingModels, setFetchingModels] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [savedProvider, setSavedProvider] = useState<string | null>(null)
  const [selectedModels, setSelectedModels] = useState<Record<string, Set<string>>>({})
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({})

  useEffect(() => {
    window.claude.getNerveSettings().then((s: any) => {
      setBaseURL(s.baseURL || '')
      setAuthToken(s.authToken || '')
      setProviders(s.providers || {})
      setDefaultProvider(s.defaultProvider || '')
      setAliases(s.modelAliases || {})
    }).catch(() => {})
  }, [])

  // Refresh the global providers snapshot so General tab / ModelIsland update immediately
  const syncStoreProviders = async () => {
    try {
      const list = await window.claude.getProviders()
      if (list) useChatStore.getState().setProviders(list)
    } catch {}
  }

  const handleSave = async () => {
    const result = await window.claude.saveNerveSettings({
      baseURL, authToken,
      modelAliases: aliases,
      providers,
      defaultProvider,
    })
    if (!result || !result.ok) {
      setSaved(false)
      setSaveError(result?.error || 'Save failed')
      console.error('Save failed:', result?.error)
      return
    }
    setSaveError(null)
    // Sync providerModels and defaultProvider in chatStore so UI updates immediately
    const { setProviderModels, setDefaultProvider } = useChatStore.getState()
    setDefaultProvider(defaultProvider)
    if (providers.anthropic?.models) setProviderModels('anthropic', providers.anthropic.models)
    for (const [id, config] of Object.entries(providers)) {
      if (id !== 'anthropic' && config.models) setProviderModels(id, config.models)
    }
    await syncStoreProviders()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleFetchModels = async (providerId: string) => {
    const p = providerId === 'anthropic'
      ? { baseURL, authToken }
      : providers[providerId]
    if (!p) return
    setFetchingModels(providerId)
    setFetchError(null)
    try {
      const result = await window.claude.fetchModels(p.baseURL, p.authToken)
      if (result.ok && result.models) {
        // Temp store fetched models (not saved yet — user selects which to save)
        if (providerId === 'anthropic') {
          setProviders({ ...providers, [providerId]: { type: 'anthropic', baseURL: p.baseURL, authToken: p.authToken, models: result.models } })
        } else {
          setProviders({ ...providers, [providerId]: { ...providers[providerId], models: result.models } })
        }
        // Select all by default
        setSelectedModels({ ...selectedModels, [providerId]: new Set(result.models) })
      } else {
        setFetchError(result.error || 'No models returned')
      }
    } catch (err: any) {
      setFetchError(err.message || 'Fetch failed')
    }
    setFetchingModels(null)
  }

  const handleAddProvider = async () => {
    if (!newId.trim() || !newURL.trim()) return
    const id = newId.trim().toLowerCase().replace(/\s+/g, '-')
    const updated = { ...providers, [id]: { type: newType, baseURL: newURL.trim(), authToken: newKey.trim() } }
    setProviders(updated)
    // Auto-persist to disk and reload provider
    await window.claude.saveNerveSettings({
      baseURL, authToken,
      modelAliases: aliases,
      providers: updated,
      defaultProvider,
    })
    await syncStoreProviders()
    setNewId('')
    setNewURL('')
    setNewKey('')
    setAdding(false)
  }

  const handleSaveProvider = async (providerId: string) => {
    const sel = selectedModels[providerId]
    const p = providerId === 'anthropic'
      ? { ...providers[providerId], baseURL, authToken }
      : providers[providerId]
    if (!p) return
    // Save only selected models
    const modelsToSave = sel ? [...sel] : (p.models || [])
    const updatedProviders = {
      ...providers,
      [providerId]: { ...p, models: modelsToSave },
    }
    // For anthropic base, also update top-level fields
    const saveBaseURL = providerId === 'anthropic' ? baseURL : undefined
    const saveAuthToken = providerId === 'anthropic' ? authToken : undefined
    await window.claude.saveNerveSettings({
      baseURL: saveBaseURL,
      authToken: saveAuthToken,
      modelAliases: aliases,
      providers: updatedProviders,
      defaultProvider,
    })
    setProviders(updatedProviders)
    setProviderModels(providerId, modelsToSave)
    await syncStoreProviders()
    setSavedProvider(providerId)
    setTimeout(() => setSavedProvider(null), 2000)
  }

  const handleDeleteProvider = async (id: string) => {
    const next = { ...providers }
    delete next[id]
    setProviders(next)
    const nextDefault = defaultProvider === id ? '' : defaultProvider
    if (defaultProvider === id) setDefaultProvider('')
    await window.claude.saveNerveSettings({
      modelAliases: aliases,
      providers: next,
      defaultProvider: nextDefault,
    })
    useChatStore.getState().setDefaultProvider(nextDefault)
    await syncStoreProviders()
  }

  const handleAddAlias = () => {
    if (!newAlias.trim() || !newModelId.trim()) return
    setAliases({ ...aliases, [newAlias.trim().toLowerCase()]: newModelId.trim() })
    setNewAlias('')
    setNewModelId('')
  }

  const handleDeleteAlias = (alias: string) => {
    const next = { ...aliases }
    delete next[alias]
    setAliases(next)
  }

  const allProviders: ProviderEntry[] = [
    { id: 'anthropic', type: 'anthropic', baseURL, authToken, models: providers.anthropic?.models },
    ...Object.entries(providers).filter(([id]) => id !== 'anthropic').map(([id, cfg]) => ({ id, ...cfg })),
  ]

  return (
    <div>
      <Section title="Providers" hint="Endpoints and credentials. Fetch pulls the live model list; only checked models get saved.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allProviders.map((p) => {
            const isDefault = p.id === (defaultProvider || 'anthropic')
            const isExpanded = expanded === p.id
            const isBase = p.id === 'anthropic'

            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-surface-container-high)',
                  border: `1px solid ${isDefault ? 'var(--accent-line)' : 'var(--border-subtle)'}`,
                }}
              >
                {/* Provider row */}
                <div
                  className="flex items-center cursor-pointer transition-colors"
                  style={{ gap: 10, padding: '9px 12px' }}
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                >
                  <span
                    style={{
                      fontSize: 12, fontWeight: 600, color: 'var(--text-on-surface)', flex: 1,
                    }}
                  >
                    {p.id}
                  </span>
                  {isDefault && (
                    <span style={{ fontSize: 11, color: 'var(--text-outline)' }}>default</span>
                  )}
                  <span className="shrink-0" style={{ fontSize: 11, color: 'var(--text-outline)' }}>
                    {p.type}
                  </span>
                  {!isBase && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <IconButton onClick={() => handleDeleteProvider(p.id)} label={`Remove ${p.id}`} danger>
                        <X size={13} strokeWidth={1.5} />
                      </IconButton>
                    </span>
                  )}
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {isBase ? (
                      <>
                        <div>
                          <FieldLabel>Base URL</FieldLabel>
                          <TextInput value={baseURL} onChange={setBaseURL} placeholder="https://api.anthropic.com/v1" />
                        </div>
                        <div>
                          <FieldLabel>API Key</FieldLabel>
                          <TextInput
                            value={authToken} onChange={setAuthToken} placeholder="sk-ant-..." type={showKeys['anthropic'] ? 'text' : 'password'} mono
                            rightSlot={
                              <IconButton
                                onClick={() => setShowKeys({ ...showKeys, 'anthropic': !showKeys['anthropic'] })}
                                label={showKeys['anthropic'] ? 'Hide key' : 'Show key'}
                              >
                                {showKeys['anthropic']
                                  ? <EyeOff size={14} strokeWidth={1.5} />
                                  : <Eye size={14} strokeWidth={1.5} />}
                              </IconButton>
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <FieldLabel>Type</FieldLabel>
                          <PillGroup
                            options={['anthropic', 'openai', 'google']}
                            value={p.type}
                            onChange={(v) => setProviders({ ...providers, [p.id]: { ...providers[p.id], type: v as ProviderType } })}
                          />
                        </div>
                        <div>
                          <FieldLabel>Base URL</FieldLabel>
                          <TextInput value={p.baseURL} onChange={(v) => setProviders({ ...providers, [p.id]: { ...providers[p.id], baseURL: v }})} placeholder="https://api.openai.com/v1" />
                        </div>
                        <div>
                          <FieldLabel>API Key</FieldLabel>
                          <TextInput
                            value={p.authToken} onChange={(v) => setProviders({ ...providers, [p.id]: { ...providers[p.id], authToken: v }})}
                            placeholder="sk-..." type={showKeys[p.id] ? 'text' : 'password'} mono
                            rightSlot={
                              <IconButton
                                onClick={() => setShowKeys({ ...showKeys, [p.id]: !showKeys[p.id] })}
                                label={showKeys[p.id] ? 'Hide key' : 'Show key'}
                              >
                                {showKeys[p.id]
                                  ? <EyeOff size={14} strokeWidth={1.5} />
                                  : <Eye size={14} strokeWidth={1.5} />}
                              </IconButton>
                            }
                          />
                        </div>
                      </>
                    )}
                    {!isDefault && (
                      <SecondaryButton onClick={() => setDefaultProvider(p.id)}>
                        Set as Default
                      </SecondaryButton>
                    )}

                    {/* Fetch Models */}
                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10, marginTop: 4 }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                        <FieldLabel>Models</FieldLabel>
                        <div className="flex items-center" style={{ gap: 4 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFetchModels(p.id) }}
                            disabled={fetchingModels === p.id}
                            className="cursor-pointer transition-colors"
                            style={{
                              padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                              fontSize: 12, fontWeight: 500,
                              background: 'var(--accent-soft)',
                              color: 'var(--accent-primary)',
                              border: 'none',
                              opacity: fetchingModels === p.id ? 0.6 : 1,
                            }}
                          >
                            {fetchingModels === p.id ? 'Fetching…' : 'Fetch'}
                          </button>
                          {p.models && p.models.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSaveProvider(p.id)
                              }}
                              className="cursor-pointer transition-colors"
                              style={{
                                padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                                fontSize: 12, fontWeight: 500,
                                background: savedProvider === p.id ? 'var(--bg-surface-container-highest)' : 'transparent',
                                color: savedProvider === p.id ? 'var(--text-success)' : 'var(--text-outline)',
                                border: 'none',
                              }}
                            >
                              {savedProvider === p.id ? 'Saved' : 'Save selection'}
                            </button>
                          )}
                        </div>
                      </div>
                      {p.models && p.models.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
                          {p.models.map((m) => {
                            const checked = selectedModels[p.id]?.has(m) ?? false
                            return (
                              <label
                                key={m}
                                className="flex items-center cursor-pointer transition-colors"
                                style={{ gap: 7, padding: '3px 6px', borderRadius: 'var(--radius-sm)', fontSize: 12 }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-surface-container-highest)' }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(selectedModels[p.id] || [])
                                    if (checked) next.delete(m); else next.add(m)
                                    setSelectedModels({ ...selectedModels, [p.id]: next })
                                  }}
                                  style={{ accentColor: 'var(--accent-primary)', width: 12, height: 12, flexShrink: 0 }}
                                />
                                <span
                                  className="truncate flex-1"
                                  style={{
                                    color: checked ? 'var(--text-on-surface)' : 'var(--text-outline)',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                  title={m}
                                >
                                  {m}
                                </span>
                              </label>
                            )
                          })}
                        </div>
                      ) : fetchError && fetchingModels === null ? (
                        <div style={{ fontSize: 12, color: 'var(--text-danger)' }}>{fetchError}</div>
                      ) : (
                        <div style={{ fontSize: 12, color: 'var(--text-outline)' }}>
                          {fetchingModels === p.id ? 'Fetching…' : 'Not fetched yet.'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      {/* Add provider */}
      {adding ? (
        <Section title="New provider">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
            <Row label="Name">
              <TextInput value={newId} onChange={setNewId} placeholder="openai" />
            </Row>
            <Row label="Type">
              <PillGroup options={['anthropic', 'openai', 'google']} value={newType} onChange={(v) => setNewType(v as ProviderType)} />
            </Row>
            <Row label="Base URL">
              <TextInput value={newURL} onChange={setNewURL} placeholder="https://api.openai.com/v1" mono />
            </Row>
            <Row label="API key">
              <TextInput value={newKey} onChange={setNewKey} placeholder="sk-..." type="password" mono />
            </Row>
            <div className="flex items-center" style={{ gap: 8, paddingTop: 4 }}>
              <PrimaryButton onClick={handleAddProvider}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <div style={{ paddingTop: 4 }}>
          <SecondaryButton onClick={() => setAdding(true)}>
            <span className="flex items-center" style={{ gap: 6 }}>
              <Plus size={13} strokeWidth={1.5} />
              Add provider
            </span>
          </SecondaryButton>
        </div>
      )}

      {/* Model Aliases */}
      <Section
        title="Model aliases"
        hint="A short name the top bar can select in place of a full model id."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {Object.entries(aliases).map(([alias, modelId]) => (
            <div key={alias} className="flex items-center" style={{ gap: 10, padding: '6px 10px', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-primary)', minWidth: 64 }}>{alias}</span>
              <span className="truncate flex-1" style={{ fontSize: 12, color: 'var(--text-on-surface-variant)', fontFamily: 'var(--font-mono)' }}>{modelId}</span>
              <IconButton onClick={() => handleDeleteAlias(alias)} label={`Remove alias ${alias}`} danger>
                <X size={13} strokeWidth={1.5} />
              </IconButton>
            </div>
          ))}
          {Object.keys(aliases).length === 0 && (
            <div style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-outline)' }}>None yet.</div>
          )}
        </div>

        <div className="flex items-center" style={{ gap: 8, marginTop: 12 }}>
          <div style={{ width: 110 }}>
            <TextInput value={newAlias} onChange={setNewAlias} placeholder="alias" />
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-outline)' }}>→</span>
          <div className="flex-1">
            <TextInput value={newModelId} onChange={setNewModelId} placeholder="claude-sonnet-4-20250514" mono />
          </div>
          <SecondaryButton onClick={handleAddAlias}>Add</SecondaryButton>
        </div>
      </Section>

      <Section title="Save">
        <div className="flex items-center" style={{ gap: 8 }}>
          <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save all'}</PrimaryButton>
          {saveError && (
            <span style={{ fontSize: 12, color: 'var(--text-danger)' }}>
              {saveError}
            </span>
          )}
        </div>
      </Section>
    </div>
  )
}

// --- MCP Servers Tab ---

interface McpServerConfig {
  type: string
  /** 本地 stdio 的命令；远端（配了 url）时不需要 */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** 远端 MCP 地址：有 url 就走 HTTP，不起本地进程 */
  url?: string
  headers?: Record<string, string>
}

/** 键名像凭证的，展示时打码（env 与 headers 共用） */
const isSecretKey = (k: string) => /key|token|auth|secret/i.test(k)

/** 解析 KEY=VALUE 逐行 / JSON 两种写法（env 与 headers 共用） */
function parseKeyValues(raw: string): Record<string, string> | undefined {
  if (!raw.trim()) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    const out: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const [k, ...rest] = line.split('=')
      if (k.trim()) out[k.trim()] = rest.join('=').trim()
    }
    return out
  }
}

interface McpServerStatus {
  status: 'connected' | 'connecting' | 'failed'
  toolCount: number
  error?: string
}

const MCP_STATUS_META: Record<McpServerStatus['status'], { color: string; label: string }> = {
  connected: { color: 'var(--text-success)', label: 'Connected' },
  connecting: { color: 'var(--text-warning)', label: 'Connecting' },
  failed: { color: 'var(--text-danger)', label: 'Failed' },
}

function McpTab() {
  const [servers, setServers] = useState<Record<string, McpServerConfig>>({})
  const [statusMap, setStatusMap] = useState<Record<string, McpServerStatus>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'stdio' | 'remote'>('stdio')
  const [newCommand, setNewCommand] = useState('')
  const [newEnv, setNewEnv] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newHeaders, setNewHeaders] = useState('')
  const [saved, setSaved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    window.claude.getMcpServers().then((s: Record<string, McpServerConfig>) => {
      setServers(s || {})
    }).catch(() => {})
    // 真实连接状态：挂载拉一次 + 5s 轮询（连接是异步的）
    let alive = true
    const pull = () => window.claude.getMcpStatus().then((s) => { if (alive) setStatusMap(s || {}) }).catch(() => {})
    pull()
    const timer = setInterval(pull, 5000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const handleSave = async () => {
    await window.claude.saveMcpServers(servers)
    // 主进程保存后已触发热重载，稍等连接结果再刷新状态
    setTimeout(() => {
      window.claude.getMcpStatus().then((s) => setStatusMap(s || {})).catch(() => {})
    }, 1000)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) return
    const next: McpServerConfig = newMode === 'remote'
      ? { type: 'http', url: newUrl.trim(), headers: parseKeyValues(newHeaders) }
      : { type: 'stdio', command: newCommand.trim(), env: parseKeyValues(newEnv) }
    // 必填项：远端要 url，本地要 command
    if (newMode === 'remote' ? !next.url : !next.command) return
    setServers({ ...servers, [name]: next })
    setNewName('')
    setNewCommand('')
    setNewEnv('')
    setNewUrl('')
    setNewHeaders('')
    setAdding(false)
  }

  const handleDelete = (name: string) => {
    const next = { ...servers }
    delete next[name]
    setServers(next)
  }

  const entries = Object.entries(servers)

  return (
    <div>
      <Section title="Servers" hint="Status is polled live; the Gateway reloads a few seconds after you save.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map(([name, cfg]) => {
            const status = MCP_STATUS_META[statusMap[name]?.status ?? 'connecting']
            return (
              <div
                key={name}
                style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-surface-container-high)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                {/* Server row */}
                <div
                  className="flex items-center cursor-pointer transition-colors"
                  style={{ gap: 10, padding: '9px 12px' }}
                  onClick={() => setExpanded(expanded === name ? null : name)}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-on-surface)', flex: 1 }}>
                    {name}
                  </span>
                  <span className="truncate" style={{ fontSize: 11, color: 'var(--text-outline)', fontFamily: 'var(--font-mono)', maxWidth: 220 }}>
                    {cfg.url || cfg.command}
                  </span>
                  <span style={{ fontSize: 11, color: status.color, flexShrink: 0, minWidth: 66, textAlign: 'right' }}>
                    {status.label}
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <IconButton onClick={() => handleDelete(name)} label={`Remove ${name}`} danger>
                      <X size={13} strokeWidth={1.5} />
                    </IconButton>
                  </span>
                </div>

                {/* Expanded details */}
                {expanded === name && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderTop: '1px solid var(--border-subtle)',
                      fontSize: 12,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-on-surface-variant)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                    }}
                  >
                    <div><span style={{ color: 'var(--text-outline)' }}>type</span> {cfg.type}</div>
                    {cfg.url
                      ? <div style={{ wordBreak: 'break-all' }}><span style={{ color: 'var(--text-outline)' }}>url</span> {cfg.url}</div>
                      : <div style={{ wordBreak: 'break-all' }}><span style={{ color: 'var(--text-outline)' }}>command</span> {cfg.command}</div>}
                    {statusMap[name]?.status === 'connected' && (
                      <div><span style={{ color: 'var(--text-outline)' }}>tools</span> {statusMap[name].toolCount}</div>
                    )}
                    {statusMap[name]?.status === 'failed' && (
                      <div style={{ color: 'var(--text-danger)', wordBreak: 'break-all' }}>
                        <span style={{ color: 'var(--text-outline)' }}>error</span> {statusMap[name].error}
                      </div>
                    )}
                    {/* env / headers 都是键值对，凭证打码后展示 */}
                    {([['env', cfg.env], ['headers', cfg.headers]] as const).map(([label, map]) =>
                      map && Object.keys(map).length > 0 ? (
                        <div key={label}>
                          <span style={{ color: 'var(--text-outline)' }}>{label}</span>
                          {Object.entries(map).map(([k, v]) => (
                            <div key={k} style={{ paddingLeft: 12 }}>
                              {k} = {isSecretKey(k) ? '***' : v}
                            </div>
                          ))}
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {entries.length === 0 && (
            <div style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-outline)' }}>
              None configured.
            </div>
          )}
        </div>
      </Section>

      {/* Add form */}
      {adding ? (
        <Section title="New server">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 460 }}>
            <Row label="Name">
              <TextInput value={newName} onChange={setNewName} placeholder="filesystem" />
            </Row>
            <Row label="Transport" hint="stdio starts a local process; HTTP connects to a remote endpoint.">
              <PillGroup
                options={['stdio', 'remote']}
                value={newMode}
                onChange={(m) => setNewMode(m as 'stdio' | 'remote')}
                renderLabel={(m) => (m === 'stdio' ? 'Local (stdio)' : 'Remote (HTTP)')}
              />
            </Row>
            {newMode === 'remote' ? (
              <>
                <Row label="URL">
                  <TextInput value={newUrl} onChange={setNewUrl} placeholder="https://example.com/mcp" mono />
                </Row>
                <Row label="Headers" hint="KEY=VALUE, one per line.">
                  <MultilineInput value={newHeaders} onChange={setNewHeaders} placeholder="Authorization=Bearer …" />
                </Row>
              </>
            ) : (
              <>
                <Row label="Command">
                  <TextInput value={newCommand} onChange={setNewCommand} placeholder="npx obsidian-mcp-server" mono />
                </Row>
                <Row label="Environment" hint="KEY=VALUE, one per line.">
                  <MultilineInput value={newEnv} onChange={setNewEnv} placeholder="API_KEY=…" />
                </Row>
              </>
            )}
            <div className="flex items-center" style={{ gap: 8, paddingTop: 4 }}>
              <PrimaryButton onClick={handleAdd}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <div style={{ paddingTop: 4 }}>
          <SecondaryButton onClick={() => setAdding(true)}>
            <span className="flex items-center" style={{ gap: 6 }}>
              <Plus size={13} strokeWidth={1.5} />
              Add server
            </span>
          </SecondaryButton>
        </div>
      )}

      <Section title="Save">
        <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save and reload'}</PrimaryButton>
      </Section>
    </div>
  )
}

// --- Skills Tab ---

interface Skill {
  id: string
  name: string
  description: string
  prompt: string
  enabled: boolean
}

function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([])

  useEffect(() => {
    window.claude.getSkills().then((s: Skill[]) => {
      setSkills(s || [])
    }).catch(() => {})
  }, [])

  const handleToggle = async (id: string) => {
    const skill = skills.find((s) => s.id === id)
    if (!skill) return
    const newEnabled = !skill.enabled
    setSkills(skills.map((s) => s.id === id ? { ...s, enabled: newEnabled } : s))
    await window.claude.toggleSkill(id, newEnabled)
  }

  return (
    <div>
      <Section
        title="Skills"
        hint="Read from .agents/skills/*/SKILL.md in the working directory. A skill needs frontmatter with name and description."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center"
              style={{ gap: 12, padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}
            >
              <Toggle
                on={skill.enabled}
                onChange={() => handleToggle(skill.id)}
                label={`Toggle ${skill.name}`}
              />

              <div className="flex-1 min-w-0">
                <span className="block truncate" style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-on-surface)' }}>
                  {skill.name}
                </span>
                {skill.description && (
                  <span className="block" style={{ fontSize: 11, color: 'var(--text-outline)', lineHeight: 1.45 }}>
                    {skill.description.length > 140 ? skill.description.slice(0, 140) + '…' : skill.description}
                  </span>
                )}
              </div>

              <span
                className="shrink-0"
                style={{ fontSize: 11, color: skill.enabled ? 'var(--text-on-surface-variant)' : 'var(--text-outline)' }}
              >
                {skill.enabled ? 'On' : 'Off'}
              </span>
            </div>
          ))}

          {skills.length === 0 && (
            <div style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-outline)' }}>
              None found.
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}

// --- Voice Tab ---

function VoiceTab() {
  const [endpoint, setEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('mimo-v2.5')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [providerInfo, setProviderInfo] = useState<{ baseURL: string; hasKey: boolean }>({ baseURL: '', hasKey: false })

  useEffect(() => {
    window.claude.getNerveSettings().then((s: any) => {
      setEndpoint(s.sttEndpoint || '')
      setApiKey(s.sttApiKey || '')
      setModel(s.sttModel || 'mimo-v2.5')
      setProviderInfo({ baseURL: s.baseURL || '', hasKey: !!s.authToken })
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await window.claude.saveNerveSettings({ sttEndpoint: endpoint, sttApiKey: apiKey, sttModel: model })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleTest = async () => {
    setTestResult(null)
    // Generate a short test audio via MediaRecorder
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }

      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })
      recorder.start()
      // Record for 2 seconds
      setTimeout(() => recorder.stop(), 2000)
      await stopped
      stream.getTracks().forEach((t) => t.stop())

      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      const arrayBuffer = await blob.arrayBuffer()
      const result = await window.claude.transcribeAudio(new Uint8Array(arrayBuffer), blob.type)
      setTestResult(result.ok
        ? { ok: true, error: result.text ? `Heard: "${result.text}"` : undefined }
        : { ok: false, error: result.error }
      )
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message })
    }
  }

  const fallbackNote = (!endpoint || !apiKey)
    ? `Falls back to the Provider config — ${providerInfo.baseURL || 'no endpoint set'}, ${providerInfo.hasKey ? 'key set' : 'no key'}`
    : null

  return (
    <div>
      <Section
        title="Voice input"
        hint="Transcribes dictation with an audio-capable LLM. Leave these empty to reuse the Provider endpoint and key."
      >
        <Row label="Endpoint" stack>
          <TextInput
            value={endpoint}
            onChange={setEndpoint}
            placeholder="https://api.xiaomimimo.com"
            mono
          />
          {fallbackNote && <Hint>{fallbackNote}</Hint>}
        </Row>

        <Row label="API key" stack>
          <TextInput
            value={apiKey}
            onChange={setApiKey}
            placeholder="Empty — use the Provider key"
            type={showKey ? 'text' : 'password'}
            mono
            rightSlot={
              <IconButton
                onClick={() => setShowKey(!showKey)}
                label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
              </IconButton>
            }
          />
        </Row>

        <Row label="Model" hint="Must accept audio input — mimo-v2.5, mimo-v2-omni." stack>
          <TextInput value={model} onChange={setModel} placeholder="mimo-v2.5" mono />
        </Row>
      </Section>

      <Section title="Verify">
        <div className="settings-card-pad">
        <div className="flex items-center" style={{ gap: 8 }}>
          <SecondaryButton onClick={handleTest}>Record 2s and transcribe</SecondaryButton>
          <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save'}</PrimaryButton>
        </div>
        {testResult && (
          <div style={{ marginTop: 12 }}>
            <StatusBadge
              ok={testResult.ok}
              text={testResult.ok ? (testResult.error || 'STT working') : (testResult.error || '')}
            />
          </div>
        )}
        </div>
      </Section>
    </div>
  )
}

// --- Channels Tab ---

function ChannelsTab() {
  const [channels, setChannels] = useState<GatewayChannel[]>([])
  const [adding, setAdding] = useState(false)
  const [newPlatform, setNewPlatform] = useState<ChannelPlatform>('telegram')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [justSavedId, setJustSavedId] = useState<string | null>(null)
  const [editConfig, setEditConfig] = useState<Record<string, Record<string, string>>>({})
  const [proxyEnabled, setProxyEnabled] = useState(false)
  const [proxyHost, setProxyHost] = useState('127.0.0.1')
  const [proxyPort, setProxyPort] = useState('7890')
  const [proxyProtocol, setProxyProtocol] = useState<'http' | 'socks5'>('http')
  const [publicAccessEnabled, setPublicAccessEnabled] = useState(false)
  const [publicAccessToken, setPublicAccessToken] = useState('')

  useEffect(() => {
    (window.claude as any).gatewayChannelsGet().then((chs: GatewayChannel[]) => {
      setChannels(chs || {})
      const cfg: Record<string, Record<string, string>> = {}
      for (const ch of chs) cfg[ch.id] = { ...ch.config }
      setEditConfig(cfg)
    }).catch(() => {})
    ;(window.claude as any).gatewayProxyGet().then((p: any) => {
      if (p) {
        setProxyEnabled(p.enabled ?? false)
        setProxyHost(p.host ?? '127.0.0.1')
        setProxyPort(String(p.port ?? 7890))
        setProxyProtocol(p.protocol ?? 'http')
      }
    }).catch(() => {})
    ;(window.claude as any).gatewayPublicAccessGet().then((pa: any) => {
      if (pa) {
        setPublicAccessEnabled(pa.publicAccess ?? false)
        setPublicAccessToken(pa.token ?? '')
      }
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    // 保存代理配置
    await (window.claude as any).gatewayProxySave({
      enabled: proxyEnabled,
      host: proxyHost,
      port: parseInt(proxyPort) || 7890,
      protocol: proxyProtocol,
    })
    // 保存公网访问配置
    await (window.claude as any).gatewayPublicAccessSave({
      publicAccess: publicAccessEnabled,
      token: publicAccessToken || undefined,
    })
    // 把 editConfig 同步回 channels
    const updated = channels.map(ch => ({ ...ch, config: editConfig[ch.id] || ch.config }))
    await (window.claude as any).gatewayChannelsSave(updated)
    setChannels(updated)
    setSaved(true)
    const savedId = expanded
    setExpanded(null)
    setJustSavedId(savedId)
    setTimeout(() => setSaved(false), 2000)
    setTimeout(() => setJustSavedId(null), 3000)
  }

  const handleAdd = () => {
    const id = `${newPlatform}-${Date.now()}`
    const ch: GatewayChannel = {
      id,
      platform: newPlatform,
      name: CHANNEL_PLATFORM_LABELS[newPlatform],
      enabled: true,
      config: {},
    }
    const next = [...channels, ch]
    setChannels(next)
    setEditConfig(prev => ({ ...prev, [id]: {} }))
    setNewPlatform('telegram')
    setAdding(false)
    setExpanded(id)
  }

  const handleDelete = (id: string) => {
    setChannels(prev => prev.filter(ch => ch.id !== id))
    setEditConfig(prev => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (expanded === id) setExpanded(null)
  }

  const handleToggle = (id: string) => {
    setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, enabled: !ch.enabled } : ch))
  }

  const updateField = (id: string, key: string, value: string) => {
    setEditConfig(prev => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }))
  }

  const platforms = Object.keys(CHANNEL_PLATFORM_LABELS) as ChannelPlatform[]

  return (
    <div>
      <Section
        title="Network proxy"
        hint="Route outbound IM traffic through a proxy. Takes effect after the Gateway restarts."
      >
        <Row label="Enabled">
          <Toggle
            on={proxyEnabled}
            onChange={() => setProxyEnabled(!proxyEnabled)}
            label="Enable network proxy"
          />
        </Row>
        {proxyEnabled && (
          <>
            <Row label="Protocol">
              <PillGroup
                options={['http', 'socks5']}
                value={proxyProtocol}
                onChange={(p) => setProxyProtocol(p as 'http' | 'socks5')}
                renderLabel={(p) => (p === 'http' ? 'HTTP' : 'SOCKS5')}
              />
            </Row>
            <Row label="Host">
              <TextInput value={proxyHost} onChange={setProxyHost} placeholder="127.0.0.1" mono />
            </Row>
            <Row label="Port">
              <TextInput value={proxyPort} onChange={setProxyPort} placeholder="7897" mono />
            </Row>
            <Hint>{proxyProtocol}://{proxyHost}:{proxyPort}</Hint>
          </>
        )}
      </Section>

      <Section
        title="Public access"
        hint="Lets an external program reach this agent over WebSocket. Pair it with cloudflared or a public IP for TLS."
      >
        <Row label="Enabled">
          <Toggle
            on={publicAccessEnabled}
            onChange={() => setPublicAccessEnabled(!publicAccessEnabled)}
            label="Enable public access"
          />
        </Row>
        {publicAccessEnabled && (
          <>
            <Row label="Access token" hint="Required — public mode stays off without one.">
              <TextInput
                value={publicAccessToken}
                onChange={setPublicAccessToken}
                placeholder="A long random string"
                mono
                type="password"
              />
            </Row>
            <Hint>
              Endpoint: <span style={{ fontFamily: 'var(--font-mono)' }}>ws://your-ip:18789</span>
            </Hint>
          </>
        )}
      </Section>

      <Section title="IM channels" hint="Message platforms Nerve Agent talks to you over.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {channels.map((ch) => {
            const isExpanded = expanded === ch.id
            const isJustSaved = justSavedId === ch.id
            const fields = CHANNEL_FIELDS[ch.platform] || []
            const cfg = editConfig[ch.id] || {}

            return (
              <div
                key={ch.id}
                style={{
                  borderRadius: 'var(--radius-md)',
                  overflow: 'hidden',
                  background: 'var(--bg-surface-container-high)',
                  border: `1px solid ${isJustSaved ? 'var(--text-success)' : 'var(--border-subtle)'}`,
                  transition: 'border-color 0.2s',
                }}
              >
                {/* Row */}
                <div
                  className="flex items-center cursor-pointer transition-colors"
                  style={{ gap: 10, padding: '9px 12px' }}
                  onClick={() => setExpanded(isExpanded ? null : ch.id)}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-on-surface)', flex: 1 }}>
                    {ch.name}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-outline)' }}>
                    {CHANNEL_PLATFORM_LABELS[ch.platform]}
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Toggle
                      on={ch.enabled}
                      onChange={() => handleToggle(ch.id)}
                      label={`Toggle ${ch.name}`}
                    />
                  </span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <IconButton onClick={() => handleDelete(ch.id)} label={`Remove ${ch.name}`} danger>
                      <X size={13} strokeWidth={1.5} />
                    </IconButton>
                  </span>
                </div>

                {/* Expanded config */}
                {isExpanded && (
                  <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {fields.map((field) => (
                      <Row key={field.key} label={field.label}>
                        <TextInput
                          value={cfg[field.key] || ''}
                          onChange={(v) => updateField(ch.id, field.key, v)}
                          placeholder={field.placeholder || field.label}
                          type={field.secret ? 'password' : 'text'}
                          mono
                        />
                      </Row>
                    ))}
                    {fields.length === 0 && (
                      <div style={{ fontSize: 12, color: 'var(--text-outline)' }}>
                        This platform has nothing to configure.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {channels.length === 0 && !adding && (
            <div style={{ fontSize: 12, padding: '6px 0', color: 'var(--text-outline)' }}>
              None configured.
            </div>
          )}
        </div>
      </Section>

      {/* Add new */}
      {adding ? (
        <Section title="Add channel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 380 }}>
            <Row label="Platform">
              <PillGroup
                options={platforms}
                value={newPlatform}
                onChange={(p) => setNewPlatform(p as ChannelPlatform)}
                renderLabel={(p) => CHANNEL_PLATFORM_LABELS[p as ChannelPlatform]}
              />
            </Row>
            <div className="flex items-center" style={{ gap: 8, paddingTop: 4 }}>
              <PrimaryButton onClick={handleAdd}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <div style={{ paddingTop: 4 }}>
          <SecondaryButton onClick={() => setAdding(true)}>
            <span className="flex items-center" style={{ gap: 6 }}>
              <Plus size={13} strokeWidth={1.5} />
              Add channel
            </span>
          </SecondaryButton>
        </div>
      )}

      {/* Save */}
      <Section title="Save">
        <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save'}</PrimaryButton>
      </Section>
    </div>
  )
}
