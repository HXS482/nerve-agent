# Sidebar Glassmorphism Background Clipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clip the solid background to exclude the sidebar area so the desktop shows through the sidebar's backdrop-filter blur, while preserving the full solid background when the sidebar is hidden.

**Architecture:** Extract the solid background from the root div into a separate fixed layer with dynamic `clipPath`. When sidebar is open, the clipPath excludes the sidebar rectangle. When closed, the full background is restored. A `SIDEBAR_OFFSET` constant keeps the clip synchronized with the main content margin.

**Tech Stack:** React, TypeScript, CSS clip-path, Electron Vite

---

## File Structure

**Modified Files:**
- `src/renderer/App.tsx` — Root div background, new background layer, main content background, SIDEBAR_OFFSET constant

**Reference Files:**
- `docs/superpowers/specs/2026-06-13-sidebar-glassmorphism-bg-clip-design.md` — Design specification

---

### Task 1: Add SIDEBAR_OFFSET Constant and Background Layer

**Files:**
- Modify: `src/renderer/App.tsx:124-153` (App component root)

- [ ] **Step 1: Read the current App component structure**

Read `src/renderer/App.tsx` to understand the current layout:
- Root div at line 146-152 with `background: 'var(--bg-background)'`
- Main content at line 196-207 with `background: 'var(--bg-mica)'` and dynamic `marginLeft`

- [ ] **Step 2: Add SIDEBAR_OFFSET constant**

Add this constant inside the `App` component, after the `useState` hooks (around line 139):

```typescript
const SIDEBAR_OFFSET = 8 // 4px (root margin) + 4px (gap between sidebar and main content border)
```

- [ ] **Step 3: Verify constant placement**

Ensure the constant is inside the `App` function component and accessible in the JSX return.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): add SIDEBAR_OFFSET constant for background clipping"
```

---

### Task 2: Make Root Div Background Transparent

**Files:**
- Modify: `src/renderer/App.tsx:146-152` (root div)

- [ ] **Step 1: Update root div background**

Find the root `<div>` (approximately line 146):

Current code:
```tsx
<div
  className="h-screen w-screen flex overflow-hidden"
  style={{
    background: 'var(--bg-background)',
    borderRadius: 'var(--app-window-radius)',
    clipPath: 'inset(0 round var(--app-window-radius))',
  }}
>
```

New code:
```tsx
<div
  className="h-screen w-screen flex overflow-hidden"
  style={{
    background: 'transparent',
    borderRadius: 'var(--app-window-radius)',
    clipPath: 'inset(0 round var(--app-window-radius))',
  }}
>
```

- [ ] **Step 2: Verify syntax is correct**

Check that only the `background` property changed, all other properties remain.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): make root div background transparent for glassmorphism"
```

---

### Task 3: Add Dynamic Background Layer

**Files:**
- Modify: `src/renderer/App.tsx:153-154` (after root div opening, before Aurora background)

- [ ] **Step 1: Add the background layer div**

Insert this div immediately after the root `<div>` opening tag and before the Aurora theme background (approximately line 153):

```tsx
{/* Solid background layer — clipped to exclude sidebar area */}
<div
  className="fixed inset-0"
  style={{
    background: 'var(--bg-background)',
    borderRadius: 'var(--app-window-radius)',
    clipPath: sidebarOpen
      ? `inset(0 0 0 ${sidebarWidth + SIDEBAR_OFFSET}px)`
      : 'none',
    transition: 'clip-path 0.3s ease',
    zIndex: 0,
  }}
/>
```

- [ ] **Step 2: Verify placement**

The background layer should be:
- Inside the root div
- Before the Aurora theme background `{theme === 'aurora' && ...}`
- Before the Sidebar component
- Before the main content

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): add dynamic background layer with sidebar clipPath"
```

---

### Task 4: Make Main Content Background Transparent

**Files:**
- Modify: `src/renderer/App.tsx:196-207` (main element)

- [ ] **Step 1: Update main element background**

Find the `<main>` element (approximately line 196):

Current code:
```tsx
<main
  className="flex-1 flex flex-col overflow-hidden relative"
  style={{
    margin: '4px',
    marginLeft: sidebarOpen ? `${sidebarWidth + 8}px` : '4px',
    marginRight: rightSidebarOpen ? `${rightSidebarWidth + 8}px` : '4px',
    background: 'var(--bg-mica)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--app-shell-radius)',
    transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
  }}
