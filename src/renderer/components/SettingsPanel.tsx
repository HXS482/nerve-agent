import { useState, useEffect } from 'react'
import { ClaudeConfig, GatewayChannel, ChannelPlatform, CHANNEL_FIELDS, CHANNEL_PLATFORM_LABELS } from '../../shared/types'
import { useChatStore } from '../stores/chatStore'

interface Props {
  config: ClaudeConfig
  onUpdateConfig: (partial: Partial<ClaudeConfig>) => void
  onPickDirectory: () => void
  onClose: () => void
}

type Tab = 'general' | 'provider' | 'mcp' | 'skills' | 'voice' | 'channels'

const EFFORTS: ClaudeConfig['effort'][] = ['low', 'medium', 'high', 'xhigh', 'max']
const PERMISSION_MODES: ClaudeConfig['permissionMode'][] = ['default', 'acceptEdits', 'auto', 'bypassPermissions']

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    ),
  },
  {
    id: 'provider',
    label: 'Provider',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: 'mcp',
    label: 'MCP Servers',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    id: 'voice',
    label: 'Voice',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
        <path d="M19 10v2a7 7 0 01-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
    ),
  },
  {
    id: 'channels',
    label: 'Channels',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
  },
]

// --- Shared UI Primitives ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        className="text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--text-outline)', marginBottom: 10 }}
      >
        {title}
      </div>
      {children}
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
              padding: '5px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: active ? 600 : 400,
              background: active ? 'rgba(173, 198, 255, 0.12)' : 'var(--bg-surface-container-high)',
              color: active ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
              border: `1px solid ${active ? 'rgba(173, 198, 255, 0.25)' : 'transparent'}`,
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
          padding: rightSlot ? '7px 36px 7px 10px' : '7px 10px',
          borderRadius: 8,
          fontSize: 12,
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined,
          background: 'var(--bg-surface-container-high)',
          color: 'var(--text-on-surface)',
          border: '1px solid var(--border-subtle)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
      />
      {rightSlot && (
        <div style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}>
          {rightSlot}
        </div>
      )}
    </div>
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
        padding: '6px 16px',
        borderRadius: 8,
        fontSize: 11,
        fontWeight: 600,
        background: 'var(--accent-primary)',
        color: '#fff',
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
        padding: '6px 16px',
        borderRadius: 8,
        fontSize: 11,
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
    <div className="text-[11px] font-medium" style={{ color: 'var(--text-on-surface-variant)', marginBottom: 6 }}>
      {children}
    </div>
  )
}

function StatusBadge({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderRadius: 8,
        fontSize: 11,
        background: ok ? 'rgba(39, 201, 63, 0.1)' : 'rgba(255, 95, 86, 0.1)',
        border: `1px solid ${ok ? 'rgba(39, 201, 63, 0.25)' : 'rgba(255, 95, 86, 0.25)'}`,
        color: ok ? '#27c93f' : '#ff5f56',
      }}
    >
      {text}
    </div>
  )
}

// --- Main Panel ---

