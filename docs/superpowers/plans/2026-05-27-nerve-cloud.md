# NerveCloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the WebGL-based NerveOrb with a lightweight CSS particle cloud that changes color based on agent state.

**Architecture:** Create a new `NerveCloud` component (pure DOM + CSS particle system) that implements the same interface as `NerveOrb`. Swap the import in `App.tsx`. No test needed — pure visual component.

**Tech Stack:** React, CSS `@keyframes`, CSS custom properties

---

### Task 1: Create NerveCloud.tsx

**Files:**

- Create: `src/renderer/components/NerveCloud.tsx`

- [ ] **Step 1: Write component shell with particle generation**

```tsx
import { useMemo, useRef, useEffect, useState } from "react";

export type OrbState = "idle" | "active" | "thinking" | "morphing";

interface Props {
  state?: OrbState;
  theme?: string;
  size?: number;
  className?: string;
}
```

- [ ] **Step 2: Add state → color mapping**

```tsx
const STATE_COLORS: Record<OrbState, string> = {
  idle: "#4A9EFF",
  active: "#6BA3FE",
  thinking: "#22D3EE",
  morphing: "#F97316",
};

const THEME_COLORS: Record<string, string> = {
  dark: "#4A9EFF",
  light: "#3B82F6",
  aurora: "#60A5FA",
};
```

- [ ] **Step 3: Add particle data generator**

```tsx
interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  blur: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  breathMin: number;
  breathMax: number;
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    // Gaussian-like distribution: center-dense
    const theta = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 1.5) * 45; // bias toward center
    return {
      id: i,
      x: 50 + Math.cos(theta) * r,
      y: 50 + Math.sin(theta) * r,
      size: 2 + Math.random() * 4,
      blur: 1 + Math.random() * 2,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -5,
      driftX: 8 + Math.random() * 12,
      driftY: 8 + Math.random() * 12,
      breathMin: 0.6 + Math.random() * 0.2,
      breathMax: 0.9 + Math.random() * 0.3,
    };
  });
}
```

- [ ] **Step 4: Write the component body with keyframes injection**

```tsx
export function NerveCloud({
  state = "idle",
  theme = "dark",
  size = 64,
  className = "",
}: Props) {
  const particles = useMemo(() => generateParticles(80), []);
  const color = STATE_COLORS[state];
  const idleColor = THEME_COLORS[theme] || THEME_COLORS.dark;
  const currentColor = state === "idle" ? idleColor : color;

  // Inject @keyframes once
  useEffect(() => {
    const id = "nerve-cloud-styles";
    if (document.getElementById(id)) return;

    let css = "";
    for (let i = 0; i < 80; i++) {
      const p = generateParticles(1)[0];
      css += `
        @keyframes cloud-drift-${i} {
          0%, 100% { transform: translate(0, 0) scale(${p.breathMin}); }
          25% { transform: translate(${p.driftX}px, ${-p.driftY * 0.5}px) scale(${p.breathMax}); }
          50% { transform: translate(${-p.driftX * 0.7}px, ${p.driftY}px) scale(${p.breathMin}); }
          75% { transform: translate(${p.driftX * 0.5}px, ${-p.driftY}px) scale(${p.breathMax}); }
        }`;
    }

    const style = document.createElement("style");
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        filter: "blur(3px)",
      }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            background: currentColor,
            filter: `blur(${p.blur}px)`,
            animation: `cloud-drift-${p.id} ${p.duration}s ease-in-out ${p.delay}s infinite alternate`,
            transition: "background 0.6s ease",
          }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Review and fix particle generation issue**

The keyframes are generated with random values in the effect, but each particle needs to reference its specific keyframe. Let me fix: instead of generating 80 random keyframe sets in the effect, use a stable set of particle data so the `cloud-drift-{id}` name matches exactly.

Final fix: use the same `particles` array for both keyframe generation and rendering. Move keyframe generation into a separate utility that reads from the same particle data.

```tsx
function buildKeyframes(particles: Particle[]): string {
  return particles
    .map(
      (p) => `
@keyframes cloud-drift-${p.id} {
  0%, 100% { transform: translate(0, 0) scale(${p.breathMin}); }
  25% { transform: translate(${p.driftX}px, ${-p.driftY * 0.5}px) scale(${p.breathMax}); }
  50% { transform: translate(${-p.driftX * 0.7}px, ${p.driftY}px) scale(${p.breathMin}); }
  75% { transform: translate(${p.driftX * 0.5}px, ${-p.driftY}px) scale(${p.breathMax}); }
}`,
    )
    .join("\n");
}
```

- [ ] **Step 6: Write the full component**

```tsx
import { useMemo, useEffect } from "react";

