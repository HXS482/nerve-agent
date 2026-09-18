import { useMemo } from 'react'
import { motion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

// 纯文字回复的旁白层：保留 Apple Music 式的逐行渐现，但按正文阅读排版。
// 正文含 ``` 围栏代码块（不再单独落卡，随正文渲染），逐段渐现。
export function NarrationLayer({ text }: { text: string }) {
  // 按段落切块（空行分隔）：代码块整体为一段，避免逐行拆散代码
  const segments = useMemo(() => {
    const blocks: string[] = []
    let cur: string[] = []
    let inFence = false
    for (const line of text.split('\n')) {
      const fenceOpen = /^```/.test(line.trim())
      if (fenceOpen) {
        if (!inFence) {
          // 围栏开头：先把攒到的正文段落收掉
          if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
          inFence = true
          cur.push(line)
          continue
        }
        // 围栏闭合
        inFence = false
        cur.push(line)
        blocks.push(cur.join('\n'))
        cur = []
        continue
      }
      if (inFence) {
        cur.push(line)
        continue
      }
      if (!line.trim()) {
        if (cur.length) { blocks.push(cur.join('\n')); cur = [] }
        continue
      }
      cur.push(line)
    }
    if (cur.length) blocks.push(cur.join('\n'))
    return blocks.filter((b) => b.trim())
  }, [text])

  // 行数多时压缩行间隔节奏，避免 50 行要等 6 秒才显完
  const lineCount = text.split('\n').filter((l) => l.trim()).length
  const step = lineCount > 20 ? 0.045 : lineCount > 8 ? 0.08 : 0.12
  let seg = 0
  const delayFor = (block: string) => {
    const d = seg * step
    seg += block.split('\n').length
    // 流式时段落持续追加，累计延迟会无限增长（后段要等几秒才显）——封顶让新段始终及时出现
    return Math.min(d, 0.5)
  }

  return (
    <motion.div
      className="narration-layer"
      exit={{ opacity: 0, filter: 'blur(8px)', transition: { duration: 0.3 } }}
    >
      <div className="narration-scroll">
        <div className="narration-content">
          {segments.map((block, i) => {
            const isFence = block.trimStart().startsWith('```')
            return (
              <motion.div
                key={i}
                className={isFence ? 'narration-code' : 'narration-line'}
                initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                transition={{ delay: delayFor(block), duration: 0.45, ease: 'easeOut' }}
              >
                {isFence ? (
                  <div className="prose">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]}>
                      {block}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="prose narration-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {block}
                    </ReactMarkdown>
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
