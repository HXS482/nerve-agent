# 设置面板 ChunUI 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `SettingsPanel.tsx` 的排版从「发丝线分段 + 灰盒套灰盒」重排为 ChunUI iOS 设置范式：分组大卡、卡外 uppercase 段标题、行内发丝线、控件右对齐、ccReveal 入场动效。

**Architecture:** 纯排版层重构。`SettingsPanel.tsx` 内重做共享基础件（Section/Row/Toggle 等），9 个 tab 复用；`globals.css` 只追加 settings-cc 样式块 + 删除一条被改废的旧规则。数据流、IPC、模态壳全部不动。

**Tech Stack:** React + TypeScript + inline styles（跟随现有文件风格），CSS 变量主题。

## Global Constraints

- 配色只允许现有 CSS 变量（`--accent-primary`、`--bg-surface-*`、`--border-subtle`、`--text-*`），禁止引入新颜色字面量（rgba 白描边等现有写法除外）
- 三梯度字号：**13**（行标签/控件/按钮）/ **11**（hint/元信息/uppercase 段标题）/ mono 值保持 12
- 不改任何 `window.claude.*` IPC 调用、state 逻辑、Props 签名
- 不动模态壳（backdrop、尺寸、`--dynamic-island-*`、关闭按钮）
- `globals.css` 现有规则只删被本次改废的，其余只追加
- 仓库 tsc 有**预存错误**（Grainient/BrainPanel 等，与本次无关）。每步验证命令必须过滤：无 `SettingsPanel` 相关输出才算过

**验证命令（每步通用）：**
```powershell
Set-Location H:/Arch/Worktree/nerve-agent; npx tsc --noEmit -p tsconfig.web.json 2>&1 | Select-String "SettingsPanel"
```
预期输出：空（无匹配行）。

**TDD 说明：** 本任务是纯视觉排版重构，无逻辑变更，单测无法覆盖 CSS 布局；自动化门槛为上述 tsc 过滤检查，视觉门槛为收尾后用户在应用里过 9 个 tab + 三主题。不引入组件测试框架（YAGNI）。

---

### Task 1: globals.css 追加 settings-cc 样式块

**Files:**
- Modify: `src/renderer/styles/globals.css`（在 `/* ===== Settings：设置区分段，首段不画分隔线 ===== */` 区块处，约 4036 行）

**Interfaces:**
- Produces（后续所有任务依赖的 CSS 类名，逐字使用）：
  - `.settings-group-card` — 分组大卡
  - `.settings-list-row` — 可展开行行头
  - `.settings-list-expand` — 展开面板
  - `.settings-reveal` — ccReveal 入场单元
  - `.settings-card-pad` — 卡内松散内容的内边距
- Removes: 旧规则 `.settings-body > div > section:first-child, .settings-body > section:first-child { ... }`（Section 重构后不再产出 `<section>`，此规则被本次改动废掉）

- [ ] **Step 1: 替换旧 Settings 分段规则为 ChunUI 样式块**

找到（globals.css:4036-4042）：
```css
/* ===== Settings：设置区分段，首段不画分隔线 ===== */
.settings-body > div > section:first-child,
.settings-body > section:first-child {
  padding-top: 0;
  margin-top: 0;
  border-top: none;
}
```
整块替换为：
```css
/* ===== Settings ChunUI 化：分组大卡 + 发丝线 + ccReveal 入场 ===== */
/* tab 根容器：分组卡纵向节奏（gap 统一 20px，替代旧 Section 的 margin/border 自分段） */
.settings-body > div {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* 分组大卡：圆角 14 + 发丝边；直接子行间画发丝线（iOS 设置分组范式） */
.settings-group-card {
  border-radius: 14px;
  background: var(--bg-surface-container);
  border: 1px solid var(--border-subtle);
  overflow: hidden;
}
.settings-group-card > * + * {
  border-top: 1px solid var(--border-subtle);
}

/* 可展开列表行：行头 + 展开面板（面板顶部发丝线与行头分隔，不用底色块） */
.settings-list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  cursor: pointer;
}
.settings-list-expand {
  border-top: 1px solid var(--border-subtle);
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 卡内松散内容（不成行的按钮组、说明文字）统一内边距 */
.settings-card-pad {
  padding: 12px 14px;
}

/* ccReveal 入场：0.32s 零过冲上浮（ChunUI ccReveal 曲线 0.22,0.8,0.36,1），
   分组按序错峰 0.06s；`both` 让延迟期内保持隐藏 */
@keyframes cc-reveal {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.settings-reveal {
  animation: cc-reveal 0.32s cubic-bezier(0.22, 0.8, 0.36, 1) both;
}
.settings-body > div > .settings-reveal:nth-child(2) { animation-delay: 0.06s; }
.settings-body > div > .settings-reveal:nth-child(3) { animation-delay: 0.12s; }
.settings-body > div > .settings-reveal:nth-child(4) { animation-delay: 0.18s; }
.settings-body > div > .settings-reveal:nth-child(5) { animation-delay: 0.24s; }
.settings-body > div > .settings-reveal:nth-child(n+6) { animation-delay: 0.3s; }
@media (prefers-reduced-motion: reduce) {
  .settings-reveal { animation: none; }
}
```

