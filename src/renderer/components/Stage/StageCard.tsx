import { memo } from 'react'
import type { ContentBlock } from '../../../shared/types'
import { ContentBlockView } from '../MessageBubble'
import { StageCodeCard, StageCodeAnnotation } from './StageCodeCard'
import { ImageGeneration } from './ImageGeneration'
import { WebScreen } from './WebScreen'

export type StageCardKind = 'text' | 'image' | 'file' | 'code' | 'web'

export interface StageCardData {
  id: string
  kind: StageCardKind
  block?: ContentBlock
  /** kind = 'code'：代码块内容与高亮语言 */
  code?: string
  language?: string
  /** kind = 'image' 且来自 GenerateImage：提示词与分辨率（无 block = 仍在生成中） */
  prompt?: string
  resolution?: string
  /** kind = 'web'：Write 生成的可交互网页（HTML 全文与文件名） */
  html?: string
  label?: string
  timestamp: number
}

// 单卡：统一外壳，内容按 kind 分发；annotations = 弹幕批注（产物卡的说明文字）
export const StageCard = memo(function StageCard({ card, annotations }: { card: StageCardData; annotations?: string[] }) {
  const isGenImage = card.kind === 'image' && (card.prompt != null || !card.block)
  // 生成中的占位卡不贴弹幕：画框本身是动画，弹幕会糊在点阵上；图片到达后恢复
  // web 卡与 code 卡一样走右缘批注图标（StageCodeAnnotation），不用内嵌弹幕层
  const showDanmaku = annotations && annotations.length > 0 && card.kind !== 'code' && card.kind !== 'web' && !(isGenImage && !card.block)
  return (
    <div className="stage-card" data-kind={card.kind} {...(isGenImage ? { 'data-gen': '' } : {})}>
      {showDanmaku && (
        <div className="danmaku-layer">
          {annotations.map((a, i) => (
            <div key={i} className="danmaku-chip" style={{ animationDelay: `${i * 0.15}s` }}>
              {a.length > 60 ? a.slice(0, 60) + '…' : a}
            </div>
          ))}
        </div>
      )}
      {card.kind === 'text' && card.block && (
        <ContentBlockView block={card.block} />
      )}
      {card.kind === 'image' && isGenImage && (
        <ImageGeneration prompt={card.prompt} resolution={card.resolution} src={card.block?.src} />
      )}
      {card.kind === 'image' && !isGenImage && card.block && (
        <ContentBlockView block={card.block} />
      )}
      {card.kind === 'web' && card.html != null && (
        <>
          <WebScreen title={card.label} html={card.html} />
          {/* 与代码卡一致：批注图标贴卡片右缘 */}
          {annotations && annotations.length > 0 && (
            <StageCodeAnnotation annotations={annotations} />
          )}
        </>
      )}
      {card.kind === 'code' && card.code != null && (
        <>
          <StageCodeCard language={card.language} code={card.code} />
          {/* 批注弹幕图标贴在卡片右缘跟随（卡片可被缩放柄改宽，须随卡而非随栏） */}
          {annotations && annotations.length > 0 && (
            <StageCodeAnnotation annotations={annotations} />
          )}
        </>
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
