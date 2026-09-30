import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'

// 账号面板：Stage 头像菜单「账号」入口的独立毛玻璃浮层。
// 挂在 App 根层级（不嵌顶栏）——backdrop-filter 层是后代采样的屏障，
// 嵌进顶栏/设置容器里 blur 采不到壁纸，会发虚。材质与 AskUser 卡同款玻璃。

interface Props {
  onClose: () => void
}

/** 头像图压缩：居中方形裁切 → 128px JPEG data URL（头像恒为圆形展示，先裁 1:1） */
function fileToAvatarDataUrl(file: File, done: (url: string) => void) {
  const reader = new FileReader()
  reader.onload = () => {
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = 128
      canvas.height = 128
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128)
      done(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.src = reader.result as string
  }
  reader.readAsDataURL(file)
}

export function AccountPanel({ onClose }: Props) {
  const profileName = useChatStore((s) => s.profileName)
  const setProfileName = useChatStore((s) => s.setProfileName)
  const profileAvatar = useChatStore((s) => s.profileAvatar)
  const setProfileAvatar = useChatStore((s) => s.setProfileAvatar)
  const fileRef = useRef<HTMLInputElement>(null)
  const [dirty, setDirty] = useState(false)

  // 输入框是受控快照：打开时读一次 store，编辑只改本地，保存才写回（避免每键触发全局重渲染）
  const [name, setName] = useState(profileName)
  useEffect(() => { setName(profileName) }, [profileName])
  const changed = name !== profileName || dirty

  const save = () => {
    setProfileName(name.trim())
    setDirty(false)
    onClose()
  }

  return (
    <div className="account-panel-wrap">
      <div className="account-panel-mask" onClick={onClose} />
      <motion.div
        className="account-panel"
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
      >
        {/* 头部：大头像 + 昵称/落款 */}
        <button
          className="account-avatar-btn"
          onClick={() => fileRef.current?.click()}
          title="更换头像"
        >
          {profileAvatar ? (
            <img src={profileAvatar} alt="Avatar" className="account-avatar-img" draggable={false} />
          ) : (
            <span className="account-avatar-fallback">{(name || 'A').trim().charAt(0).toUpperCase()}</span>
          )}
        </button>
        <div className="account-id">
          <div className="account-name">{name.trim() || 'Admin'}</div>
          <div className="account-sub">Local account</div>
        </div>
        <button className="fab-menu-item account-close" onClick={onClose} aria-label="Close">
          <X size={14} strokeWidth={1.5} />
        </button>

        {/* 表单 */}
        <div className="account-form">
          <label className="account-label" htmlFor="account-name-input">昵称</label>
          <input
            id="account-name-input"
            className="account-input"
            value={name}
            maxLength={24}
            placeholder="Display name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          />
          <div className="account-actions">
            <button className="fab-menu-item account-btn" onClick={() => fileRef.current?.click()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-3.5-3.5L8 16" />
              </svg>
              更换头像
            </button>
            {(profileAvatar || profileName) && (
              <button
                className="fab-menu-item account-btn"
                onClick={() => { setProfileAvatar(null); setProfileName(''); setName(''); setDirty(false) }}
              >
                重置
              </button>
            )}
          </div>
        </div>

        {/* 底部操作条：保存（有改动才亮） */}
        <div className="account-footer">
          <button className="account-save" disabled={!changed} onClick={save}>
            保存
          </button>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) fileToAvatarDataUrl(f, (url) => { setProfileAvatar(url); setDirty(true) })
            e.target.value = ''
          }}
        />
      </motion.div>
    </div>
  )
}