- [ ] **Step 2: 验证**

运行验证命令（见 Global Constraints），预期：空输出。（纯 CSS 改动，tsc 不受影响，此步确认没碰坏别的。）

- [ ] **Step 3: Commit**

```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/styles/globals.css
git -C H:/Arch/Worktree/nerve-agent commit -m @'
style(settings): ChunUI 分组卡/发丝线/ccReveal 样式基础

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 2: 重做共享基础件（Section/Row/Toggle/TextInput/字号收敛）

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（仅 `// --- Shared UI Primitives ---` 到 `// --- Plugins Tab ---` 之间的基础件区，约 51-314 行）

**Interfaces:**
- Produces（后续 tab 任务依赖的签名）：
  - `Section({ title, hint?, children })` — 不变；渲染为 `.settings-reveal` 包 uppercase 标题 + `.settings-group-card`
  - `Row({ label, hint?, stack?, children })` — **新增 `stack?: boolean`**：true 时控件全宽堆在 label 下方（表单/宽控件），false（默认）时控件右对齐（紧凑控件）
  - `Toggle({ on, onChange, label })` — 签名不变，尺寸 40×22
  - 其余组件签名全部不变

- [ ] **Step 1: 重写 Section**

替换现有 `Section`（SettingsPanel.tsx:53-66）为：
```tsx
/** 设置分组：uppercase 段标题在卡外（ChunUI 段标题范式），内容包进分组大卡，
    整组以 settings-reveal 入场（错峰延迟由 CSS nth-child 接管） */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-reveal">
      <div style={{ margin: '0 14px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--text-outline)' }}>
          {title}
        </div>
        {hint && (
          <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 4, maxWidth: 520 }}>
            {hint}
          </div>
        )}
      </div>
      <div className="settings-group-card">{children}</div>
    </div>
  )
}
```

- [ ] **Step 2: 重写 Row**

替换现有 `Row`（69-87）为：
```tsx
/** 设置行：紧凑控件右对齐（stack 缺省）；表单/宽控件用 stack 全宽堆在 label 下。
    行节奏对齐 ChunUI：minHeight 44，左右内边距 14 与分组卡圆角呼应 */
function Row({ label, hint, stack, children }: { label: string; hint?: string; stack?: boolean; children: React.ReactNode }) {
  if (stack) {
    return (
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 3 }}>{hint}</div>}
        <div style={{ marginTop: 10, minWidth: 0 }}>{children}</div>
      </div>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        minHeight: 44,
        padding: '10px 14px',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-outline)', marginTop: 3 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 字号收敛（12 → 13）+ 微调控件**

逐个小改，全部在基础件区：

1. `PillGroup` 按钮（约 97-118）：`fontSize: 12` → `13`，`padding: '5px 11px'` → `'6px 12px'`
2. `TextInput`（122-157）：`fontSize: 12` → `13`；onFocus 改为焦点环（CCNeoInput 范式）：
```tsx
onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent-line)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)' }}
onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.boxShadow = 'none' }}
```
3. `MultilineInput`（160-186）：`fontSize: 12` → `13`；onFocus/onBlur 同 TextInput 加 boxShadow
4. `PrimaryButton`（188-212）：`fontSize: 12` → `13`，`padding: '7px 16px'` → `'8px 16px'`
5. `SecondaryButton`（214-238）：同上
6. `FieldLabel`（240-246）：`fontSize: 12` → `13`
7. `Hint`（248-254）：不变（11）
8. `Toggle`（257-277）：尺寸改 40×22、滑块 14：
```tsx
style={{
  width: 40, height: 22, borderRadius: 11, padding: 3,
  background: on ? 'var(--accent-primary)' : 'var(--bg-surface-container-highest)',
  border: '1px solid var(--border-subtle)',
  display: 'flex', alignItems: 'center',
  justifyContent: on ? 'flex-end' : 'flex-start',
  flexShrink: 0,
}}
// 滑块：
<span style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
```
9. `StatusBadge`（305-314）：`fontSize: 12` → `13`

- [ ] **Step 4: 验证**

运行验证命令，预期：空输出。此步后 General 等直接用 Section/Row 的 tab 会自动换新排版（行内容暂时还是旧 12px 的自定义位，后续 task 收敛）。

- [ ] **Step 5: Commit**

```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): 基础件 ChunUI 化——Section 卡外标题/Row 右对齐/Toggle 40x22/焦点环

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 3: General / Soul / Persona / Voice 换壳收尾

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（GeneralTab/ConversationWidthControl/StageBgPicker/PromptEditorTab/VoiceTab）

