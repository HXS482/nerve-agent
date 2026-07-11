# 侧边栏毛玻璃 + 删除 aurora 主题 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Nerve 左侧边栏透出桌面壁纸并模糊(复刻 Zen Browser 效果),主区域保持不透明;删除 aurora 主题,仅保留 dark / light。

**Architecture:** 纯 CSS 分区。主窗口已 `transparent: true`,无需改主进程。App 外层 div 去掉背景变透明,侧边栏 `<aside>` 挂 `backdrop-filter` 透出并模糊壁纸,主区域 `<main>` 已有不透明 `--bg-surface` 挡住壁纸。

**Tech Stack:** Electron + React 19 + Tailwind CSS v4(CSS-first 配置)+ Zustand + CSS 自定义属性主题系统。

**Spec:** `docs/superpowers/specs/2026-07-11-sidebar-frosted-glass-design.md`

**Branch:** 新建分支执行,例如 `feat/sidebar-frosted-glass`,从 `master` 切出。

---

## 文件结构

| 文件 | 责任 | 操作 |
|---|---|---|
| `src/shared/types.ts` | `Theme` 类型定义 | 修改:移除 `'aurora'` |
| `src/renderer/styles/globals.css` | 主题 CSS 变量 | 修改:删 aurora 块、加 sidebar 变量、修正 `--glass-blur` |
| `src/renderer/App.tsx` | 应用根组件 | 修改:删 Grainient、外层 div 去背景 |
| `src/renderer/main.tsx` | 启动入口 | 修改:aurora 降级 dark |
| `src/renderer/stores/chatStore.ts` | Zustand store | 修改:onRehydrate aurora 降级 |
| `src/renderer/components/Sidebar.tsx` | 左侧边栏 | 修改:挂 backdrop-filter、删 aurora 分支 |
| `src/renderer/components/GradientButtonGroup.tsx` | 主题切换按钮组 | 修改:删 aurora 选项、删 aurora 分支 |
| `src/renderer/components/RightSidebar.tsx` | 右侧边栏 | 修改:删 aurora 分支 |
| `src/renderer/components/ModelIsland.tsx` | 模型选择浮岛 | 修改:删 aurora 分支 |
| `src/renderer/components/UsageStatsPanel.tsx` | 用量面板 | 修改:删 aurora 分支 |
| `src/renderer/components/NerveCloud.tsx` | 宠物云彩配色 | 修改:删 aurora 配色项 |
| `src/renderer/components/NerveOrb.tsx` | 宠物球配色 | 修改:删 aurora 配色项 |
| `src/renderer/components/Grainient.tsx` | WebGL 渐变背景 | 删除文件(可选,见 Task 10) |

---

## Task 1: 创建新分支

**Files:**
- 无(分支操作)

- [ ] **Step 1: 从 master 创建并切换到新分支**

Run:
```bash
git checkout master
git checkout -b feat/sidebar-frosted-glass
```
Expected: 切到新分支,工作区干净。

- [ ] **Step 2: 确认分支**

Run: `git branch --show-current`
Expected: `feat/sidebar-frosted-glass`

---

## Task 2: 移除 `Theme` 类型中的 `'aurora'`

**Files:**
- Modify: `src/shared/types.ts:226`

- [ ] **Step 1: 修改 Theme 类型**

`src/shared/types.ts:226`,把:

```ts
export type Theme = 'dark' | 'light' | 'aurora'
```

改为:

```ts
export type Theme = 'dark' | 'light'
```

- [ ] **Step 2: 编译检查**

Run: `npx tsc --noEmit 2>&1 | head -40`
Expected: 报错集中在各组件 `theme === 'aurora'` 和 `setTheme('aurora')` 处(预期,后续 Task 会修复)。**如果报错出现在非 aurora 相关位置,停下排查。**

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor(types): remove 'aurora' from Theme type"
```

---

## Task 3: 删除 `globals.css` aurora 主题块 + 新增 sidebar 变量

**Files:**
- Modify: `src/renderer/styles/globals.css:56-58`(`dark` 块 `--glass-blur`)
- Modify: `src/renderer/styles/globals.css:119-121`(`light` 块 `--glass-blur`)
- Modify: `src/renderer/styles/globals.css:135-195`(整个 aurora 块)

- [ ] **Step 1: dark 块 —— 加 sidebar 变量 + 修正 glass-blur**

`src/renderer/styles/globals.css`,在 dark 块的 `--glass-blur: none;`(line 58)之后、`--dynamic-island-bg`(line 60)之前,插入 sidebar 变量。

把:
```css
  --glass-bg: #1f1f1f;
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: none;
```

改为:
```css
  --glass-bg: #1f1f1f;
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-blur: none;

  --sidebar-bg: rgba(18, 18, 22, 0.45);
  --sidebar-blur: blur(24px) saturate(1.4);
  --sidebar-border: rgba(255, 255, 255, 0.08);
