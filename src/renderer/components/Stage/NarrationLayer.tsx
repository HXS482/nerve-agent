import { useMemo } from 'react'
import { motion } from 'motion/react'

// 纯文字回复的旁白层：保留 Apple Music 式的逐行渐现，但按正文阅读排版。
// 长回复装入可滚动正文区，上下边缘渐隐，不再被大字号撑爆屏幕。
export function NarrationLayer({ text }: { text: string }) {
  const lines = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.replace(/[*_`#]/g, '').trim())
        .filter(Boolean),
    [text],
  )

  // 行数多时压缩行间隔节奏，避免 50 行要等 6 秒才显完
  const step = lines.length > 20 ? 0.045 : lines.length > 8 ? 0.08 : 0.12

  return (
    <motion.div
      className="narration-layer"
      exit={{ opacity: 0, filter: 'blur(8px)', transition: { duration: 0.3 } }}
    >
      <div className="narration-scroll">
        <div className="narration-content">
          {lines.map((line, i) => (
            <motion.p
              key={i}
              className="narration-line"
              initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ delay: i * step, duration: 0.45, ease: 'easeOut' }}
            >
              {line}
            </motion.p>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