export type OrbState = "idle" | "active" | "thinking" | "morphing";

interface Props {
  state?: OrbState;
  theme?: string;
  size?: number;
  className?: string;
}

const STATE_COLORS: Record<OrbState, string> = {
  idle: "#4A9EFF",
  active: "#6BA3FE",
  thinking: "#22D3EE",
  morphing: "#F97316",
};

const THEME_COLORS: Record<string, string> = {
  dark: "#4A9EFF",
  light: "#3B82F6",
  aurora: "#60A5FA",
};

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  blur: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
  breathMin: number;
  breathMax: number;
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const theta = Math.random() * Math.PI * 2;
    const r = Math.pow(Math.random(), 1.5) * 45;
    return {
      id: i,
      x: 50 + Math.cos(theta) * r,
      y: 50 + Math.sin(theta) * r,
      size: 2 + Math.random() * 4,
      blur: 1 + Math.random() * 2,
      duration: 3 + Math.random() * 5,
      delay: Math.random() * -5,
      driftX: 8 + Math.random() * 12,
      driftY: 8 + Math.random() * 12,
      breathMin: 0.6 + Math.random() * 0.2,
      breathMax: 0.9 + Math.random() * 0.3,
    };
  });
}

function buildKeyframes(particles: Particle[]): string {
  return particles
    .map(
      (p) => `
@keyframes cloud-drift-${p.id} {
  0%, 100% { transform: translate(0, 0) scale(${p.breathMin}); }
  25% { transform: translate(${p.driftX}px, ${-p.driftY * 0.5}px) scale(${p.breathMax}); }
  50% { transform: translate(${-p.driftX * 0.7}px, ${p.driftY}px) scale(${p.breathMin}); }
  75% { transform: translate(${p.driftX * 0.5}px, ${-p.driftY}px) scale(${p.breathMax}); }
}`,
    )
    .join("\n");
}

export function NerveCloud({
  state = "idle",
  theme = "dark",
  size = 64,
  className = "",
}: Props) {
  const particles = useMemo(() => generateParticles(80), []);
  const idleColor = THEME_COLORS[theme] || THEME_COLORS.dark;
  const currentColor = state === "idle" ? idleColor : STATE_COLORS[state];

  useEffect(() => {
    const id = "nerve-cloud-styles";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = buildKeyframes(particles);
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [particles]);

  return (
    <div
      className={className}
      style={{
        position: "relative",
        width: size,
        height: size,
        filter: "blur(3px)",
      }}
    >
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            borderRadius: "50%",
            background: currentColor,
            filter: `blur(${p.blur}px)`,
            animation: `cloud-drift-${p.id} ${p.duration}s ease-in-out ${p.delay}s infinite alternate`,
            transition: "background 0.6s ease",
          }}
        />
      ))}
    </div>
  );
}
```

---

### Task 2: Update App.tsx

**Files:**

- Modify: `src/renderer/App.tsx:12` — change import
- Modify: `src/renderer/App.tsx:120` — change component usage

- [ ] **Step 1: Change import**

```tsx
// Before
import { NerveOrb } from "./components/NerveOrb";
// After
import { NerveCloud } from "./components/NerveCloud";
```

- [ ] **Step 2: Change component usage**

```tsx
// Before
<NerveOrb state={orbState} theme={theme} size={36} />
// After
<NerveCloud state={orbState} theme={theme} size={64} />
```

---

### Task 3: Verify build

- [ ] **Step 1: Run build**

Run: `npm run dev`
Expected: Electron app starts, header shows blue particle cloud, no errors.

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/NerveCloud.tsx src/renderer/App.tsx
git commit -m "feat: replace NerveOrb with CSS particle cloud NerveCloud"
```

---

## Spec Coverage Check

- **Replace orb with particle cloud** → Task 1 (NerveCloud.tsx)
- **Default color blue, idle→blue** → Task 1 (STATE_COLORS.idle = '#4A9EFF')
- **AI replying → cyan** → Task 1 (STATE_COLORS.thinking = '#22D3EE')
- **Subagent running → orange** → Task 1 (STATE_COLORS.morphing = '#F97316')
- **Larger size, same position** → Task 2 (size 64, same location in App.tsx)
- **CSS approach** → Task 1 (pure CSS @keyframes + DOM spans)
