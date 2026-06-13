# Sidebar UI Optimization: Semi-Transparent Glassmorphism

## Overview

Optimize the left sidebar UI to have a semi-transparent blurred background that allows the desktop wallpaper to show through, creating a modern glassmorphism effect. The effect applies to dark and light themes while preserving the existing Aurora theme style.

## Requirements

### Transparency Level
- **Medium transparency**: Desktop background is clearly visible through the sidebar
- **Opacity**: 65% opacity for background color

### Blur Effect
- **Medium blur**: Desktop content is blurred but colors and shapes are still perceptible
- **Blur radius**: 20px
- **Saturation**: 150% to enhance colors slightly

### Theme Support
- **Dark theme**: Semi-transparent dark background with blur
- **Light theme**: Semi-transparent light background with blur
- **Aurora theme**: Unchanged (already has partial blur effect)

### Visual Elements
- **Border**: Retain current 1px solid border using `var(--border-default)`
- **Shadow**: Retain current box-shadow for depth perception
- **Border radius**: Maintain current `var(--app-shell-radius)`

## Technical Design

### CSS Implementation

#### Dark Theme
```css
background: rgba(20, 20, 22, 0.65);
backdrop-filter: blur(20px) saturate(150%);
-webkit-backdrop-filter: blur(20px) saturate(150%);
```

#### Light Theme
```css
background: rgba(255, 255, 255, 0.65);
backdrop-filter: blur(20px) saturate(150%);
-webkit-backdrop-filter: blur(20px) saturate(150%);
```

### Component Changes

**File: `src/renderer/components/Sidebar.tsx`**

Modify the `<aside>` element styling to conditionally apply glassmorphism based on theme:

```typescript
const getSidebarBackground = (theme: string) => {
  if (theme === 'aurora') {
    return 'var(--bg-mica)' // Keep existing Aurora style
  }
  return theme === 'light'
    ? 'rgba(255, 255, 255, 0.65)'
    : 'rgba(20, 20, 22, 0.65)'
}

const getBackdropFilter = (theme: string) => {
  if (theme === 'aurora') {
    return undefined // Keep existing Aurora style
  }
  return 'blur(20px) saturate(150%)'
}
```

Apply these functions to the `<aside>` element's style prop.

### Performance Considerations

- ✅ GPU-accelerated `backdrop-filter` for smooth performance
- ✅ Moderate blur radius (20px) balances visual effect with performance
- ✅ Saturation capped at 150% to avoid performance overhead
- ✅ No JavaScript calculations needed - pure CSS implementation

### Browser Compatibility

- ✅ Chrome/Edge: Full support
- ✅ Firefox: Full support
- ✅ Safari: Requires `-webkit-` prefix (included)
- ⚠️ Older browsers: Will fallback to solid background (graceful degradation)

## Testing

### Visual Testing
1. Test in dark theme - verify glassmorphism effect visible
2. Test in light theme - verify glassmorphism effect visible
3. Test in Aurora theme - verify no changes
4. Test with different desktop wallpapers - verify transparency effect
5. Test sidebar scrolling - verify performance

### Functional Testing
1. Verify all sidebar interactions work (buttons, links, etc.)
2. Verify theme switching works correctly
3. Verify responsive resizing works
4. Verify pet dock functionality unchanged

### Performance Testing
1. Check frame rate during scrolling
2. Verify no jank or stuttering
3. Test on lower-end hardware if possible

## Success Criteria

- [x] Desktop background visible through sidebar at 65% opacity
- [x] Medium blur effect (20px) applied
- [x] Dark and light themes have glassmorphism
- [x] Aurora theme unchanged
- [x] Border and shadow preserved
- [x] All sidebar functionality intact
- [x] No performance degradation

## Out of Scope

- Changing blur intensity based on scroll position
- Dynamic opacity adjustments
- Animation/transitions for theme switching
- Support for very old browsers without backdrop-filter

## References

- Current implementation: `src/renderer/components/Sidebar.tsx`
- Theme system: Uses `useChatStore((s) => s.theme)`
- Aurora theme already uses backdrop-filter as reference implementation