```

- [ ] **Step 2: light 块 —— 加 sidebar 变量**

在 light 块的 `--glass-blur: none;`(line 121 附近)之后,插入 sidebar 变量。

把:
```css
  --glass-bg: #ffffff;
  --glass-border: rgba(0, 0, 0, 0.08);
  --glass-blur: none;
```

改为:
```css
  --glass-bg: #ffffff;
  --glass-border: rgba(0, 0, 0, 0.08);
  --glass-blur: none;

  --sidebar-bg: rgba(248, 248, 250, 0.72);
  --sidebar-blur: blur(24px) saturate(1.3);
  --sidebar-border: rgba(0, 0, 0, 0.06);
```

- [ ] **Step 3: 删除整个 aurora 块**

删除 `src/renderer/styles/globals.css` 中从 `/* ===== Aurora Theme (Grainient background) ===== */` 到其闭合 `}` 的整段(原 line 135-195)。

- [ ] **Step 4: 确认无残留**

Run: `grep -n "aurora" src/renderer/styles/globals.css`
Expected: 无输出(aurora 已完全移除)。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/styles/globals.css
git commit -m "style: remove aurora theme, add sidebar glass variables"
```

---

## Task 4: `App.tsx` —— 删除 Grainient + 外层 div 去背景

**Files:**
- Modify: `src/renderer/App.tsx:13`(import)
- Modify: `src/renderer/App.tsx:170-178`(外层 div)
- Modify: `src/renderer/App.tsx:179-207`(Grainient 渲染块)

- [ ] **Step 1: 删除 Grainient import**

`src/renderer/App.tsx:13`,删除这一行:

```ts
import Grainient from './components/Grainient'
```

- [ ] **Step 2: 外层 div 去掉 background**

`src/renderer/App.tsx:170-178`,把:

```tsx
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        background: 'var(--bg-background)',
        borderRadius: 'var(--app-window-radius)',
        clipPath: 'inset(0 round var(--app-window-radius))',
        border: '1px solid var(--border-default)',
      }}
    >
```

改为(删除 `background` 行;border 保留但改为半透明以适配透明窗口):

```tsx
    <div
      className="h-screen w-screen flex overflow-hidden"
      style={{
        borderRadius: 'var(--app-window-radius)',
        clipPath: 'inset(0 round var(--app-window-radius))',
      }}
    >
```

- [ ] **Step 3: 删除 Grainient 渲染块**

删除 `src/renderer/App.tsx` 中整个 aurora Grainient 渲染块(原 line 179-207):

```tsx
      {/* Aurora theme background */}
      {theme === 'aurora' && (
        <div className="fixed inset-0 z-0">
          <Grainient
            ...
          />
        </div>
      )}
```

- [ ] **Step 4: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep "App.tsx"`
Expected: 无 App.tsx 报错(若 `theme` 变量因此变成未使用,可能会有 warning,先忽略,下个 Task 处理)。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "refactor(App): remove Grainient, make outer div transparent"
```

---

## Task 5: `chatStore.ts` + `main.tsx` —— aurora 降级

**Files:**
- Modify: `src/renderer/stores/chatStore.ts:292-296`(onRehydrate)
- Modify: `src/renderer/main.tsx:22-31`(savedTheme)

- [ ] **Step 1: chatStore onRehydrate 降级**

`src/renderer/stores/chatStore.ts`,把 onRehydrate 中的:

```ts
      onRehydrate: () => {
        return (state) => {
          if (state?.theme) {
            document.documentElement.setAttribute('data-theme', state.theme)
          }
```

改为:

