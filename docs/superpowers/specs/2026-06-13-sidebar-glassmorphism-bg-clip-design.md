# Sidebar Glassmorphism Background Clipping Design

## Overview

When the sidebar is visible, the solid background behind it must be removed (clipped) so the desktop wallpaper shows through the sidebar's backdrop-filter blur. When the sidebar is hidden, the full solid background must be restored so the chat panel looks normal.

## Problem

The root `<div>` has `background: var(--bg-background)` which is a solid color (#0D0D0D for dark, #f8f9fa for light). The sidebar floats on top with `position: fixed`. Even with `backdrop-filter: blur()`, it can only blur the solid root background — the desktop is never visible.

## Solution

Separate the solid background into an independent layer with dynamic `clipPath` that excludes the sidebar area.

### Layer Structure

```
Window (transparent: true)
  └─ root <div> background: transparent
       ├─ Background layer div (fixed, z-0) ← dynamic clipPath
       ├─ Sidebar (fixed, z-50, backdrop-filter → desktop visible)
       └─ <main> (flex-1, background: transparent)
```

### Changes to App.tsx

1. **Root div**: Change `background: 'var(--bg-background)'` to `background: 'transparent'`
2. **New background layer**: Add a fixed div with `background: var(--bg-background)' and dynamic `clipPath`
3. **Main content**: Change `background: 'var(--bg-mica)'` to `background: 'transparent'`

### ClipPath Logic

```tsx
clipPath: sidebarOpen
  ? `inset(0 0 0 ${sidebarWidth + 8}px)`
  : 'none'
```

- **Sidebar open**: `inset(0 0 0 ${sidebarWidth+8}px)` — clips left side to exclude sidebar area
- **Sidebar closed**: `none` — full solid background restored
- **Transition**: `clip-path 0.3s ease` for smooth animation

### Edge Cases

- **Window corners**: Root div's existing `clipPath: inset(0 round var(--app-window-radius))` handles rounded corners for the entire window
- **Sidebar width changes**: `sidebarWidth` is dynamic, clipPath updates automatically
- **Aurora theme**: Grainient background layer is separate, unaffected by this change
- **Sidebar hidden**: Full solid background restored, chat panel looks identical to before

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
