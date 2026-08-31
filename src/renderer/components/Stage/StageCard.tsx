import { memo } from 'react'
import type { ContentBlock } from '../../../shared/types'
import { ContentBlockView } from '../MessageBubble'

export type StageCardKind = 'text' | 'image' | 'file'

export interface StageCardData {
  id: string
  kind: StageCardKind
  block?: ContentBlock
  timestamp: number
}

// 单卡：统一外壳，内容按 kind 分发；annotations = 弹幕批注（产物卡的说明文字）
export const StageCard = memo(function StageCard({ card, annotations }: { card: StageCardData; annotations?: string[] }) {
  return (
    <div className="stage-card" data-kind={card.kind}>
      {annotations && annotations.length > 0 && (
        <div className="danmaku-layer">
          {annotations.map((a, i) => (
            <div key={i} className="danmaku-chip" style={{ animationDelay: `${i * 0.15}s` }}>
              {a.length > 60 ? a.slice(0, 60) + '…' : a}
            </div>
          ))}
        </div>
      )}
      {(card.kind === 'text' || card.kind === 'image') && card.block && (
        <ContentBlockView block={card.block} />
      )}
      {card.kind === 'file' && card.block && (
        <div className="stage-card-file">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span className="stage-card-file-name">{card.block.fileName}</span>
          {card.block.fileSize != null && (
            <span className="stage-card-file-size">
              {card.block.fileSize < 1024
                ? `${card.block.fileSize} B`
                : card.block.fileSize < 1048576
                  ? `${(card.block.fileSize / 1024).toFixed(1)} KB`
                  : `${(card.block.fileSize / 1048576).toFixed(1)} MB`}
            </span>
          )}
        </div>
      )}
    </div>
  )
})