```ts
      onRehydrate: () => {
        return (state) => {
          if (state?.theme) {
            const safeTheme = state.theme === 'aurora' ? 'dark' : state.theme
            document.documentElement.setAttribute('data-theme', safeTheme)
            if (safeTheme !== state.theme) state.theme = safeTheme
          }
```

- [ ] **Step 2: main.tsx savedTheme 降级**

`src/renderer/main.tsx:22-31`,把:

```ts
const savedTheme = (() => {
  try {
    const raw = localStorage.getItem('nerve-state')
    if (raw) {
      const parsed = JSON.parse(raw)
      return parsed?.state?.theme || 'dark'
    }
  } catch {}
  return 'dark'
})()
```

改为:

```ts
const savedTheme = (() => {
  try {
    const raw = localStorage.getItem('nerve-state')
    if (raw) {
      const parsed = JSON.parse(raw)
      const t = parsed?.state?.theme
      return t === 'light' ? 'light' : 'dark'
    }
  } catch {}
  return 'dark'
})()
```

- [ ] **Step 3: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "chatStore|main.tsx"`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/chatStore.ts src/renderer/main.tsx
git commit -m "fix: downgrade stale 'aurora' theme to 'dark' on load"
```

---

## Task 6: `Sidebar.tsx` —— 侧边栏挂毛玻璃 + 删 aurora 分支

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx:89-91`(`<aside>`)
- Modify: `src/renderer/components/Sidebar.tsx:133`(search bar className)
- Modify: `src/renderer/components/Sidebar.tsx:137-153`(search bar style + hover)

- [ ] **Step 1: `<aside>` 挂 backdrop-filter**

`src/renderer/components/Sidebar.tsx:89-91`,把:

```tsx
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col z-50 transition-[width] duration-300"
      style={{ width: sidebarWidth, background: 'transparent' }}
    >
```

改为:

```tsx
    <aside
      className="fixed left-0 top-0 bottom-0 flex flex-col z-50 transition-[width] duration-300"
      style={{
        width: sidebarWidth,
        background: 'var(--sidebar-bg)',
        backdropFilter: 'var(--sidebar-blur)',
        WebkitBackdropFilter: 'var(--sidebar-blur)',
        borderRight: '1px solid var(--sidebar-border)',
      }}
    >
```

- [ ] **Step 2: search bar 删 aurora 分支(简化为 dark/light 统一)**

`src/renderer/components/Sidebar.tsx:132-160`,把整段 search bar div:

```tsx
        <div
          className={`flex items-center gap-2 rounded-lg cursor-pointer transition-all duration-300 group ${theme === 'aurora' ? 'dynamic-island' : ''}`}
          style={{
            margin: '24px 8px 0 8px',
            padding: '7px 10px',
            ...(theme === 'aurora'
              ? { border: '1px solid var(--glass-border)', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }
              : { background: 'var(--bg-surface-container-high)', border: '1px solid rgba(173, 198, 255, 0.1)' }
            ),
          }}
          onMouseEnter={(e) => {
            if (theme !== 'aurora') {
              e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.25)'
              e.currentTarget.style.background = 'var(--bg-surface-container-highest)'
            }
          }}
          onMouseLeave={(e) => {
            if (theme !== 'aurora') {
              e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.1)'
              e.currentTarget.style.background = 'var(--bg-surface-container-high)'
            }
          }}
        >
```

改为(去掉所有 aurora 条件,保留 dark/light 分支即非-aurora 分支的值):

```tsx
        <div
          className="flex items-center gap-2 rounded-lg cursor-pointer transition-all duration-300 group"
          style={{
            margin: '24px 8px 0 8px',
            padding: '7px 10px',
            background: 'var(--bg-surface-container-high)',
            border: '1px solid rgba(173, 198, 255, 0.1)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.25)'
            e.currentTarget.style.background = 'var(--bg-surface-container-highest)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'rgba(173, 198, 255, 0.1)'
            e.currentTarget.style.background = 'var(--bg-surface-container-high)'
          }}
        >