>
```

New code:
```tsx
<main
  className="flex-1 flex flex-col overflow-hidden relative"
  style={{
    margin: '4px',
    marginLeft: sidebarOpen ? `${sidebarWidth + SIDEBAR_OFFSET}px` : '4px',
    marginRight: rightSidebarOpen ? `${rightSidebarWidth + 8}px` : '4px',
    background: 'transparent',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--app-shell-radius)',
    transition: 'margin-left 0.3s ease, margin-right 0.3s ease',
  }}
>
```

Changes:
1. `background: 'var(--bg-mica)'` → `background: 'transparent'`
2. `marginLeft: sidebarOpen ? \`${sidebarWidth + 8}px\`` → `\`${sidebarWidth + SIDEBAR_OFFSET}px\`` (use constant)

- [ ] **Step 2: Verify both changes are correct**

- background is now `'transparent'`
- marginLeft uses `SIDEBAR_OFFSET` constant instead of hardcoded `8`

- [ ] **Step 3: Run build to verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat(app): make main content transparent, use SIDEBAR_OFFSET constant"
```

---

### Task 5: Test and Verify

**Files:**
- None (manual testing)

- [ ] **Step 1: Start development server**

Run: `npm run dev`
Expected: Dev server starts on port 5173, Electron app launches

- [ ] **Step 2: Test dark theme — sidebar open**

1. Set theme to dark
2. Open sidebar
3. Verify: Desktop wallpaper visible through sidebar (backdrop blur effect)
4. Verify: Main content area has solid background (content is readable)
5. Verify: Window rounded corners preserved

- [ ] **Step 3: Test dark theme — sidebar closed**

1. Close sidebar
2. Verify: Full solid background restored across entire window
3. Verify: Chat panel looks identical to before

- [ ] **Step 4: Test sidebar toggle transition**

1. Toggle sidebar open/closed multiple times
2. Verify: Smooth clip-path transition (no jank)
3. If transition janks: note this as fallback to opacity approach

- [ ] **Step 5: Test light theme**

1. Switch to light theme
2. Repeat steps 2-4
3. Verify: Desktop visible through sidebar with light tint

- [ ] **Step 6: Test Aurora theme**

1. Switch to Aurora theme
2. Verify: Grainient background renders correctly
3. Verify: Sidebar glassmorphism works (Aurora has its own backdrop logic)

- [ ] **Step 7: Run test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 8: Stop dev server**

Run: Ctrl+C in terminal

---

### Task 6: Final Build and Push

**Files:**
- None (verification only)

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Push branch**

Run: `git push -u origin feat/sidebar-glassmorphism-helpers`
Expected: Branch pushed successfully

- [ ] **Step 3: Update PR description**

Update PR #16 to include background clipping changes:
- Added dynamic background layer with clipPath
- Root div now transparent, desktop shows through sidebar
- SIDEBAR_OFFSET constant for synchronized clipping
- Main content background transparent

---

## Verification Checklist

After completing all tasks, verify:

- [ ] Desktop visible through sidebar (dark theme)
- [ ] Desktop visible through sidebar (light theme)
- [ ] Solid background behind main content when sidebar open
- [ ] Full solid background when sidebar closed
- [ ] Smooth transition when toggling sidebar
- [ ] Window rounded corners preserved
- [ ] Aurora theme unaffected
- [ ] No TypeScript errors
- [ ] Build succeeds
- [ ] All tests pass
- [ ] Branch pushed and PR updated

---

## Notes

- This is a pure CSS/layout change — no logic modifications
- The SIDEBAR_OFFSET constant must stay synchronized with the main content marginLeft formula
- clip-path transitions work in Chromium/Electron but may not be GPU-composited — test for jank
- The background layer sits behind everything (z-0) and only provides the solid color base