**Interfaces:**
- Consumes: Task 2 的 `Row({ stack })` 新签名

- [ ] **Step 1: GeneralTab 宽控件行改 stack**

GeneralTab 内三处 Row 加 `stack`：
- `<Row label="Working directory">` → `<Row label="Working directory" stack>`
- `<Row label="Stage background" hint="...">` → `stack`
- `<Row label="Conversation width" hint="...">` → `stack`

Provider group / Effort / Permission mode 三行保持右对齐（紧凑控件）。

- [ ] **Step 2: ConversationWidthControl 字号**

`<span className="tabular-nums" ...>` 的 `fontSize: 11` 不变（元信息）。其余不动。

- [ ] **Step 3: StageBgPicker 字号**

预览框内 "No background" 与 `<Hint>` 不变（11）。其余不动。

- [ ] **Step 4: PromptEditorTab 扁平化 textarea**

textarea 现在落在分组卡内，去掉自身的盒子感（`background: var(--bg-surface-container)` + border 会形成双框）。把 textarea style 改为：
```tsx
style={{
  width: '100%',
  minHeight: 320,
  resize: 'vertical',
  padding: '12px 14px',
  borderRadius: 0,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-on-surface)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.6,
  outline: 'none',
  boxSizing: 'border-box',
}}
```
保存行（`flex items-center justify-end` 那个 div）改为 `className="settings-card-pad"` 的 div（作为卡第二个子元素，自动获得上方发丝线）：
```tsx
<div className="settings-card-pad flex items-center justify-end" style={{ gap: 10 }}>
```
（原来 `marginTop: 10` 删掉。）

- [ ] **Step 5: VoiceTab 三行改 stack**

- `<Row label="Endpoint">` → `stack`
- `<Row label="API key">` → `stack`
- `<Row label="Model" hint="...">` → `stack`

Verify 区块（Section title="Verify" 的 children）包一层卡内内边距：
```tsx
<Section title="Verify">
  <div className="settings-card-pad">
    <div className="flex items-center" style={{ gap: 8 }}>
      <SecondaryButton onClick={handleTest}>Record 2s and transcribe</SecondaryButton>
      <PrimaryButton onClick={handleSave}>{saved ? 'Saved' : 'Save'}</PrimaryButton>
    </div>
    {testResult && (
      <div style={{ marginTop: 12 }}>
        <StatusBadge ... />
      </div>
    )}
  </div>
</Section>
```

- [ ] **Step 6: 验证 + Commit**

运行验证命令，预期：空输出。
```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): General/Soul/Persona/Voice 适配新行排版

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 4: Provider tab 展开行化

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（ProviderTab 的 return JSX，约 1022-1303 行；逻辑函数不动）

**Interfaces:**
- Consumes: Task 1 的 `.settings-list-row` / `.settings-list-expand` / `.settings-card-pad`；Task 2 的 Row/Toggle/字号

- [ ] **Step 1: Providers 列表改分组卡展开行**

`<Section title="Providers" ...>` 的 children 整体替换——去掉内层灰盒（原 `borderRadius/background/border` 的 div），每个 provider 变成卡内一个 wrapper（行头 + 展开面板）：

```tsx
<Section title="Providers" hint="Endpoints and credentials. Fetch pulls the live model list; only checked models get saved.">
  {allProviders.map((p) => {
    const isDefault = p.id === (defaultProvider || 'anthropic')
    const isExpanded = expanded === p.id
    const isBase = p.id === 'anthropic'
    return (
      <div key={p.id}>
        <div className="settings-list-row" onClick={() => setExpanded(isExpanded ? null : p.id)}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-on-surface)', flex: 1 }}>
            {p.id}
          </span>
          {isDefault && <span style={{ fontSize: 11, color: 'var(--text-outline)' }}>default</span>}
          <span className="shrink-0" style={{ fontSize: 11, color: 'var(--text-outline)' }}>
            {p.type}
          </span>
          {!isBase && (
            <span onClick={(e) => e.stopPropagation()}>
              <IconButton onClick={() => handleDeleteProvider(p.id)} label={`Remove ${p.id}`} danger>
                <X size={13} strokeWidth={1.5} />
              </IconButton>
            </span>
          )}
        </div>
        {isExpanded && (
          <div className="settings-list-expand">
            {/* 原 isExpanded 内容原样搬入：isBase 的 Base URL/API Key、
                否则 Type/Base URL/API Key、Set as Default、Models 区块。
                原 div 外壳样式（padding/borderTop/gap）全部删除——
                间距由 .settings-list-expand 的 gap:10 承担 */}
          </div>
        )}
      </div>
    )
  })}
