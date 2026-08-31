import { useEffect, useCallback } from 'react'
import { useChatStore } from '../stores/chatStore'
import { getApprovalSummary } from './ChatPanel'

export function ApprovalBar() {
  const pendingApprovals = useChatStore((s) => s.pendingApprovals)
  const current = pendingApprovals[0]

  const handleResponse = useCallback((approved: boolean) => {
    if (!current) return
    useChatStore.getState().removeApproval(current.approvalId)
    window.claude.respondToolApproval({ approvalId: current.approvalId, approved })
  }, [current?.approvalId])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        handleResponse(true)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleResponse(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current?.approvalId, handleResponse])

  if (!current) return null

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 52,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        minWidth: 357,
        maxWidth: '70%',
        background: 'color-mix(in srgb, var(--glass-bg) 30%, transparent)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid var(--glass-border)',
        borderRadius: 12,
        padding: '7px 14px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        animation: 'fade-in-simple 0.15s ease-out',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Warning icon */}
        <div
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: 'rgba(255, 193, 7, 0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffc107" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>

        {/* Tool info */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-on-surface)', flexShrink: 0 }}>
            {current.toolName}
          </span>
          <span className="truncate font-mono" style={{ fontSize: '11px', color: 'var(--text-outline)' }}>
            {getApprovalSummary(current)}
          </span>
        </div>

        {/* Queue count */}
        {pendingApprovals.length > 1 && (
          <span style={{ fontSize: '11px', color: 'var(--text-outline)', flexShrink: 0 }}>
            +{pendingApprovals.length - 1}
          </span>
        )}

        {/* Deny */}
        <button
          onClick={() => handleResponse(false)}
          style={{
            fontSize: '12px', fontWeight: 500, padding: '5px 14px', borderRadius: 8,
            background: 'rgba(244, 67, 54, 0.1)', color: '#ef5350',
            border: '1px solid rgba(244, 67, 54, 0.2)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Deny
        </button>

        {/* Allow */}
        <button
          onClick={() => handleResponse(true)}
          autoFocus
          style={{
            fontSize: '12px', fontWeight: 500, padding: '5px 16px', borderRadius: 8,
            background: 'rgba(76, 175, 80, 0.15)', color: '#66bb6a',
            border: '1px solid rgba(76, 175, 80, 0.25)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Allow
        </button>
      </div>
    </div>
  )
}
