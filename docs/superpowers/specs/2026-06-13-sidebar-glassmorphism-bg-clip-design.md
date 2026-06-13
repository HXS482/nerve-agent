# Sidebar Glassmorphism Background Clipping Design

## Overview

When the sidebar is visible, the solid background behind it must be removed (clipped) so the desktop wallpaper shows through the sidebar's backdrop-filter blur. When the sidebar is hidden, the full solid background must be restored so the chat panel looks normal.

## Problem

The root `<div>` has `background: var(--bg-background)` which is a solid color (#0D0D0D for dark, #f8f9fa for light). The sidebar floats on top with `position: fixed`. Even with `backdrop-filter: blur()`, it can only blur the solid root background — the desktop is never visible.

## Scope

**In scope:** Left sidebar background clipping
**Out of scope:** Right sidebar — it has its own solid `--bg-mica` background and functions as a content panel (settings, memory browser), not a floating overlay. Its transparency behavior is a separate concern.

## Solution

Separate the solid background into an independent layer with dynamic `clipPath` that excludes the sidebar area.

### Layer Structure

```
Window (transparent: true)
  └─ root <div> background: transparent
       ├─ Background layer div (fixed, z-0) ← dynamic clipPath + rounded corners
       ├─ Sidebar (fixed, z-50, backdrop-filter → desktop visible)
       └─ <main> (flex-1, background: transparent)
```

### Changes to App.tsx

1. **Root div**: Change `background: 'var(--bg-background)'` to `background: 'transparent'`. Keep existing `borderRadius` and `clipPath` for window shape.
2. **New background layer**: Add a fixed div with:
   - `background: 'var(--bg-background)'`
   - `borderRadius: 'var(--app-window-radius)'` (matches root's rounding)
   - `clipPath: sidebarOpen ? inset(0 0 0 ${sidebarWidth + 8}px) : 'none'` (dynamic cutout)
   - `transition: 'clip-path 0.3s ease'` (smooth animation)
   - `zIndex: 0`
3. **Main content**: Change `background: 'var(--bg-mica)'` to `background: 'transparent'`

### ClipPath Logic

```tsx
const SIDEBAR_OFFSET = 8 // 4px (root margin) + 4px (gap between sidebar and main content border)

clipPath: sidebarOpen
  ? `inset(0 0 0 ${sidebarWidth + SIDEBAR_OFFSET}px)`
  : 'none'
```

The `+8` offset matches the main content's `marginLeft: sidebarWidth + 8` formula. This is extracted as `SIDEBAR_OFFSET` constant to keep both values synchronized and documented.

### Edge Cases

- **Window corners**: Background layer must have the same `borderRadius` and the root div's `clipPath: inset(0 round var(--app-window-radius))` clips the entire tree including the background layer
- **Sidebar width changes**: `sidebarWidth` is dynamic, clipPath updates automatically
- **Aurora theme**: Grainient background layer is separate, unaffected by this change
- **Sidebar hidden**: `clipPath: none`, full solid background restored, chat panel looks identical to before
- **clip-path transition performance**: `clip-path` transitions may not GPU-compose in all Chromium versions. If jank is observed, fallback to toggling opacity on the background layer instead

## Files to Modify

- `src/renderer/App.tsx` — Root div background, new background layer, main content background

## Success Criteria

- [ ] Desktop visible through sidebar when open
- [ ] Solid background behind main content when sidebar open
- [ ] Full solid background when sidebar closed
- [ ] Smooth transition when toggling sidebar
- [ ] Window rounded corners preserved
- [ ] Aurora theme unaffected
- [ ] No visual regressions
