import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { BotAvatar } from './BotAvatar/BotAvatar'
import { useAvatarFlightStore } from '../stores/avatarFlightStore'
import { useCurrentBot } from '../hooks/useCurrentBot'
import { useChatStore } from '../stores/chatStore'

/**
 * 头像飞行的替身。
 *
 * 空会话时 Bot 画在正文中间，发出第一条消息后那块占位会被卸载，顶栏那只
 * 同时出现 —— 直接切就是「一只消失 + 一只冒出来」。这里在两者之间放一个
 * 自己画在 body 上的替身，从量的起点飞到终点，落地后由顶栏那只接手。
 *
 * 几个刻意的选择：
 *   - portal 到 body：它要跨过 chat 区域的 overflow 裁剪和侧栏层级，
 *     挂在任何容器里都会被裁掉一段。
 *   - 用 transform 的 scale 而不是动 width/height：缩放不触发布局，
 *     整段动画只有合成层在跑，60fps 稳。
 *   - 头像本体固定 96px（起点尺寸），终点靠 scale 缩到 44 —— 反过来做
 *     （固定 44 再放大）会让起点那张脸变糊。
 */
export function AvatarFlight() {
  const flight = useAvatarFlightStore((s) => s.flight)
  const finish = useAvatarFlightStore((s) => s.finish)
  const { name, shape, ink, status, material } = useCurrentBot()
  const theme = useChatStore((s) => s.theme)

  if (!flight || typeof document === 'undefined') return null

  const { from, to } = flight
  const color = ink ?? (theme === 'light' ? '#0a0a0c' : '#f1efe9')
  const scale = from.width > 0 ? to.width / from.width : 1
  // 终点矩形中心与起点中心之差：用位移表达，动画不必重算 left/top 百分比
  const dx = to.left + to.width / 2 - (from.left + from.width / 2)
  const dy = to.top + to.height / 2 - (from.top + from.height / 2)

  return createPortal(
    <motion.div
      // key 用递增序号：连着发两次不会复用上一次的动画进度
      key={flight.id}
      data-flight-avatar
      style={{
        position: 'fixed',
        left: from.left,
        top: from.top,
        width: from.width,
        height: from.height,
        zIndex: 400,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
      animate={{ x: dx, y: dy, scale, opacity: 1 }}
      transition={{
        // 前段快、后段收：像被吸上去而不是匀速平移
        duration: 0.62,
        ease: [0.32, 0.06, 0.18, 1],
      }}
      onAnimationComplete={finish}
    >
      <BotAvatar
        shape={shape}
        size={from.width}
        status={status}
        color={color}
        material={material}
        /* 静态渲染（still → SVG）：飞行只有 0.6 秒，动态细节看不出来，
           但这里绝不能开 animate —— 上游的动画渲染器是单例的，和空态那只/
           顶栏那只同时挂载会互相顶掉，画出来是一片空白。 */
        animate={false}
        followPointer={false}
        label={name}
      />
    </motion.div>,
    document.body,
  )
}