</Section>
```

搬入的展开内容里只做三处字号/结构调整：
1. `FieldLabel` 已在 Task 2 变 13——不改
2. Models 小按钮（Fetch / Save selection，原 `padding: '4px 10px', fontSize: 12`）：`fontSize: 12` → `13`，其余不动
3. 模型 checkbox 列表行 `fontSize: 12` → `13`；`maxHeight: 160, overflowY: 'auto'` 保留

注意：Section 现在自带 `.settings-group-card` 包裹，`> * + *` 发丝线自动落在 provider wrapper 之间；wrapper 内部行头与展开面板的分隔线由 `.settings-list-expand` 的 border-top 承担。

- [ ] **Step 2: New provider 表单改 stack**

`adding ? <Section title="New provider">` 内四个 Row 全部加 `stack`：
```tsx
<Row label="Name" stack>
<Row label="Type" stack>
<Row label="Base URL" stack>
<Row label="API key" stack>
```
按钮行 `<div className="flex items-center" style={{ gap: 8, paddingTop: 4 }}>` 改为：
```tsx
<div className="settings-card-pad flex items-center" style={{ gap: 8 }}>
```

- [ ] **Step 3: Model aliases 改卡内行**

`<Section title="Model aliases">` 的 children 改为「别名行 + 空态/添加表单」全部作为卡直接子元素（发丝线自动分隔）：

```tsx
<Section title="Model aliases" hint="A short name the top bar can select in place of a full model id.">
  {Object.entries(aliases).map(([alias, modelId]) => (
    <div key={alias} className="flex items-center" style={{ gap: 10, padding: '10px 14px' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-primary)', minWidth: 64 }}>{alias}</span>
      <span className="truncate flex-1" style={{ fontSize: 12, color: 'var(--text-on-surface-variant)', fontFamily: 'var(--font-mono)' }}>{modelId}</span>
      <IconButton onClick={() => handleDeleteAlias(alias)} label={`Remove alias ${alias}`} danger>
        <X size={13} strokeWidth={1.5} />
      </IconButton>
    </div>
  ))}
  {Object.keys(aliases).length === 0 && (
    <div className="settings-card-pad" style={{ fontSize: 13, color: 'var(--text-outline)' }}>None yet.</div>
  )}
  <div className="settings-card-pad flex items-center" style={{ gap: 8 }}>
    <div style={{ width: 110 }}>
      <TextInput value={newAlias} onChange={setNewAlias} placeholder="alias" />
    </div>
    <span style={{ fontSize: 13, color: 'var(--text-outline)' }}>→</span>
    <div className="flex-1">
      <TextInput value={newModelId} onChange={setNewModelId} placeholder="claude-sonnet-4-20250514" mono />
    </div>
    <SecondaryButton onClick={handleAddAlias}>Add</SecondaryButton>
  </div>
</Section>
```

- [ ] **Step 4: Save 区块 + Add provider 按钮**

- Save Section children 包 `<div className="settings-card-pad flex items-center" style={{ gap: 8 }}>`（内容不变）
- 非 adding 状态的 "Add provider" 按钮外层 div（原 `paddingTop: 4`）改为：
```tsx
<div className="settings-reveal">
  <SecondaryButton onClick={() => setAdding(true)}>...</SecondaryButton>
</div>
```

- [ ] **Step 5: 验证 + Commit**

运行验证命令，预期：空输出。
```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): Provider 列表展开行化，表单/别名/保存适配分组卡

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 5: MCP tab 展开行化

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（McpTab 的 return JSX，约 1408-1555 行；状态与 handler 不动）