export function SettingsPanel({ config, onUpdateConfig, onPickDirectory, onClose }: Props) {
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
          width: 'min(680px, calc(100vw - 48px))',
          height: 'min(520px, calc(100vh - 48px))',
          display: 'flex',
          background: 'var(--dynamic-island-bg)',
          backdropFilter: 'var(--dynamic-island-blur)',
          WebkitBackdropFilter: 'var(--dynamic-island-blur)',
          border: '1px solid var(--dynamic-island-border)',
          borderRadius: 20,
          boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          overflow: 'hidden',
        }}
      >
        {/* Left sidebar */}
        <div
          className="shrink-0 flex flex-col"
          style={{
            width: 164,
            borderRight: '1px solid var(--border-subtle)',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          {/* Sidebar header */}
          <div
            className="no-select"
            style={{
              padding: '18px 18px 14px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div className="text-[13px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>
              Settings
            </div>
          </div>

          {/* Tab buttons */}
          <div className="flex flex-col" style={{ padding: '8px 8px', gap: 2 }}>
            {TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="flex items-center transition-colors cursor-pointer"
                  style={{
                    gap: 9,
                    padding: '8px 10px',
                    borderRadius: 10,
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    background: active ? 'rgba(173, 198, 255, 0.08)' : 'transparent',
                    color: active ? 'var(--accent-primary)' : 'var(--text-on-surface-variant)',
                  }}
                  onMouseEnter={(e) => {
                    if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }}
                  onMouseLeave={(e) => {
                    if (!active) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {t.icon}
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div
            className="flex items-center justify-between shrink-0"
            style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span className="text-[13px] font-semibold" style={{ color: 'var(--text-on-surface)' }}>
              {TABS.find((t) => t.id === tab)?.label}
            </span>
            <button
              onClick={onClose}
              className="cursor-pointer transition-colors"
              style={{
                padding: 5,
                borderRadius: 8,
                color: 'var(--text-outline)',
                background: 'transparent',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
                e.currentTarget.style.color = 'var(--text-on-surface)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--text-outline)'
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab content — scrollable */}
          <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ padding: 20 }}>
            {tab === 'general' && (
              <GeneralTab config={config} onUpdateConfig={onUpdateConfig} onPickDirectory={onPickDirectory} />
            )}
            {tab === 'provider' && <ProviderTab />}
            {tab === 'mcp' && <McpTab />}
            {tab === 'skills' && <SkillsTab />}
            {tab === 'voice' && <VoiceTab />}
            {tab === 'channels' && <ChannelsTab />}
          </div>
        </div>
      </div>
    </>
  )
}

// --- General Tab ---

function GeneralTab({ config, onUpdateConfig, onPickDirectory }: {
  config: ClaudeConfig
  onUpdateConfig: (partial: Partial<ClaudeConfig>) => void
  onPickDirectory: () => void
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
      <Section title="Provider Group">
        <div className="text-[11px] mb-2" style={{ color: 'var(--text-outline)' }}>
          Select which provider group to use. Models are grouped by provider in the top bar.
        </div>
        <PillGroup
          options={allProviderIds}
          value={activeProvider}
          onChange={(id) => onUpdateConfig({ provider: id })}
        />
        {hasModels && (
          <div className="text-[10px] mt-2" style={{ color: 'var(--text-outline)' }}>
            {activeModels.length} model{activeModels.length > 1 ? 's' : ''} in this group
          </div>
        )}
      </Section>

      <Section title="Effort">
        <PillGroup
          options={EFFORTS}
          value={config.effort}
          onChange={(e) => onUpdateConfig({ effort: e as ClaudeConfig['effort'] })}
        />
      </Section>

      <Section title="Permission Mode">
        <PillGroup
          options={PERMISSION_MODES}
          value={config.permissionMode}
          onChange={(pm) => onUpdateConfig({ permissionMode: pm as ClaudeConfig['permissionMode'] })}
        />
      </Section>

      <Section title="Working Directory">
        <div className="flex items-center" style={{ gap: 10 }}>
          <span className="text-[12px] truncate" style={{ color: 'var(--text-on-surface-variant)', maxWidth: 340 }}>
            {config.cwd || 'Not set'}
          </span>
          <SecondaryButton onClick={onPickDirectory}>Change</SecondaryButton>
        </div>
      </Section>
    </div>
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
  const [fetchSuccess, setFetchSuccess] = useState<string | null>(null)
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

  const handleSave = async () => {
    await window.claude.saveNerveSettings({
      baseURL, authToken,
      modelAliases: aliases,
      providers,
      defaultProvider,
    })
    // Sync providerModels and defaultProvider in chatStore so UI updates immediately
    const { setProviderModels, setDefaultProvider } = useChatStore.getState()
    setDefaultProvider(defaultProvider)
    if (providers.anthropic?.models) setProviderModels('anthropic', providers.anthropic.models)
    for (const [id, config] of Object.entries(providers)) {
      if (id !== 'anthropic' && config.models) setProviderModels(id, config.models)
    }
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
    setFetchSuccess(null)
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
        setFetchSuccess(providerId)
        setTimeout(() => setFetchSuccess(null), 3000)
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
    setSavedProvider(providerId)
    setTimeout(() => setSavedProvider(null), 2000)
  }

  const handleDeleteProvider = (id: string) => {
    const next = { ...providers }
    delete next[id]
    setProviders(next)
    if (defaultProvider === id) setDefaultProvider('')
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

  const EyeIcon = (props: { show: boolean }) => props.show ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )

  return (
    <div>
      <Section title="Providers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {allProviders.map((p) => {
            const isDefault = p.id === (defaultProvider || 'anthropic')
            const isExpanded = expanded === p.id
            const isBase = p.id === 'anthropic'

            return (
              <div
                key={p.id}
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: 'var(--bg-surface-container-high)',
                  border: `1px solid ${isDefault ? 'rgba(173, 198, 255, 0.25)' : 'var(--border-subtle)'}`,
                }}
              >
                {/* Provider row */}
                <div
                  className="flex items-center cursor-pointer transition-colors"
                  style={{ gap: 10, padding: '10px 12px' }}
                  onClick={() => setExpanded(isExpanded ? null : p.id)}
                >
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: isDefault ? '#27c93f' : 'var(--text-outline-variant)',
                    flexShrink: 0,
                  }} />
                  <span className="text-[12px] font-medium flex-1" style={{ color: 'var(--text-on-surface)' }}>
                    {p.id}
                  </span>
                  <span className="text-[10px] shrink-0" style={{
                    padding: '1px 6px', borderRadius: 4,
                    background: isDefault ? 'rgba(39, 201, 63, 0.1)' : 'rgba(255,255,255,0.06)',
                    color: isDefault ? '#27c93f' : 'var(--text-outline)',
                  }}>
                    {isDefault ? 'default' : p.type}
                  </span>
                  {!isBase && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteProvider(p.id) }}
                      className="cursor-pointer transition-colors"
                      style={{ padding: 3, borderRadius: 6, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ff5f56' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
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
                              <button onClick={() => setShowKeys({ ...showKeys, 'anthropic': !showKeys['anthropic'] })} className="cursor-pointer" style={{ padding: 3, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }}>
                                <EyeIcon show={!!showKeys['anthropic']} />
                              </button>
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
                              <button onClick={() => setShowKeys({ ...showKeys, [p.id]: !showKeys[p.id] })} className="cursor-pointer" style={{ padding: 3, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }}>
                                <EyeIcon show={!!showKeys[p.id]} />
                              </button>
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
                    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8, marginTop: 4 }}>
                      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
                        <FieldLabel>Models</FieldLabel>
                        <div className="flex items-center" style={{ gap: 4 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFetchModels(p.id) }}
                            disabled={fetchingModels === p.id}
                            className="cursor-pointer transition-colors text-[10px] font-medium"
                            style={{
                              padding: '3px 8px', borderRadius: 6,
                              background: fetchingModels === p.id ? 'rgba(255,255,255,0.06)' : 'rgba(173, 198, 255, 0.12)',
                              color: fetchingModels === p.id ? 'var(--text-outline)' : 'var(--accent-primary)',
                              border: 'none',
                              opacity: fetchingModels === p.id ? 0.6 : 1,
                            }}
                          >
                            {fetchingModels === p.id ? 'Fetching...' : 'Fetch'}
                          </button>
                          {p.models && p.models.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleSaveProvider(p.id)
                              }}
                              className="cursor-pointer transition-colors text-[10px] font-medium"
                              style={{
                                padding: '3px 8px', borderRadius: 6,
                                background: savedProvider === p.id ? 'rgba(39, 201, 63, 0.2)' : 'rgba(39, 201, 63, 0.12)',
                                color: '#27c93f',
                                border: 'none',
                              }}
                            >
                              {savedProvider === p.id ? 'Saved' : 'Save'}
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
                                style={{ gap: 6, padding: '3px 6px', borderRadius: 6, fontSize: 11 }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
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
                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
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
                        <div className="text-[10px]" style={{ color: '#ff5f56' }}>{fetchError}</div>
                      ) : (
                        <div className="text-[10px]" style={{ color: 'var(--text-outline)' }}>
                          {fetchingModels === p.id ? 'Fetching...' : 'No models — click Fetch'}
                        </div>
                      )}
                      {fetchSuccess === p.id && (
                        <div className="text-[10px]" style={{ color: '#27c93f' }}>Fetched {p.models?.length || 0} models</div>
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
        <Section title="New Provider">
          <div style={{ padding: 14, borderRadius: 12, background: 'var(--bg-surface-container-high)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <TextInput value={newId} onChange={setNewId} placeholder="Provider name (e.g. openai)" />
            <PillGroup options={['anthropic', 'openai', 'google']} value={newType} onChange={(v) => setNewType(v as ProviderType)} />
            <TextInput value={newURL} onChange={setNewURL} placeholder="Base URL" />
            <TextInput value={newKey} onChange={setNewKey} placeholder="API Key" type="password" mono />
            <div className="flex items-center" style={{ gap: 8 }}>
              <PrimaryButton onClick={handleAddProvider}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <SecondaryButton onClick={() => setAdding(true)}>
          <span className="flex items-center" style={{ gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Provider
          </span>
        </SecondaryButton>
      )}

      {/* Model Aliases */}
      <Section title="Model Aliases">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(aliases).map(([alias, modelId]) => (
            <div key={alias} className="flex items-center" style={{ gap: 10, padding: '8px 12px', borderRadius: 10, background: 'var(--bg-surface-container-high)' }}>
              <span className="text-[11px] font-semibold shrink-0" style={{ color: 'var(--accent-primary)', minWidth: 60 }}>{alias}</span>
              <span className="text-[11px] truncate flex-1" style={{ color: 'var(--text-on-surface-variant)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{modelId}</span>
              <button onClick={() => handleDeleteAlias(alias)} className="cursor-pointer transition-colors" style={{ padding: 3, borderRadius: 6, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }} onMouseEnter={(e) => { e.currentTarget.style.color = '#ff5f56' }} onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
            </div>
          ))}
          {Object.keys(aliases).length === 0 && (
            <div className="text-[11px] py-3" style={{ color: 'var(--text-outline)' }}>No model aliases configured.</div>
          )}
        </div>
      </Section>

      <Section title="Add Alias">
        <div className="flex items-center" style={{ gap: 8 }}>
          <div style={{ width: 100 }}><TextInput value={newAlias} onChange={setNewAlias} placeholder="alias" /></div>
          <span className="text-[11px]" style={{ color: 'var(--text-outline)' }}>=</span>
          <div className="flex-1"><TextInput value={newModelId} onChange={setNewModelId} placeholder="claude-sonnet-4-20250514" mono /></div>
          <SecondaryButton onClick={handleAddAlias}>Add</SecondaryButton>
        </div>
      </Section>

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save All'}</PrimaryButton>
      </div>
    </div>
  )
}

// --- MCP Servers Tab ---

interface McpServerConfig {
  type: string
  command: string
  env?: Record<string, string>
}

function McpTab() {
  const [servers, setServers] = useState<Record<string, McpServerConfig>>({})
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newEnv, setNewEnv] = useState('')
  const [saved, setSaved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    window.claude.getMcpServers().then((s: Record<string, McpServerConfig>) => {
      setServers(s || {})
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    await window.claude.saveMcpServers(servers)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAdd = () => {
    if (!newName.trim() || !newCommand.trim()) return
    let env: Record<string, string> | undefined
    if (newEnv.trim()) {
      try {
        env = JSON.parse(newEnv)
      } catch {
        env = {}
        for (const line of newEnv.split('\n')) {
          const [k, ...rest] = line.split('=')
          if (k.trim()) env[k.trim()] = rest.join('=').trim()
        }
      }
    }
    setServers({ ...servers, [newName.trim()]: { type: 'stdio', command: newCommand.trim(), env } })
    setNewName('')
    setNewCommand('')
    setNewEnv('')
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
      <Section title="Configured Servers">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map(([name, cfg]) => (
            <div
              key={name}
              style={{
                borderRadius: 12,
                overflow: 'hidden',
                background: 'var(--bg-surface-container-high)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {/* Server row */}
              <div
                className="flex items-center cursor-pointer transition-colors"
                style={{ gap: 10, padding: '10px 12px' }}
                onClick={() => setExpanded(expanded === name ? null : name)}
              >
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: '#27c93f',
                    flexShrink: 0,
                  }}
                />
                <span className="text-[12px] font-medium flex-1" style={{ color: 'var(--text-on-surface)' }}>
                  {name}
                </span>
                <span className="text-[10px] truncate" style={{ color: 'var(--text-outline)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', maxWidth: 200 }}>
                  {cfg.command}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(name) }}
                  className="cursor-pointer transition-colors"
                  style={{
                    padding: 3,
                    borderRadius: 6,
                    color: 'var(--text-outline)',
                    background: 'transparent',
                    border: 'none',
                    display: 'flex',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ff5f56' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>

              {/* Expanded details */}
              {expanded === name && (
                <div
                  style={{
                    padding: '8px 12px',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: 10,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: 'var(--text-on-surface-variant)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div><span style={{ color: 'var(--text-outline)' }}>type:</span> {cfg.type}</div>
                  <div><span style={{ color: 'var(--text-outline)' }}>command:</span> {cfg.command}</div>
                  {cfg.env && Object.keys(cfg.env).length > 0 && (
                    <div>
                      <span style={{ color: 'var(--text-outline)' }}>env:</span>
                      {Object.entries(cfg.env).map(([k, v]) => (
                        <div key={k} style={{ paddingLeft: 12 }}>
                          {k} = {k.toLowerCase().includes('key') || k.toLowerCase().includes('token') ? '***' : v}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {entries.length === 0 && (
            <div className="text-[11px] py-3" style={{ color: 'var(--text-outline)' }}>
              No MCP servers configured.
            </div>
          )}
        </div>
      </Section>

      {/* Add form */}
      {adding ? (
        <Section title="New Server">
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: 'var(--bg-surface-container-high)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <TextInput value={newName} onChange={setNewName} placeholder="Server name" />
            <TextInput value={newCommand} onChange={setNewCommand} placeholder="Command (e.g. npx obsidian-mcp-server)" />
            <div>
              <textarea
                value={newEnv}
                onChange={(e) => setNewEnv(e.target.value)}
                placeholder="Environment variables (KEY=VALUE, one per line)"
                rows={3}
                className="w-full outline-none transition-colors resize-none"
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  background: 'var(--bg-surface-container)',
                  color: 'var(--text-on-surface)',
                  border: '1px solid var(--border-subtle)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)' }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}
              />
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <PrimaryButton onClick={handleAdd}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <SecondaryButton onClick={() => setAdding(true)}>
          <span className="flex items-center" style={{ gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add Server
          </span>
        </SecondaryButton>
      )}

      <div style={{ marginTop: 16 }}>
        <PrimaryButton onClick={handleSave}>
          {saved ? 'Saved' : 'Save MCP Config'}
        </PrimaryButton>
      </div>
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
      <Section title="Detected Skills">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {skills.map((skill) => (
            <div
              key={skill.id}
              style={{
                borderRadius: 12,
                padding: '10px 12px',
                background: 'var(--bg-surface-container-high)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="flex items-center" style={{ gap: 10 }}>
                {/* Toggle */}
                <button
                  onClick={() => handleToggle(skill.id)}
                  className="cursor-pointer transition-colors"
                  style={{
                    width: 32,
                    height: 18,
                    borderRadius: 9,
                    padding: 2,
                    background: skill.enabled ? 'var(--accent-primary)' : 'rgba(255,255,255,0.12)',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: skill.enabled ? 'flex-end' : 'flex-start',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: '50%',
                      background: '#fff',
                    }}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <span className="text-[12px] font-medium block truncate" style={{ color: 'var(--text-on-surface)' }}>
                    {skill.name}
                  </span>
                  {skill.description && (
                    <span className="text-[10px] block" style={{ color: 'var(--text-outline)', lineHeight: 1.4 }}>
                      {skill.description.length > 120 ? skill.description.slice(0, 120) + '...' : skill.description}
                    </span>
                  )}
                </div>

                <span
                  className="text-[10px] shrink-0"
                  style={{ color: skill.enabled ? '#34d399' : 'var(--text-outline)' }}
                >
                  {skill.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            </div>
          ))}

          {skills.length === 0 && (
            <div className="text-[11px] py-3" style={{ color: 'var(--text-outline)' }}>
              No skills found in <code>.agents/skills/</code>. Add SKILL.md files to get started.
            </div>
          )}
        </div>
      </Section>

      <div className="text-[10px] mt-3" style={{ color: 'var(--text-outline)', lineHeight: 1.5 }}>
        Skills are loaded from <code>.agents/skills/*/SKILL.md</code> in your working directory.
        Place a folder with a SKILL.md file (with frontmatter: name, description) to add a new skill.
      </div>
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
    ? `Falls back to Provider config (${providerInfo.baseURL || 'not set'}, ${providerInfo.hasKey ? 'key set' : 'no key'})`
    : null

  const EyeIcon = showKey ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )

  return (
    <div>
      <Section title="Voice Input (STT)">
        <div className="text-[11px] mb-4" style={{ color: 'var(--text-outline)', lineHeight: 1.5 }}>
          Uses an LLM with audio understanding to transcribe your voice.
          If not configured separately, it reuses the Provider endpoint and API key.
        </div>
      </Section>

      <Section title="API Endpoint (optional)">
        <TextInput
          value={endpoint}
          onChange={setEndpoint}
          placeholder="https://api.xiaomimimo.com"
        />
        {fallbackNote && (
          <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-outline)' }}>
            {fallbackNote}
          </div>
        )}
      </Section>

      <Section title="API Key (optional)">
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          placeholder="Leave empty to use Provider key"
          type={showKey ? 'text' : 'password'}
          mono
          rightSlot={
            <button
              onClick={() => setShowKey(!showKey)}
              className="cursor-pointer transition-colors"
              style={{ padding: 3, borderRadius: 4, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }}
            >
              {EyeIcon}
            </button>
          }
        />
      </Section>

      <Section title="Model">
        <TextInput
          value={model}
          onChange={setModel}
          placeholder="mimo-v2.5"
          mono
        />
        <div className="text-[10px] mt-1.5" style={{ color: 'var(--text-outline)' }}>
          Must support audio input (e.g. mimo-v2.5, mimo-v2-omni)
        </div>
      </Section>

      <Section title="Actions">
        <div className="flex items-center" style={{ gap: 8 }}>
          <PrimaryButton onClick={handleSave}>
            {saved ? 'Saved' : 'Save'}
          </PrimaryButton>
          <SecondaryButton onClick={handleTest}>
            Test (records 2s)
          </SecondaryButton>
        </div>
      </Section>

      {testResult && (
        <StatusBadge ok={testResult.ok} text={testResult.ok ? (testResult.error || 'STT working') : `Failed: ${testResult.error}`} />
      )}
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
  const [editConfig, setEditConfig] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    (window.claude as any).gatewayChannelsGet().then((chs: GatewayChannel[]) => {
      setChannels(chs || {})
      // 初始化编辑态
      const cfg: Record<string, Record<string, string>> = {}
      for (const ch of chs) cfg[ch.id] = { ...ch.config }
      setEditConfig(cfg)
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    // 把 editConfig 同步回 channels
    const updated = channels.map(ch => ({ ...ch, config: editConfig[ch.id] || ch.config }))
    await (window.claude as any).gatewayChannelsSave(updated)
    setChannels(updated)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
      <Section title="IM Channels">
        <div className="text-[11px] mb-3" style={{ color: 'var(--text-outline)' }}>
          配置 IM 通道，让 Nerve Agent 通过消息平台与你交互。
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {channels.map((ch) => {
            const isExpanded = expanded === ch.id
            const fields = CHANNEL_FIELDS[ch.platform] || []
            const cfg = editConfig[ch.id] || {}

            return (
              <div
                key={ch.id}
                style={{
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: 'var(--bg-surface-container-high)',
                  border: `1px solid ${ch.enabled ? 'var(--border-subtle)' : 'rgba(255,255,255,0.04)'}`,
                  opacity: ch.enabled ? 1 : 0.6,
                }}
              >
                {/* Row */}
                <div
                  className="flex items-center cursor-pointer transition-colors"
                  style={{ gap: 10, padding: '10px 12px' }}
                  onClick={() => setExpanded(isExpanded ? null : ch.id)}
                >
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: ch.enabled ? '#27c93f' : '#484f58',
                      flexShrink: 0,
                    }}
                  />
                  <span className="text-[12px] font-medium flex-1" style={{ color: 'var(--text-on-surface)' }}>
                    {ch.name}
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-outline)' }}>
                    {CHANNEL_PLATFORM_LABELS[ch.platform]}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggle(ch.id) }}
                    className="cursor-pointer transition-colors"
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 10,
                      color: ch.enabled ? '#27c93f' : 'var(--text-outline)',
                      background: ch.enabled ? 'rgba(39,201,63,0.1)' : 'transparent',
                      border: `1px solid ${ch.enabled ? 'rgba(39,201,63,0.25)' : 'transparent'}`,
                    }}
                  >
                    {ch.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(ch.id) }}
                    className="cursor-pointer transition-colors"
                    style={{ padding: 3, borderRadius: 6, color: 'var(--text-outline)', background: 'transparent', border: 'none', display: 'flex' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ff5f56' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-outline)' }}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>

                {/* Expanded config */}
                {isExpanded && (
                  <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {fields.map((field) => (
                      <div key={field.key}>
                        <FieldLabel>{field.label}</FieldLabel>
                        <TextInput
                          value={cfg[field.key] || ''}
                          onChange={(v) => updateField(ch.id, field.key, v)}
                          placeholder={field.placeholder || field.label}
                          type={field.secret ? 'password' : 'text'}
                          mono
                        />
                      </div>
                    ))}
                    {fields.length === 0 && (
                      <div className="text-[10px]" style={{ color: 'var(--text-outline)' }}>
                        该平台暂无可配置项
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {channels.length === 0 && !adding && (
            <div className="text-[11px] text-center py-4" style={{ color: 'var(--text-outline)' }}>
              尚未配置任何 IM 通道
            </div>
          )}
        </div>
      </Section>

      {/* Add new */}
      {adding ? (
        <Section title="Add Channel">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <FieldLabel>Platform</FieldLabel>
              <PillGroup
                options={platforms}
                value={newPlatform}
                onChange={(p) => setNewPlatform(p as ChannelPlatform)}
                renderLabel={(p) => CHANNEL_PLATFORM_LABELS[p as ChannelPlatform]}
              />
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <PrimaryButton onClick={handleAdd}>Add</PrimaryButton>
              <SecondaryButton onClick={() => setAdding(false)}>Cancel</SecondaryButton>
            </div>
          </div>
        </Section>
      ) : (
        <div style={{ marginTop: 12 }}>
          <SecondaryButton onClick={() => setAdding(true)}>+ Add Channel</SecondaryButton>
        </div>
      )}

      {/* Save */}
      <Section title="Actions">
        <div className="flex items-center" style={{ gap: 8 }}>
          <PrimaryButton onClick={handleSave}>
            {saved ? 'Saved' : 'Save'}
          </PrimaryButton>
        </div>
      </Section>
    </div>
  )
}
