# NerveCloud — Particle Cloud Component Design

## Motivation

Replace the current WebGL-based `NerveOrb` (3D shader sphere) with a lightweight CSS particle cloud (`NerveCloud`) that visually indicates agent state through color changes.

## Design Decisions

- **Pure CSS approach**: ~80 DOM `<span>` particles with CSS `@keyframes` animations, `filter: blur()` for glow. No WebGL or Canvas dependency.
- **Same interface**: `NerveCloud` exposes the same `Props` as `NerveOrb` (`state`, `theme`, `size`, `className`), making the swap a one-line import change in `App.tsx`.
- **Larger default**: Size defaults to 64px (vs 36px for NerveOrb) for more presence.

## State → Color Mapping

| `orbState` | Color        | Hex                            |
| ---------- | ------------ | ------------------------------ |
| `idle`     | Blue         | `#4A9EFF`                      |
| `active`   | Azure→Purple | `#6BA3FE` → `#A855F7` gradient |
| `thinking` | Cyan         | `#22D3EE`                      |
| `morphing` | Orange/Red   | `#F97316`                      |

## Technical Design

### Particle Layout

- 80 `<span>` elements positioned absolutely inside a `position: relative` container
- Gaussian-like distribution: center-dense, sparse edges
- Random sizes: 2px–6px diameter
- Each particle has `border-radius: 50%` and `filter: blur(1px–3px)`

### Animation

- Each particle gets independent `@keyframes` animation:
  - `translateX`/`translateY` drift: random range ±8px–±20px
  - `scale` oscillation: 0.6–1.2 for breathing effect
- Duration: 3s–8s random, `ease-in-out`, `infinite alternate`
- Container has `filter: blur(4px)` for soft cloud edge

### Color Transitions

- All particles share a CSS custom property `--cloud-color`
- On state change, `--cloud-color` is updated; CSS `transition: background-color 0.6s ease` handles smooth lerp
- For `active` state, a CSS pseudo-element overlay with radial gradient creates the gradient effect

### Theme Adaptation

- Idle blue varies slightly by theme:
  - dark: `#4A9EFF`
  - light: `#3B82F6`
  - aurora: `#60A5FA`

## File Changes

1. **Create** `src/renderer/components/NerveCloud.tsx` — new component
2. **Modify** `src/renderer/App.tsx` — change import and usage from `NerveOrb` to `NerveCloud`
3. **Delete** (optional) `src/renderer/components/NerveOrb.tsx` — old component no longer used

## Non-Goals

- No particle-to-particle interaction (collision, attraction)
- No GPU acceleration beyond what CSS Compositing provides
- No subagent-level color mapping (subagent color is out of scope for v1)