- [ ] **Step 1: Servers 列表改展开行**

`<Section title="Servers">` children 替换：去掉每个 server 的灰盒 div，改 wrapper 结构（与 Task 4 Step 1 同构）：

```tsx
<Section title="Servers" hint="Status is polled live; the Gateway reloads a few seconds after you save.">
  {entries.map(([name, cfg]) => {
    const status = MCP_STATUS_META[statusMap[name]?.status ?? 'connecting']
    return (
      <div key={name}>
        <div className="settings-list-row" onClick={() => setExpanded(expanded === name ? null : name)}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-on-surface)', flex: 1 }}>
            {name}
          </span>
          <span className="truncate" style={{ fontSize: 11, color: 'var(--text-outline)', fontFamily: 'var(--font-mono)', maxWidth: 220 }}>
            {cfg.url || cfg.command}
          </span>
          <span style={{ fontSize: 11, color: status.color, flexShrink: 0, minWidth: 66, textAlign: 'right' }}>
            {status.label}
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <IconButton onClick={() => handleDelete(name)} label={`Remove ${name}`} danger>
              <X size={13} strokeWidth={1.5} />
            </IconButton>
          </span>
        </div>
        {expanded === name && (
          <div className="settings-list-expand">
            {/* 原 expanded === name 的详情 div 内容原样搬入；
                原外壳 padding/borderTop/fontSize/gap 全删（间距归 .settings-list-expand），
                详情行的 fontFamily mono / fontSize 12 保留（mono 值层） */}
          </div>
        )}
      </div>
    )
  })}
  {entries.length === 0 && (
    <div className="settings-card-pad" style={{ fontSize: 13, color: 'var(--text-outline)' }}>
      None configured.
    </div>
  )}
</Section>
```

- [ ] **Step 2: New server 表单改 stack + 卡内按钮**

- `<Row label="Name">` → `stack`
- `<Row label="Transport" hint="...">` 保持右对齐（PillGroup 紧凑）
- `<Row label="URL">` → `stack`
- `<Row label="Headers" hint="...">` → `stack`
- `<Row label="Command">` → `stack`
- `<Row label="Environment" hint="...">` → `stack`
- 按钮行同 Task 4：`className="settings-card-pad flex items-center" style={{ gap: 8 }}`（去掉 paddingTop）

- [ ] **Step 3: Save 区块**

Save Section children 包 `<div className="settings-card-pad">`；"Add server" 按钮外层同 Task 4 Step 4 加 `settings-reveal`。

- [ ] **Step 4: 验证 + Commit**

运行验证命令，预期：空输出。
```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): MCP 列表展开行化，新建表单适配 stack 行

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 6: Channels tab 展开行化

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（ChannelsTab 的 return JSX，约 1854-2030 行；状态与 handler 不动）

- [ ] **Step 1: Network proxy 区块**

- `<Row label="Enabled">` 保持右对齐（Toggle）
- `<Row label="Protocol">` 保持右对齐（PillGroup）
- `<Row label="Host">` → `stack`
- `<Row label="Port">` → `stack`
- 底部 `<Hint>{proxyProtocol}://...}` 保留（Row stack 的 hint 槽在上方，这个 Hint 在 Row 外——包进 stack 行外层？不改位置，作为 Section 卡的直接子元素加 `settings-card-pad`）：
```tsx
<div className="settings-card-pad">
  <Hint>{proxyProtocol}://{proxyHost}:{proxyPort}</Hint>
</div>
```

- [ ] **Step 2: Public access 区块**

- `<Row label="Enabled">` 右对齐不动
- `<Row label="Access token" hint="...">` → `stack`
- Endpoint Hint 同 Step 1 包 `settings-card-pad`

- [ ] **Step 3: IM channels 列表改展开行**

与 Task 4/5 同构：channel wrapper（`.settings-list-row` 行头 + `.settings-list-expand`）。行头内容：`ch.name`（13/600）、`CHANNEL_PLATFORM_LABELS[ch.platform]`（11）、Toggle、删除钮。展开面板内 fields 循环的 `<Row key={field.key} label={field.label}>` → 加 `stack`（TextInput 全宽）。空态包 `settings-card-pad`，`fontSize: 12` → `13`。

- [ ] **Step 4: Add channel + Save**