```

- [ ] **Step 3: 检查 Sidebar.tsx 无 aurora 残留**

Run: `grep -n "aurora" src/renderer/components/Sidebar.tsx`
Expected: 无输出。

- [ ] **Step 4: 如果 `theme` 变量在 Sidebar.tsx 中不再被使用,清理**

Run: `grep -n "\btheme\b" src/renderer/components/Sidebar.tsx`
若 `theme` 仍有其他使用点(如 customize panel),保留 `const theme = useChatStore(...)`。若完全不用了,删除该行和 import。

- [ ] **Step 5: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep "Sidebar.tsx"`
Expected: 无报错。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat(sidebar): apply frosted glass backdrop-filter, remove aurora branches"
```

---

## Task 7: `GradientButtonGroup.tsx` —— 删 aurora 主题选项 + aurora 分支

**Files:**
- Modify: `src/renderer/components/GradientButtonGroup.tsx:35-39`(THEMES 数组)
- Modify: `src/renderer/components/GradientButtonGroup.tsx:156-170`(按钮 style)

- [ ] **Step 1: THEMES 数组删 aurora**

`src/renderer/components/GradientButtonGroup.tsx:35-39`,把:

```ts
const THEMES = [
  { id: 'dark' as const, label: 'Dark' },
  { id: 'light' as const, label: 'Light' },
  { id: 'aurora' as const, label: 'Aurora' },
]
```

改为:

```ts
const THEMES = [
  { id: 'dark' as const, label: 'Dark' },
  { id: 'light' as const, label: 'Light' },
]
```

- [ ] **Step 2: 按钮 style 删 aurora 分支**

`src/renderer/components/GradientButtonGroup.tsx:156-170` 附近,把含 `theme === 'aurora'` 三元的整段 style 简化。把:

```tsx
        className={`inline-flex items-center gap-1.5 rounded-[14px] p-1 ${theme === 'aurora' ? 'dynamic-island' : ''}`}
        style={{
          background: theme === 'aurora'
            ? undefined
            : 'color-mix(in srgb, var(--glass-bg) 50%, transparent)',
          backdropFilter: theme === 'aurora' ? undefined : "blur(20px) saturate(180%)",
          WebkitBackdropFilter: theme === 'aurora' ? undefined : "blur(20px) saturate(180%)",
          border: theme === 'aurora'
            ? '1px solid var(--glass-border)'
            : '1px solid var(--border-default)',
          boxShadow: theme === 'aurora' ? "0 20px 50px rgba(0,0,0,0.5)" : undefined,
        }}
```

改为(取非-aurora 分支的值):

```tsx
        className="inline-flex items-center gap-1.5 rounded-[14px] p-1"
        style={{
          background: 'color-mix(in srgb, var(--glass-bg) 50%, transparent)',
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          border: '1px solid var(--border-default)',
        }}
