# Sidebar Glassmorphism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add semi-transparent glassmorphism effect to the left sidebar for dark and light themes while preserving Aurora theme styling.

**Architecture:** Use CSS `backdrop-filter` with theme-dependent background colors (50% opacity) and blur (20px, 150% saturation). Helper functions in `Sidebar.tsx` return appropriate styles based on current theme. No new dependencies needed.

**Tech Stack:** React, TypeScript, CSS-in-JS, Electron Vite

---

## File Structure

**Modified Files:**
- `src/renderer/components/Sidebar.tsx` — Add helper functions for theme-specific glassmorphism styles and apply to sidebar element

**Reference Files:**
- `docs/superpowers/specs/2026-06-13-sidebar-glassmorphism-design.md` — Design specification
- `src/renderer/components/GradientButtonGroup.tsx` — Reference for existing backdrop-filter usage

---

### Task 1: Add Theme-Aware Style Helper Functions

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx:18-28` (add helper functions)

- [ ] **Step 1: Read current Sidebar implementation**

Check the current structure of the Sidebar component and understand where to add the helper functions.

- [ ] **Step 2: Add helper functions for glassmorphism styles**

```typescript
// Add these helper functions before the Sidebar component

const getSidebarBackground = (theme: string) => {
  if (theme === 'aurora') {
    return 'var(--bg-mica)' // Keep existing Aurora style
  }
  return theme === 'light'
    ? 'rgba(255, 255, 255, 0.5)'
    : 'rgba(20, 20, 22, 0.5)'
}

const getBackdropFilter = (theme: string) => {
  if (theme === 'aurora') {
    return undefined // Keep existing Aurora style
  }
  return 'blur(20px) saturate(150%)'
}
```

- [ ] **Step 3: Verify helper functions are correctly placed**

Ensure the functions are exported or available within the Sidebar component scope and return the correct types.

- [ ] **Step 4: Commit helper functions**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat(sidebar): add glassmorphism style helper functions"
```

---

### Task 2: Apply Glassmorphism Styles to Sidebar Element

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx:112-116` (apply styles to aside element)

- [ ] **Step 1: Update the aside element styling**

Replace the current inline styles with theme-aware glassmorphism styles:

Current code (approximately lines 112-116):
```typescript
<aside
  className="fixed left-1 top-1 bottom-1 flex flex-col z-50 transition-[width] duration-300"
  style={{ width: sidebarWidth, background: 'var(--bg-mica)', border: '1px solid var(--border-default)', borderRadius: 'var(--app-shell-radius)', boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)', backdropFilter: theme === 'aurora' ? 'blur(20px) saturate(150%)' : undefined, WebkitBackdropFilter: theme === 'aurora' ? 'blur(20px) saturate(150%)' : undefined }}
>
```

New code:
```typescript
<aside
  className="fixed left-1 top-1 bottom-1 flex flex-col z-50 transition-[width] duration-300"
  style={{
    width: sidebarWidth,
    background: getSidebarBackground(theme),
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--app-shell-radius)',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
    backdropFilter: getBackdropFilter(theme),
    WebkitBackdropFilter: getBackdropFilter(theme)
  }}
>
```

- [ ] **Step 2: Verify the changes are syntactically correct**

Check that the style prop is properly formatted and all commas/braces are balanced.

- [ ] **Step 3: Run build to verify no TypeScript errors**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit glassmorphism implementation**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "feat(sidebar): apply glassmorphism to dark and light themes"
```

---

### Task 3: Test Theme Switching

**Files:**
- None (manual testing)

- [ ] **Step 1: Start development server**

Run: `npm run dev`
Expected: Dev server starts on port 5173

- [ ] **Step 2: Test dark theme glassmorphism**

1. Open browser to http://localhost:5173
2. Ensure theme is set to dark
3. Verify sidebar shows desktop background through 50% opacity
4. Verify blur effect is visible (20px blur)
5. Verify border and shadow are preserved
6. Check all sidebar interactions work (buttons, links, scrolling)

- [ ] **Step 3: Test light theme glassmorphism**

1. Switch to light theme via UI
2. Verify sidebar shows desktop background through 50% opacity with white tint
3. Verify blur effect is visible
4. Verify all sidebar interactions work

- [ ] **Step 4: Test Aurora theme unchanged**

1. Switch to Aurora theme
2. Verify sidebar maintains existing Aurora style (no changes from current implementation)
3. Verify all sidebar interactions work

- [ ] **Step 5: Verify performance**

1. Scroll through session list in sidebar
2. Check for jank or stuttering
3. Monitor CPU/GPU usage if possible
4. Test on different desktop wallpapers to verify transparency effect

- [ ] **Step 6: Stop dev server**

Run: Ctrl+C in terminal or close the browser tab

---

### Task 4: Final Commit and Documentation

**Files:**
- None (verification only)

- [ ] **Step 1: Run full build to ensure everything compiles**

Run: `npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Run tests if available**

Run: `npm test`
Expected: All tests pass (if tests exist)

- [ ] **Step 3: Create final commit with all changes**

If there are any uncommitted changes from testing:
```bash
git add -A
git commit -m "feat(sidebar): complete glassmorphism implementation with testing"
```

- [ ] **Step 4: Push branch to remote**

Run: `git push -u origin feat/sidebar-glassmorphism`
Expected: Branch pushed successfully

- [ ] **Step 5: Create pull request**

Create PR with:
- Title: "feat(sidebar): add glassmorphism effect for dark and light themes"
- Description: Reference design spec and list key changes

---

## Verification Checklist

After completing all tasks, verify:

- [ ] Dark theme shows 50% opacity glassmorphism
- [ ] Light theme shows 50% opacity glassmorphism
- [ ] Aurora theme unchanged
- [ ] Blur effect is 20px with 150% saturation
- [ ] Border and shadow preserved
- [ ] All sidebar functionality intact
- [ ] No performance degradation
- [ ] No TypeScript errors
- [ ] Build succeeds
- [ ] Branch pushed and PR created

---

## Notes

- This is a pure CSS/styling change with no logic modifications
- Performance should be good since backdrop-filter is GPU-accelerated
- The implementation follows the existing pattern already used in Aurora theme
- No new dependencies are required
- The changes are isolated to the Sidebar component and won't affect other parts of the app