- `<Row label="Platform">` 保持右对齐（PillGroup）
- 按钮行 → `settings-card-pad flex items-center`（去 paddingTop）
- "Add channel" 按钮外层加 `settings-reveal`
- Save Section children 包 `settings-card-pad`

- [ ] **Step 5: 验证 + Commit**

运行验证命令，预期：空输出。
```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): Channels 展开行化，代理/公网行适配新排版

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 7: Skills / Plugins 行化

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（SkillsTab、PluginsTab）

- [ ] **Step 1: SkillsTab**

`<Section title="Skills">` children 改为 skill 行直接作卡子元素（发丝线自动分隔），去掉外层列表 wrapper 的 gap：
```tsx
{skills.map((skill) => (
  <div key={skill.id} className="flex items-center" style={{ gap: 12, padding: '10px 14px' }}>
    <Toggle on={skill.enabled} onChange={() => handleToggle(skill.id)} label={`Toggle ${skill.name}`} />
    <div className="flex-1 min-w-0">
      <span className="block truncate" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-on-surface)' }}>
        {skill.name}
      </span>
      {skill.description && (
        <span className="block" style={{ fontSize: 11, color: 'var(--text-outline)', lineHeight: 1.45 }}>
          {skill.description.length > 140 ? skill.description.slice(0, 140) + '…' : skill.description}
        </span>
      )}
    </div>
    <span className="shrink-0" style={{ fontSize: 11, color: skill.enabled ? 'var(--text-on-surface-variant)' : 'var(--text-outline)' }}>
      {skill.enabled ? 'On' : 'Off'}
    </span>
  </div>
))}
{skills.length === 0 && (
  <div className="settings-card-pad" style={{ fontSize: 13, color: 'var(--text-outline)' }}>
    None found.
  </div>
)}
```

- [ ] **Step 2: PluginsTab**

同理：plugin wrapper 行（Toggle + id + version/trust + Reload）+ 描述 + 工具数，全部作为卡直接子元素：
- 行头 flex：`fontSize: 12` → `13`（plugin.id），version/trust 保持 11
- 描述 `<p>` 11 不变，去掉自身 margin 改由行内 margin
- "None installed." 空态包 `settings-card-pad`、13
- loading 文案 `fontSize: 12` → `13`，包 `<div className="settings-card-pad">`
- PluginsTab 的 Section children 结构：每个 plugin 一个 wrapper div（发丝线分隔）

- [ ] **Step 3: 验证 + Commit**

运行验证命令，预期：空输出。
```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): Skills/Plugins 列表行化，发丝线分隔

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

---

### Task 8: 侧栏节奏 + tab 切换动效 + 收尾

**Files:**
- Modify: `src/renderer/components/SettingsPanel.tsx`（SettingsPanel 主组件：侧栏按钮、settings-body）

- [ ] **Step 1: 侧栏行节奏**

侧栏 tab 按钮（约 462-484）：`padding: '7px 10px'` → `'9px 10px'`，`fontSize: 12` → `13`（active 600 / 非 active 400 不变）。侧栏 tab 列表容器加滚动护栏（窗口矮时不溢出）：
```tsx
<div className="flex flex-col" style={{ padding: '0 8px 10px', gap: 1, overflowY: 'auto' }}>
```

- [ ] **Step 2: tab 切换重播入场动效**

settings-body 滚动容器加 `key={tab}`（remount 触发 settings-reveal 重播）：
```tsx
<div key={tab} className="settings-body flex-1 overflow-y-auto scrollbar-hide" style={{ padding: '0 24px 24px' }}>
```

- [ ] **Step 3: 全量验证**

运行验证命令，预期：空输出。另跑一次全量 tsc 确认错误集合与改动前一致（不新增文件级错误）：
```powershell
npx tsc --noEmit -p tsconfig.web.json 2>&1 | Measure-Object -Line
```
预期：行数与改动前相同（记录于 Task 8 执行时对比）。

- [ ] **Step 4: Commit**

```powershell
git -C H:/Arch/Worktree/nerve-agent add src/renderer/components/SettingsPanel.tsx
git -C H:/Arch/Worktree/nerve-agent commit -m @'
refactor(settings): 侧栏 44px 行节奏 + 切 tab 重播 ccReveal

Co-Authored-By: Claude Code <noreply@anthropic.com>
'@
```

- [ ] **Step 5: 用户视觉验收**

请用户在应用里过一遍：9 个 tab 排版、三主题（dark/light/aurora）分组卡与发丝线、切 tab 错峰入场、Provider/MCP/Channels 展开交互。有问题回到对应 task 修。