```

> **注意:** 上面的 style 内容请以文件中实际值为准(可能略有差异)。原则:**删除所有 `theme === 'aurora' ? ... : ...` 三元,统一保留非-aurora(`else`)分支的值**。读取实际行后逐个改。

- [ ] **Step 3: 检查无残留**

Run: `grep -n "aurora" src/renderer/components/GradientButtonGroup.tsx`
Expected: 无输出。

- [ ] **Step 4: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep "GradientButtonGroup"`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/GradientButtonGroup.tsx
git commit -m "refactor(theme-picker): remove aurora option and branches"
```

---

## Task 8: `RightSidebar.tsx` / `ModelIsland.tsx` / `UsageStatsPanel.tsx` —— 删 aurora 分支

**Files:**
- Modify: `src/renderer/components/RightSidebar.tsx:566-581`
- Modify: `src/renderer/components/ModelIsland.tsx:71-81`
- Modify: `src/renderer/components/UsageStatsPanel.tsx:161-170`

这三个文件的 aurora 分支模式完全一致:`theme === 'aurora' ? X : Y` → 保留 `Y`(非-aurora 值),删除三元和 `dynamic-island` className 条件。

- [ ] **Step 1: RightSidebar.tsx —— 简化**

`src/renderer/components/RightSidebar.tsx:566-581` 附近,把所有 `theme === 'aurora' ? ... : ...` 三元简化为非-aurora 分支值,className 里去掉 `${theme === 'aurora' ? 'dynamic-island' : ''}`。

具体:读取该段实际代码,对每处三元:
- `className={\`... ${theme === 'aurora' ? 'dynamic-island' : ''}\`}` → `className="..."`(去掉模板字面量,改普通字符串)
- `background: theme === 'aurora' ? undefined : X` → `background: X`
- `backdropFilter: theme === 'aurora' ? undefined : X` → `backdropFilter: X`
- `WebkitBackdropFilter: ...` → 同上
- `border: theme === 'aurora' ? X : Y` → `border: Y`
- `boxShadow: theme === 'aurora' ? X : undefined` → 删除整行 boxShadow

- [ ] **Step 2: ModelIsland.tsx —— 简化**

`src/renderer/components/ModelIsland.tsx:71-81`,同样原则:
- className 去掉 aurora 条件
- `background: theme === 'aurora' ? undefined : 'var(--bg-surface-container)'` → `background: 'var(--bg-surface-container)'`
- `border: theme === 'aurora' ? '1px solid var(--glass-border)' : '1px solid var(--border-default)'` → `border: '1px solid var(--border-default)'`
- `boxShadow: theme === 'aurora' ? ... : undefined` → 删除整行

- [ ] **Step 3: UsageStatsPanel.tsx —— 简化**

`src/renderer/components/UsageStatsPanel.tsx:161-170`,同样原则处理。

- [ ] **Step 4: 三个文件检查无残留**

Run: `grep -n "aurora" src/renderer/components/RightSidebar.tsx src/renderer/components/ModelIsland.tsx src/renderer/components/UsageStatsPanel.tsx`
Expected: 无输出。

- [ ] **Step 5: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "RightSidebar|ModelIsland|UsageStatsPanel"`
Expected: 无报错。若 `theme` 变量在某个组件中不再使用导致 unused warning,删除对应 `const theme = useChatStore(...)` 行(确认无其他引用后)。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/RightSidebar.tsx src/renderer/components/ModelIsland.tsx src/renderer/components/UsageStatsPanel.tsx
git commit -m "refactor: remove aurora branches from RightSidebar, ModelIsland, UsageStatsPanel"
```

---

## Task 9: `NerveCloud.tsx` / `NerveOrb.tsx` —— 删 aurora 配色项

**Files:**
- Modify: `src/renderer/components/NerveCloud.tsx:19`
- Modify: `src/renderer/components/NerveOrb.tsx:194`

- [ ] **Step 1: NerveCloud.tsx 删 aurora 配色行**

`src/renderer/components/NerveCloud.tsx:19`,删除这一行:

```ts
  aurora: { c1: [1.0, 0.62, 0.99],  c2: [0.32, 0.15, 1.0] },
```

- [ ] **Step 2: NerveOrb.tsx 删 aurora 配色行**

`src/renderer/components/NerveOrb.tsx:194`,删除这一行:

```ts
  aurora: { c1: '#FF9FFC', c2: '#5227FF' },
```

- [ ] **Step 3: 检查这两个文件的 Theme/ColorScheme 类型引用**

这两个文件可能用了 `keyof typeof COLOR_SCHEMES` 或类似模式来枚举配色。删除 `aurora` 键后,如果某处用 `'aurora'` 作为字面量传入,需一并清理。

Run: `grep -n "aurora" src/renderer/components/NerveCloud.tsx src/renderer/components/NerveOrb.tsx`
Expected: 无输出。

如果配色方案的选择来源是 `GradientButtonGroup` 的 petColorScheme,确认 `petColorScheme` 的可选值不含 aurora(它独立于 Theme,通常是 purple/blue 等命名,不冲突)。Run: `grep -rn "petColorScheme" src/renderer/components/NerveCloud.tsx src/renderer/components/NerveOrb.tsx` 确认。

- [ ] **Step 4: 编译检查**

Run: `npx tsc --noEmit 2>&1 | grep -E "NerveCloud|NerveOrb"`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/NerveCloud.tsx src/renderer/components/NerveOrb.tsx
git commit -m "refactor(pet): remove aurora color scheme entries"
```

---

## Task 10: 删除 `Grainient.tsx` 组件文件(可选)

**Files:**
- Delete: `src/renderer/components/Grainient.tsx`

> 只有在确认全项目无其他引用时才删。Task 4 已从 App.tsx 移除了唯一已知引用。

- [ ] **Step 1: 确认无引用**

Run: `grep -rn "Grainient" src/`
Expected: 只剩 `src/renderer/components/Grainient.tsx` 自身(定义处),无其他引用。

如果有其他引用,**跳过此 Task**,保留文件。

- [ ] **Step 2: 删除文件**

```bash
git rm src/renderer/components/Grainient.tsx
```

- [ ] **Step 3: 检查 `ogl` 依赖是否还有其他用处**

Run: `grep -rn "from 'ogl'\|from \"ogl\"" src/`
Expected: 若无其他引用,可考虑从 `package.json` 移除 `ogl` 依赖。**但为了安全,本计划不移除 ogl**——避免误伤,留作后续清理。

- [ ] **Step 4: 编译检查**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: 无报错。

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove unused Grainient component"
```

---

## Task 11: 全量编译 + dev 验证

**Files:**
- 无(验证)

- [ ] **Step 1: 全量类型检查**

Run: `npx tsc --noEmit`
Expected: 无报错。

- [ ] **Step 2: 全项目 aurora 残留扫描**

Run: `grep -rln "aurora\|Aurora\|Grainient\|grainient" src/`
Expected: 无输出(或仅剩注释/无关命名)。

- [ ] **Step 3: 启动 dev**

Run: `npm run dev`
Expected: Electron 窗口启动,无控制台报错。

- [ ] **Step 4: 视觉验证(dark 模式)**

在运行的应用中检查:
- [ ] 左侧边栏可见模糊的桌面壁纸,tint 偏深(rgba 18,18,22,0.45)
- [ ] 主区域(<main>)完全不透明,壁纸不透出
- [ ] 侧边栏文字、搜索框、会话列表清晰可读
- [ ] 切换到 light 再切回 dark,无闪烁

- [ ] **Step 5: 视觉验证(light 模式)**

- [ ] 左侧边栏奶白磨砂(tint rgba 248,248,250,0.72)
- [ ] 主区域不透明白色
- [ ] 文字清晰

- [ ] **Step 6: 降级验证**

在 DevTools Console 执行:
```js
const s = JSON.parse(localStorage.getItem('nerve-state'))
s.state.theme = 'aurora'
localStorage.setItem('nerve-state', JSON.stringify(s))
```
然后 Ctrl+R 刷新。预期:应用以 dark 模式启动,不报错、不白屏。

- [ ] **Step 7: backdrop-filter 合成层验证**

在 DevTools Elements 面板,选中 `<aside>` 元素,在 Computed 标签确认:
- `backdrop-filter: blur(24px) saturate(1.4)`(dark)或 `saturate(1.3)`(light)
- 确认侧边栏父链无 `contain: paint` / 3D `transform`(会导致模糊失效)

- [ ] **Step 8: Commit(如有验证中发现的微调)**

若验证中调整了参数:
```bash
git add -A
git commit -m "fix: visual tweaks from dev verification"
```

---

## Task 12: 合并准备

**Files:**
- 无

- [ ] **Step 1: 确认所有 commit 在分支上**

Run: `git log master..HEAD --oneline`
Expected: 看到 Task 2-10 的 commit。

- [ ] **Step 2: 最终全量检查**

Run:
```bash
npx tsc --noEmit && grep -rln "aurora" src/ && echo "CLEAN" || echo "ISSUES"
```
Expected: 输出 `CLEAN`(grep 无匹配返回非零会被 `||` 捕获——若 grep 无输出即代表干净,tsc 通过即可)。

> 注意:`grep` 无匹配时 exit code 为 1,上面的 `&&` 链会断。更稳妥的写法:`npx tsc --noEmit; echo "tsc=$?"; grep -rc "aurora" src/ | grep -v ":0" || echo "NO_AURORA"`

- [ ] **Step 3: 通知用户 review**

分支 `feat/sidebar-frosted-glass` 已就绪,等用户决定是否合并到 master 或开 PR。

---

## 完成标准

- [ ] `npx tsc --noEmit` 零报错
- [ ] `src/` 下零 `aurora` 残留
- [ ] dark 模式侧边栏毛玻璃可见,透出桌面壁纸
- [ ] light 模式侧边栏奶白磨砂
- [ ] 主区域完全不透明
- [ ] 旧 `theme: 'aurora'` localStorage 安全降级
- [ ] 所有改动在 `feat/sidebar-frosted-glass` 分支,commit 原子化
