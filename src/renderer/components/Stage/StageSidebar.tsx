import { useStageStore } from '../../stores/stageStore'
import { AvatarButton } from '../InputBar'
import { StageSessions } from './StageSessions'

interface Props {
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onPickDirectory: () => void
}

// Stage 模式独立侧栏：窗口级透明层，红绿灯/折叠按钮在固定层，这里只填充左侧区域
export function StageSidebar({ onSelectSession, onNewSession, onPickDirectory }: Props) {
  const setSettingsOpen = useStageStore((s) => s.setSettingsOpen)
  return (
    <aside className="stage-sidebar">
      <div className="stage-sidebar-body">
        <StageSessions
          onSelectSession={onSelectSession}
          onNewSession={onNewSession}
          onPickDirectory={onPickDirectory}
        />
      </div>

      {/* 左下角：账号头像（设置在其二级菜单内） */}
      <div className="stage-sidebar-avatar">
        <AvatarButton onOpenSettings={() => setSettingsOpen(true)} />
      </div>
    </aside>
  )
}
