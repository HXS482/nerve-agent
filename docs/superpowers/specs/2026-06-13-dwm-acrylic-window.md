# DWM Acrylic Window

## Problem

CSS `backdrop-filter` cannot blur the desktop wallpaper in an Electron transparent window. `backgroundMaterial: 'acrylic'` requires `transparent: false`, which conflicts with the current architecture.

## Solution

Switch from CSS-based blur to DWM-native acrylic. Remove all CSS hacks (mask, backdrop-filter). Handle rounded corners separately later.

## Changes

### src/main/index.ts

1. `transparent: true` → `transparent: false`
2. `backgroundColor: '#00000000'` → `backgroundColor: '#0d0d0d'`
3. Delete `window.setBackgroundColor('#00000000')` call
4. `backgroundMaterial: 'acrylic'` — keep as-is

### src/main/dwm.ts

In `applyDwmFix`:
1. Do NOT strip `WS_THICKFRAME` (0x00040000) from window style
2. Remove `DWMWA_NCRENDERING_POLICY = DWMNCRP_DISABLED` call
3. Keep `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_DONOTROUND` (rounded corners handled later)
4. Keep all other cleanup (WS_CAPTION, WS_BORDER, WS_DLGFRAME, border color)

### src/renderer/App.tsx

1. Remove the mask-based background layer div (`WebkitMaskImage` gradient)
2. Main content area uses solid CSS background directly

### src/renderer/components/Sidebar.tsx

1. Remove `SIDEBAR_BACKDROP_FILTER` constant and its usage
2. Keep light/dark background tint constants at current low values (`0.08` light, `0.15` dark)

## Scope

- **In**: Window config, DWM attributes, CSS mask removal, backdrop-filter removal
- **Out**: Rounded corners (separate task), right sidebar, theme system

## Success Criteria

- [ ] Desktop wallpaper visible through entire window with native acrylic blur
- [ ] Sidebar area shows frosted glass effect
- [ ] Main content area readable with solid background
- [ ] No CSS backdrop-filter or mask hacks remain
