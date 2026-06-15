# Sidebar True Glassmorphism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar's 50% opaque tint + weak blur with true frosted glass (low tint + strong blur), matching Apple's Control Center material.

**Architecture:** Change 3 constants in `src/renderer/components/Sidebar.tsx`. No other files touched. Aurora theme logic unchanged.

**Tech Stack:** React, Electron (Chromium backdrop-filter)

---

### Task 1: Update sidebar glass constants

**Files:**
- Modify: `src/renderer/components/Sidebar.tsx:12-14`

- [ ] **Step 1: Change LIGHT_SIDEBAR_BG**

In `src/renderer/components/Sidebar.tsx`, change line 12:

```diff
- const LIGHT_SIDEBAR_BG = 'rgba(255, 255, 255, 0.5)'
+ const LIGHT_SIDEBAR_BG = 'rgba(255, 255, 255, 0.08)'
```

- [ ] **Step 2: Change DARK_SIDEBAR_BG**

Change line 13:

```diff
- const DARK_SIDEBAR_BG = 'rgba(20, 20, 22, 0.5)'
+ const DARK_SIDEBAR_BG = 'rgba(20, 20, 22, 0.15)'
```

- [ ] **Step 3: Change SIDEBAR_BACKDROP_FILTER**

Change line 14:

```diff
- const SIDEBAR_BACKDROP_FILTER = 'blur(20px) saturate(150%)'
+ const SIDEBAR_BACKDROP_FILTER = 'blur(30px) saturate(180%) brightness(1.02)'
```

- [ ] **Step 4: Verify aurora theme logic untouched**

Confirm `getSidebarBackground` still returns `'var(--bg-mica)'` for aurora and `getBackdropFilter` returns `undefined` for aurora. No changes needed to these functions.

- [ ] **Step 5: Visual verification**

Launch the app (`npm run dev` or equivalent), toggle light/dark themes:
- Sidebar should show blurred desktop wallpaper through it
- Text should remain readable
- Aurora theme should look identical to before

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/Sidebar.tsx
git commit -m "fix(sidebar): true glassmorphism — low tint + strong blur"
```
