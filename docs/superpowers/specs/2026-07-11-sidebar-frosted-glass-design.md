# 侧边栏毛玻璃 + 删除 aurora 主题

- **日期**: 2026-07-11
- **状态**: 待批准
- **取代**: `2026-06-13-sidebar-glassmorphism-design.md`、`2026-06-13-sidebar-true-glassmorphism.md`
- **分支**: 待创建(实现时在新分支进行,不从 master 直接改)

## 背景与动机

用户希望在 Nerve 桌面端的左侧边栏复刻 Zen Browser 的招牌毛玻璃效果——透出窗口背后的桌面壁纸并模糊,主区域保持不透明纯色。

探索代码后发现:
- 主窗口已是 `transparent: true`(`src/main/index.ts:88-105`),DWM fix 已就位。
- 左侧边栏 `<aside>`(`Sidebar.tsx:89-92`)是 `position: fixed` 悬浮结构,`background: transparent`,**天然适合挂 `backdrop-filter`**。
- 存在第三套 `aurora` 主题(Grainient WebGL 动态背景),用户决定删除,仅保留 dark / light。

## 目标

1. **左侧边栏**透出桌面壁纸,叠加毛玻璃模糊 + 半透明 tint。
2. **主区域**保持完全不透明,壁纸不透出。
3. **删除 aurora 主题**(`Theme` 类型、CSS 块、Grainient 组件、各组件中的 aurora 分支)。
4. 仅 dark / light 两套主题生效。
5. 跨平台一致(Windows / macOS / Linux)。

## 非目标

- 不改用 Electron 原生 `backgroundMaterial: 'acrylic'`(整个窗口都会变亚克力,与"仅侧边栏透"的目标冲突,且仅 Win11 有效)。
- 不改右侧边栏(`RightSidebar.tsx`)。
- 不碰 pet 窗口。
- 不做主题切换 UI 改版。

## 视觉参数(已与用户确认)

| 主题 | tint (background) | backdrop-filter |
|---|---|---|
| dark | `rgba(18, 18, 22, 0.45)` | `blur(24px) saturate(1.4)` |
| light | `rgba(248, 248, 250, 0.72)` | `blur(24px) saturate(1.3)` |

边框:`dark → rgba(255,255,255,0.08)` / `light → rgba(0,0,0,0.06)`

## 架构

### 分区原理

```
窗口 (transparent: true — 已就绪,无需改主进程)
└─ App 外层 div  ← 去掉 background,变透明
   ├─ <Sidebar> <aside>  ← 挂 backdrop-filter,透出并模糊壁纸
   └─ <main>             ← 已有 background: var(--bg-surface)(不透明),挡住壁纸
```

侧边栏的 `backdrop-filter` 能采样到桌面壁纸,是因为:窗口透明 → 外层 div 透明 → 壁纸透到合成层 → fixed 侧边栏位于其上,取景成立。主区域则用不透明 `--bg-surface` 把壁纸挡回去。

### 实现方式:纯 CSS 分区(方案 1)

不碰主进程 / `dwm.ts`,所有改动在渲染层。主窗口的 `transparent: true` 和现有 DWM fix 保持原样。

## 改动清单

### A. 删除 aurora 主题

| 文件 | 改动 |
|---|---|
| `src/shared/types.ts:226` | `Theme` 类型:移除 `'aurora'` → `export type Theme = 'dark' \| 'light'` |
| `src/renderer/styles/globals.css:135-195` | 删除整个 `[data-theme="aurora"]` 块 |
| `src/renderer/App.tsx` | 删除 `<Grainient>` 渲染块(line 179-207)、删除 `Grainient` import、删除 `theme === 'aurora'` 相关条件 |
| `src/renderer/stores/chatStore.ts` | 确认 `toggleTheme`(line 207-210)只在 dark↔light 切;rehydration 时若读到 `'aurora'` 降级为 `'dark'` |
| `src/renderer/main.tsx` | 启动时从 localStorage 读 theme,若为 `'aurora'` 降级 `'dark'` |
| `RightSidebar.tsx` / `GradientButtonGroup.tsx` / `ModelIsland.tsx` / `Sidebar.tsx` / `UsageStatsPanel.tsx` / `NerveCloud.tsx` / `NerveOrb.tsx` | 各组件内 `theme === 'aurora'` 的三元分支简化为 dark/light 统一逻辑(大多数可直接用 dark 分支值) |

`Grainient` 组件文件本身(`ogl` 依赖)若无其他引用可一并删除;若不确定则保留文件、仅移除 import 与使用点。

### B. 侧边栏毛玻璃

**新增 CSS 变量** — 在 `globals.css` 的 `[data-theme="dark"]` 和 `[data-theme="light"]` 块各加一组:

