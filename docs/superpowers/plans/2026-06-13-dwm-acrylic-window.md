# DWM Acrylic Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch from CSS-based blur to DWM-native acrylic by fixing window config, DWM attributes, and removing CSS hacks.

**Architecture:** 4 files change together as one atomic unit — window config enables acrylic, DWM stops blocking it, CSS mask/backdrop-filter removed as redundant.

**Tech Stack:** Electron BrowserWindow, Windows DWM API (koffi), React CSS

---

### Task 1: Window config + DWM + CSS cleanup

All 4 files must change together for the app to work.

**Files:**
- Modify: `src/main/index.ts:53,60,100`
- Modify: `src/main/dwm.ts:33,46,56,67-68`
- Modify: `src/renderer/App.tsx:166-181`
- Modify: `src/renderer/components/Sidebar.tsx:12,29-33,139-140`

- [ ] **Step 1: index.ts — transparent: false, backgroundColor**

In `src/main/index.ts`, change the BrowserWindow config:

```diff
-    transparent: true,
+    transparent: false,
```

```diff
-    backgroundColor: '#00000000',
+    backgroundColor: '#0d0d0d',
```

- [ ] **Step 2: index.ts — delete setBackgroundColor call**

In `src/main/index.ts`, delete line 100:

```diff
-  window.setBackgroundColor('#00000000')
```

- [ ] **Step 3: dwm.ts — keep WS_THICKFRAME, remove NCRENDERING_POLICY**

In `src/main/dwm.ts`, change the style cleanup line to preserve WS_THICKFRAME:

```diff
-    const cleanStyle = style & ~(WS_CAPTION | WS_BORDER | WS_DLGFRAME | WS_THICKFRAME)
+    const cleanStyle = style & ~(WS_CAPTION | WS_BORDER | WS_DLGFRAME)
```

Remove the NCRENDERING_POLICY block entirely (lines 67-68):

```diff
-    const ncPolicy = new Int32Array([DWMNCRP_DISABLED])
-    DwmSetWindowAttribute(hwnd, DWMWA_NCRENDERING_POLICY, ncPolicy, 4)
```

Also remove the now-unused constants from the top of the function:

```diff
-    const DWMWA_NCRENDERING_POLICY = 2
```

```diff
-    const DWMNCRP_DISABLED = 1
```

- [ ] **Step 4: App.tsx — remove mask-based background layer**

In `src/renderer/App.tsx`, delete the entire mask-based background layer div (lines 166-181):

```diff
-      {/* Solid background layer — gradient-masked to blend with sidebar glass */}
-      <div
-        className="fixed inset-0"
-        style={{
-          background: 'var(--bg-background)',
-          borderRadius: 'var(--app-window-radius)',
-          WebkitMaskImage: sidebarOpen
-            ? `linear-gradient(to right, transparent ${sidebarWidth - 10}px, black ${sidebarWidth + 5}px)`
-            : 'none',
-          maskImage: sidebarOpen
-            ? `linear-gradient(to right, transparent ${sidebarWidth - 10}px, black ${sidebarWidth + 5}px)`
-            : 'none',
-          transition: 'mask-image 0.3s ease, -webkit-mask-image 0.3s ease',
-          zIndex: 0,
-        }}
-      />
```

- [ ] **Step 5: Sidebar.tsx — remove backdrop-filter**

In `src/renderer/components/Sidebar.tsx`, delete the constant:

```diff
- const SIDEBAR_BACKDROP_FILTER = 'blur(30px) saturate(180%) brightness(1.02)'
```

Delete the `getBackdropFilter` function:

```diff
- const getBackdropFilter = (theme: Theme) => {
-   if (theme === 'aurora') {
-     return undefined
-   }
-   return SIDEBAR_BACKDROP_FILTER
- }
```

Remove `backdropFilter` and `WebkitBackdropFilter` from the `<aside>` style prop:

```diff
          boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
-         backdropFilter: getBackdropFilter(theme),
-         WebkitBackdropFilter: getBackdropFilter(theme)
```

- [ ] **Step 6: Visual verification**

Run `npm run dev` and verify:
- Desktop wallpaper visible through the entire window with native acrylic blur
- Sidebar area shows frosted glass effect
- Main content area readable with solid background
- No visual artifacts

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/main/dwm.ts src/renderer/App.tsx src/renderer/components/Sidebar.tsx
git commit -m "feat(window): DWM acrylic — native blur, remove CSS backdrop hacks"
```
