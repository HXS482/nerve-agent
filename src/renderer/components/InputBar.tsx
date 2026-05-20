import { useState, useRef, useEffect } from 'react'
import { useVoiceInput } from '../hooks/useVoiceInput'
import { useChatStore } from '../stores/chatStore'

interface Props {
  onSend: (prompt: string) => void
  onCancel: () => void
  isLoading: boolean
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function InputBar({ onSend, onCancel, isLoading }: Props) {
  const [input, setInput] = useState('')
  const [hasVoice, setHasVoice] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const setOrbState = useChatStore((s) => s.setOrbState)

  const voice = useVoiceInput((text) => {
    setHasVoice(true)
    setInput((prev) => (prev ? prev + ' ' + text : text))
  })

  // Sync orb state with loading
  useEffect(() => {
    if (isLoading) {
      setOrbState('thinking')
      // After 10s of loading, switch to morphing
      const timer = setTimeout(() => {
        setOrbState('morphing')
      }, 10000)
      return () => clearTimeout(timer)
    } else {
      setOrbState('idle')
    }
  }, [isLoading, setOrbState])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return
    if (voice.isRecording) voice.stop()
    const prompt = hasVoice ? `[语音指令] ${input.trim()}` : input.trim()
    setOrbState('active')
    onSend(prompt)
    setInput('')
    setHasVoice(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const getPlaceholder = () => {
    if (voice.isRecording) return `Recording ${formatDuration(voice.duration)}...`
    if (voice.isTranscribing) return 'Transcribing...'
    return 'Ask anything...'
  }

  return (
    <div className="absolute left-0 right-0 z-50 flex justify-center items-center gap-3" style={{ paddingLeft: '11px', paddingRight: '11px', bottom: '8px' }}>
      {/* Plus Action Button */}
      <button className="w-9 h-9 rounded-full dynamic-island flex items-center justify-center text-[var(--text-on-surface-variant)] hover:text-[var(--text-on-surface)] transition-all shrink-0" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>

      {/* Main Input Container */}
      <div
        className="dynamic-island rounded-full p-1.5 flex items-center gap-2 transition-all duration-300 group flex-1 h-9 max-w-4xl"
        style={{
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          border: voice.isRecording ? '1px solid var(--error)' : '1px solid var(--glass-border)',
        }}
      >
        {/* Input Field */}
        <div className="flex-1 flex items-center" style={{ paddingLeft: '20px', paddingRight: '16px' }}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            className="bg-transparent border-none focus:ring-0 text-[var(--text-on-surface)] placeholder-[var(--text-outline)] w-full text-[14px] outline-none focus:outline-none"
            style={{ caretColor: 'var(--accent-primary)' }}
            disabled={isLoading || voice.isTranscribing}
          />
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1.5" style={{ paddingRight: '10px', paddingLeft: '4px' }}>
          {isLoading ? (
            <button
              onClick={onCancel}
              className="p-2 rounded-full text-[var(--text-on-surface-variant)] hover:text-[var(--error)] hover:bg-white/5 transition-all"
              title="Stop generating"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={voice.toggle}
              disabled={voice.isTranscribing}
              className={`p-2 rounded-full transition-all ${
                voice.isRecording
                  ? 'text-[var(--error)] voice-recording'
                  : voice.isTranscribing
                    ? 'text-[var(--accent-primary)] animate-pulse-soft'
                    : 'text-[var(--text-on-surface-variant)] hover:text-[var(--accent-primary)] hover:bg-white/5'
              }`}
              title={voice.isRecording ? 'Stop recording' : 'Voice input'}
            >
              {voice.isTranscribing ? (
                // Spinner icon while transcribing
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
                  <path d="M19 10v2a7 7 0 01-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Error toast */}
      {voice.error && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg text-xs text-[var(--error)] bg-[var(--error-container)] animate-fade-in whitespace-nowrap">
          {voice.error}
        </div>
      )}
    </div>
  )
}