```css
/* [data-theme="dark"] */
--sidebar-bg: rgba(18, 18, 22, 0.45);
--sidebar-blur: blur(24px) saturate(1.4);
--sidebar-border: rgba(255, 255, 255, 0.08);

/* [data-theme="light"] */
--sidebar-bg: rgba(248, 248, 250, 0.72);
--sidebar-blur: blur(24px) saturate(1.3);
--sidebar-border: rgba(0, 0, 0, 0.06);
```

**Sidebar.tsx `<aside>`(line 89-92)** — 修改 style:
```tsx
style={{
  width: sidebarWidth,
  background: 'var(--sidebar-bg)',
  backdropFilter: 'var(--sidebar-blur)',
  WebkitBackdropFilter: 'var(--sidebar-blur)',
  borderRight: '1px solid var(--sidebar-border)',
}}
```

**App.tsx 外层 div(line 170-178)** — 移除 `background: 'var(--bg-background)'`(变透明)。保留 `borderRadius` / `clipPath` / `border`(border 现在会叠在透明窗口边缘,需验证视觉;必要时改为仅 `border-color: transparent` 或微调)。

**App.tsx `<main>`(line 221-232)** — 当前 `background: 'var(--bg-surface)'` 已不透明,**无需改动**。

### C. 侧边栏子组件透明化审查

侧边栏内若有子元素自带不透明背景,会遮挡模糊层。需审查并改为透明 / 半透明:
- header 区(窗口控件 + 搜索框)
- session list(会话项卡片)
- pet dock pedestal
- GradientButtonGroup 底部按钮组

原则:只让 `<aside>` 根层持有 tint + blur,子元素背景改为 `transparent` 或 `rgba(...,0.x)`。

## 待决策:外层 div 透明后的 4px 缝隙

移除外层 div 背景后,`<main>` 的 `margin: 4px` 会在窗口边缘留出一圈约 4px 的透明缝隙(上/右/下),透出壁纸。两种处理:

- **(推荐)接受它**:形成"主面板浮在毛玻璃窗口上"的层次感,与侧边栏毛玻璃呼应。
- **遮挡它**:给外层 div 保留一层很淡的 tint(如 `rgba(0,0,0,0.2)`),或让 main 的 margin 归零。

实现时先按"接受"做,实际看效果再定。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Electron `transparent:true` 在 Windows 上侧边栏可能透出黑/白底而非壁纸 | 现有 `applyDwmFix` 已处理 DWM 合成;实现时先验证,必要时在 `dwm.ts` 调 `DWMWA_SYSTEMBACKDROP_TYPE` 等 |
| `backdrop-filter` 在父链有 `transform`(3D) / `contain: paint` / `filter` 时失效(Zen 的已知坑) | 确保侧边栏父链无上述属性;实现后用 Browser Toolbox 核验 |
| 侧边栏子元素不透明背景遮挡模糊 | 见改动 C,逐个审查子组件 |
| 旧用户 localStorage 残留 `theme: 'aurora'` | rehydration / 启动时降级为 `dark`(见 A) |
| 删除 aurora 后 Tailwind 未使用的 Grainient 相关样式残留 | 删除对应 CSS,确认无编译警告 |

## 验证清单

- [ ] dark 模式:侧边栏可见模糊的桌面壁纸,tint 45%,文字清晰可读
- [ ] light 模式:侧边栏奶白磨砂,tint 72%,文字清晰可读
- [ ] 主区域完全不透明,壁纸不透出
- [ ] 主题切换(dark↔light)流畅,无闪烁、无残留 aurora 痕迹
- [ ] 侧边栏各子组件(搜索框、会话列表、宠物栏、按钮组)不遮挡模糊层
- [ ] 旧 localStorage `theme: 'aurora'` 启动后安全降级为 dark
- [ ] 窗口圆角 / clipPath / border 视觉正常
- [ ] 外层 div 透明后 4px 缝隙效果可接受(见待决策)

## 影响文件汇总

- `src/shared/types.ts`
- `src/renderer/styles/globals.css`
- `src/renderer/App.tsx`
- `src/renderer/main.tsx`
- `src/renderer/stores/chatStore.ts`
- `src/renderer/components/Sidebar.tsx`
- `src/renderer/components/RightSidebar.tsx`
- `src/renderer/components/GradientButtonGroup.tsx`
- `src/renderer/components/ModelIsland.tsx`
- `src/renderer/components/UsageStatsPanel.tsx`
- `src/renderer/components/NerveCloud.tsx`
- `src/renderer/components/NerveOrb.tsx`
- (可选)`src/renderer/components/Grainient.tsx` 及 `ogl` 依赖
