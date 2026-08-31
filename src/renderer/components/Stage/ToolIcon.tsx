import type { ReactNode } from 'react'

// 按工具特性绘制的 24×24 描边图标集（风格对齐 feather icons，与全局图标语言一致）
// 工具清单来源：main/tools.ts 内置 12 个 + orchestrator.ts 子代理 3 个 + load_skill
const ICONS: Record<string, ReactNode> = {
  // 终端命令
  Bash: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </>
  ),
  // 创建文件：文档 + 加号
  Write: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="12" x2="12" y2="18" />
      <line x1="9" y1="15" x2="15" y2="15" />
    </>
  ),
  // 读文件：文档 + 文本行
  Read: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </>
  ),
  // 替换编辑：铅笔
  Edit: <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  // 找文件：文件夹 + 星号通配
  Glob: (
    <>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="10" x2="12" y2="16" />
      <line x1="9.4" y1="11.5" x2="14.6" y2="14.5" />
      <line x1="14.6" y1="11.5" x2="9.4" y2="14.5" />
    </>
  ),
  // 内容搜索：放大镜内含文本行
  Grep: (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="10" x2="14" y2="10" />
      <line x1="8" y1="13" x2="12.5" y2="13" />
    </>
  ),
  // AI 生图：图片 + 四角星（生成）
  GenerateImage: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
      <path d="M17.4 4.2 18.1 6.2 20.1 6.9 18.1 7.6 17.4 9.6 16.7 7.6 14.7 6.9 16.7 6.2z" fill="currentColor" stroke="none" />
    </>
  ),
  // 图片入库：收纳盒
  moveImageToGallery: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  // 暂存（git add -A）：圆环 + 加号
  GitStageAll: (
    <>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </>
  ),
  // 提交：线上圆点
  GitCommit: (
    <>
      <circle cx="12" cy="12" r="4" />
      <line x1="1.05" y1="12" x2="7" y2="12" />
      <line x1="17.01" y1="12" x2="22.96" y2="12" />
    </>
  ),
  // 拉取：双节点分支合流
  GitPull: (
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </>
  ),
  // 初始化仓库：节点 + 放射光芒（诞生）
  GitInit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <line x1="12" y1="2" x2="12" y2="5.5" />
      <line x1="12" y1="18.5" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5.5" y2="12" />
      <line x1="18.5" y1="12" x2="22" y2="12" />
      <line x1="4.9" y1="4.9" x2="7.4" y2="7.4" />
      <line x1="16.6" y1="16.6" x2="19.1" y2="19.1" />
      <line x1="4.9" y1="19.1" x2="7.4" y2="16.6" />
      <line x1="16.6" y1="7.4" x2="19.1" y2="4.9" />
    </>
  ),
  // 单个子代理：分支
  spawn_subagent: (
    <>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  // 并行子代理：一分三扇出
  parallel_subagents: (
    <>
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="19" cy="19" r="2" />
      <line x1="7" y1="12" x2="17" y2="5" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="7" y1="12" x2="17" y2="19" />
    </>
  ),
  // 链式子代理：链条
  chain_subagents: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  // 技能加载：书
  load_skill: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),
}

// 未识别工具兜底：扳手
const FALLBACK = (
  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
)

export function ToolIcon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONS[name] ?? FALLBACK}
    </svg>
  )
}
