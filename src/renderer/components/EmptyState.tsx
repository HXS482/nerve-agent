import { useChatStore } from '../stores/chatStore'
import { BotAvatar } from './BotAvatar/BotAvatar'
import { useCurrentBot } from '../hooks/useCurrentBot'

/**
 * 空会话的中央占位。
 *
 * 原来这里是 ASCIIText 的「Hey!」——一个 three.js 着色器把文字做成 ASCII 点阵，
 * 每帧跑一次 GPU 采样，只为了在空会话里显示三个字符。换成当前 Bot 的小人之后：
 *   - 零额外依赖（AvatarFace 本来就在顶栏跑着）；
 *   - 有信息量：能看出现在在跟哪个 Bot 说话，颜色/形状/材质都跟着它走；
 *   - 状态是活的：等模型时三点脉动、干活时环带扫过，空会话也能看出它在不在忙。
 *
 * 光晕用 Bot 的墨色做一圈极淡的径向渐变。不加边框、不画卡片 —— 空会话的留白
 * 本身就是设计，任何方框都会把它变成「一块面板」。
 */
export function EmptyState() {
  const { name, shape, ink, status, material } = useCurrentBot()
  const theme = useChatStore((s) => s.theme)
  const color = ink ?? (theme === 'light' ? '#0a0a0c' : '#f1efe9')

  return (
    <div className="flex-1 flex items-center justify-center" style={{ paddingInline: 'var(--sp-md)' }}>
      <div className="empty-state">
        {/* 光晕：把 Bot 的墨色稀释成一层雾。用 opacity 而不是 rgba 换算，
            Bot 的颜色来自任意 hex，省得为每个色值手算一份 alpha */}
        <div className="empty-state-glow" style={{ background: `radial-gradient(circle, ${color} 0%, transparent 70%)` }} />
        {/* data-empty-avatar 是飞行动画的起点标记：beginAvatarFlight 靠它量位置。
            量的是 96px 的头像本体，不是外面那层带 padding 的容器 —— 否则起点矩形
            会比实际图形大一圈，替身飞起来会「从虚空中浮出」 */}
        <div className="empty-state-avatar">
          <div data-empty-avatar style={{ display: 'flex' }}>
            <BotAvatar
              shape={shape}
              size={96}
              status={status}
              color={color}
              material={material}
              animate
              followPointer
              label={name}
            />
          </div>
        </div>
        <div className="empty-state-name" title={name}>{name}</div>
      </div>
    </div>
  )
}
