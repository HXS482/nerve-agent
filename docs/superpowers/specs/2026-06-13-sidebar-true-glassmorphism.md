# Sidebar True Glassmorphism

## Problem

Sidebar.tsx applies 50% opaque solid color on top of `backdrop-filter: blur(20px)`. Since App.tsx already clips the solid background behind the sidebar area, the blur operates on the desktop wallpaper — but the heavy 50% tint obscures the frosted glass effect.

## Reference: Apple Material System

Apple's HIG defines material tiers. Our scenario (clipped background, sidebar overlay) maps to **Control Center / .thinMaterial**:

| Parameter | Apple Sidebar (no clip) | Apple Control Center (clipped) | Nerve Current | Nerve Target |
|---|---|---|---|---|
| Blur | 20px | 40px | 20px | **30px** |
| Saturation | 180% | 180% | 150% | **180%** |
| Brightness | — | 1.02 | — | **1.02** |
| Light tint | 0.72 | 0.10 | 0.50 | **0.08** |
| Dark tint | — | 0.20-0.35 | 0.50 | **0.15** |

Rationale for 30px (not Apple's 40px): Electron/Chromium blur is heavier than Core Animation; 30px ≈ Apple's 40px in perceived softness. Can bump to 40px if too sharp.

## Solution

### Changes (Sidebar.tsx)

```diff
- const LIGHT_SIDEBAR_BG = 'rgba(255, 255, 255, 0.5)'
- const DARK_SIDEBAR_BG = 'rgba(20, 20, 22, 0.5)'
- const SIDEBAR_BACKDROP_FILTER = 'blur(20px) saturate(150%)'
+ const LIGHT_SIDEBAR_BG = 'rgba(255, 255, 255, 0.08)'
+ const DARK_SIDEBAR_BG = 'rgba(20, 20, 22, 0.15)'
+ const SIDEBAR_BACKDROP_FILTER = 'blur(30px) saturate(180%) brightness(1.02)'
```

Aurora theme unchanged.

### Why dark tint is higher than light

Dark mode text (light on dark) needs more background contrast to stay readable against bright wallpaper. Apple uses 0.20-0.35 for dark; we pick 0.15 as the low end since our blur is strong.

## Scope

- **In**: Light/dark sidebar background opacity, blur/saturation/brightness
- **Out**: Aurora theme, App.tsx clipping, right sidebar, border/shadow

## Success Criteria

- [ ] Desktop wallpaper visible through sidebar with frosted glass blur
- [ ] Text readable on both themes
- [ ] Aurora theme unaffected
- [ ] Saturated colors in wallpaper produce pleasant bleed-through
