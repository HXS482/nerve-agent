import { useState, useEffect, useRef, useCallback } from 'react'
import { PetPixelArt, ColorScheme, defaultStateFrames } from './PetPixelArt'
import { useChatStore } from '../stores/chatStore'

type PetState = 'idle' | 'working' | 'thinking' | 'happy' | 'error' | 'sleeping'

declare global {
  interface Window {
    claude: {
      onPetStateChange: (callback: (state: string) => void) => () => void
      petDragStart: (mouseX: number, mouseY: number) => void
      petDragMove: (screenX: number, screenY: number) => void
      petDragEnd: (screenX: number, screenY: number) => void
      onPetStatus: (callback: (status: { visible: boolean; docked: boolean }) => void) => () => void
      onPetColorScheme: (callback: (scheme: string) => void) => () => void
      onPetSkinChanged: (callback: (skinId: string) => void) => () => void
      petSetShape: (rects: { x: number; y: number; width: number; height: number }[]) => void
    }
  }
}

const SLEEP_TIMEOUT = 5 * 60 * 1000 // 5 minutes
const STATE_RESET_DELAY = 3000 // 3 seconds for one-shot states before returning to idle

const stateLabels: Record<PetState, string> = {
  idle: 'Idle',
  working: 'Running...',
  'running-left': 'Tooling...',
  thinking: 'Reviewing...',
  happy: 'Done!',
  error: 'Oops!',
  sleeping: 'Zzz...',
  jumping: 'Let\'s go!',
  waiting: 'Waiting...',
}

export function PetView() {
  const petColorScheme = useChatStore((s) => s.petColorScheme)
  const setPetColorScheme = useChatStore((s) => s.setPetColorScheme)
  const petSkinId = useChatStore((s) => s.petSkinId)
  const setPetSkinId = useChatStore((s) => s.setPetSkinId)
  const theme = useChatStore((s) => s.theme)
  const [petState, setPetState] = useState<PetState>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActivity = useRef(Date.now())

  // Make pet window background fully transparent
  useEffect(() => {
    // Mark this as the pet window so CSS can target it specifically
    document.documentElement.setAttribute('data-pet-window', '')
    document.documentElement.setAttribute('data-theme', 'dark')
    document.title = ''

    // Force transparent on all layers — override Tailwind Preflight + CSS
    const css = 'background: transparent !important; margin: 0; padding: 0; border-radius: 0 !important; overflow: hidden !important;'
    document.documentElement.style.cssText = css
    document.body.style.cssText = css
    const root = document.getElementById('root')
    if (root) {
      root.style.cssText = css + ' height: 100vh; display: flex;'
    }

    return () => {}
  }, [])

  // Compute window shape from sprite alpha to clip transparent areas
  const PX = 6
  const CSS_SCALE = 0.72

  const computeDefaultShape = useCallback((state: string) => {
    const frames = defaultStateFrames[state as keyof typeof defaultStateFrames]
    if (!frames) return []
    const frame = frames[0]
    const cellSize = PX * CSS_SCALE

    const spriteEl = document.querySelector('[data-pet-sprite]')
    if (!spriteEl) return []
    const r = spriteEl.getBoundingClientRect()

    const rects: { x: number; y: number; width: number; height: number }[] = []
    for (let row = 0; row < frame.length; row++) {
      let start = -1
      for (let col = 0; col < frame[row].length; col++) {
        if (frame[row][col] !== '_') {
          if (start === -1) start = col
        } else if (start !== -1) {
          rects.push({
            x: Math.round(r.left + start * cellSize),
            y: Math.round(r.top + row * cellSize),
            width: Math.ceil((col - start) * cellSize),
            height: Math.ceil(cellSize),
          })
          start = -1
        }
      }
      if (start !== -1) {
        rects.push({
          x: Math.round(r.left + start * cellSize),
          y: Math.round(r.top + row * cellSize),
          width: Math.ceil((frame[row].length - start) * cellSize),
          height: Math.ceil(cellSize),
        })
      }
    }
    return rects
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      let rects: { x: number; y: number; width: number; height: number }[] = []
      if (petSkinId === 'default') {
        rects = computeDefaultShape(petState)
      } else {
        const spriteEl = document.querySelector('[data-pet-sprite]')
        if (spriteEl) {
          const r = spriteEl.getBoundingClientRect()
          rects = [{ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }]
        }
      }
      // Also include the status label area so it's not clipped
      const labelEl = document.querySelector('[data-pet-label]')
      if (labelEl) {
        const lr = labelEl.getBoundingClientRect()
        rects.push({ x: Math.round(lr.left), y: Math.round(lr.top), width: Math.round(lr.width), height: Math.round(lr.height) })
      }
      if (rects.length > 0) window.claude.petSetShape(rects)
    }, 150)
    return () => clearTimeout(timer)
  }, [petState, petSkinId, computeDefaultShape])

  // Reset sleep timer
  const resetSleepTimer = useCallback(() => {
    lastActivity.current = Date.now()
    if (sleepTimer.current) clearTimeout(sleepTimer.current)
    sleepTimer.current = setTimeout(() => {
      setPetState((prev) => {
        if (prev === 'idle') return 'sleeping'
        return prev
      })
    }, SLEEP_TIMEOUT)
  }, [])

  // States that cancel sleep timer (active work)
  const activeStates = new Set<PetState>(['working', 'running-left', 'thinking', 'jumping', 'waiting'])
  // States that auto-reset to idle after a delay (one-shot reactions)
  const oneShotStates = new Set<PetState>(['happy', 'error', 'jumping'])

  // Listen for state changes from main process
  useEffect(() => {
    const unsub = window.claude.onPetStateChange((state: string) => {
      const validState = state as PetState

      if (stateResetTimer.current) {
        clearTimeout(stateResetTimer.current)
        stateResetTimer.current = null
      }

      setPetState(validState)

      if (activeStates.has(validState)) {
        if (sleepTimer.current) clearTimeout(sleepTimer.current)
      }

      if (oneShotStates.has(validState)) {
        stateResetTimer.current = setTimeout(() => {
          setPetState('idle')
          resetSleepTimer()
        }, STATE_RESET_DELAY)
      } else if (validState === 'idle') {
        resetSleepTimer()
      }
    })

    resetSleepTimer()

    return () => {
      unsub()
      if (sleepTimer.current) clearTimeout(sleepTimer.current)
      if (stateResetTimer.current) clearTimeout(stateResetTimer.current)
    }
  }, [resetSleepTimer])

  // Handle pet status (dock/visibility)
  useEffect(() => {
    const unsub = window.claude.onPetStatus(({ docked }: { visible: boolean; docked: boolean }) => {
      if (docked) {
        // Pet is docked, this window will be hidden by main process
      }
    })
    return unsub
  }, [])

  // Sync color scheme from main window
  useEffect(() => {
    const unsub = window.claude.onPetColorScheme((scheme: string) => {
      setPetColorScheme(scheme)
    })
    return unsub
  }, [setPetColorScheme])

  // Sync skin from main window
  useEffect(() => {
    const unsub = window.claude.onPetSkinChanged((skinId: string) => {
      setPetSkinId(skinId)
    })
    return unsub
  }, [setPetSkinId])

  // Drag handling
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true)
    window.claude.petDragStart(e.screenX, e.screenY)

    const handleMouseMove = (ev: MouseEvent) => {
      window.claude.petDragMove(ev.screenX, ev.screenY)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      window.claude.petDragEnd()
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }, [])

  // Wake up from sleeping on click
  const handleClick = useCallback(() => {
    if (petState === 'sleeping') {
      setPetState('idle')
      resetSleepTimer()
    }
  }, [petState, resetSleepTimer])

  return (
    <div
      className="h-screen w-screen flex flex-col items-center justify-center select-none"
      style={{ background: 'transparent', cursor: isDragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      {/* Pet character */}
      <div style={{ transform: 'scale(0.72)' }}>
        <PetPixelArt state={petState} colorScheme={petColorScheme as ColorScheme} />
      </div>

      {/* Status label */}
      <div
        className="text-center"
        data-pet-label
        style={{
          marginTop: '-22px',
          fontSize: '10px',
          fontFamily: '"Cascadia Code", monospace',
          color: petState === 'error' ? '#ff4444' :
                 petState === 'happy' ? '#27C93F' :
                 petState === 'sleeping' ? '#666' :
                 '#aaa',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          letterSpacing: '0.5px',
        }}
      >
        {stateLabels[petState]}
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes pet-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes pet-bounce {
          0%, 100% { transform: translateY(0) scale(1); }
          25% { transform: translateY(-12px) scale(1.05); }
          50% { transform: translateY(0) scale(0.98); }
          75% { transform: translateY(-6px) scale(1.02); }
        }
        @keyframes pet-shake {
          0%, 100% { transform: translateX(0); }
          10% { transform: translateX(-3px); }
          20% { transform: translateX(3px); }
          30% { transform: translateX(-3px); }
          40% { transform: translateX(3px); }
          50% { transform: translateX(-2px); }
          60% { transform: translateX(2px); }
          70% { transform: translateX(-1px); }
          80% { transform: translateX(1px); }
        }
        .pet-float { animation: pet-float 2s ease-in-out infinite; }
        .pet-bounce { animation: pet-bounce 0.6s ease-in-out; }
        .pet-shake { animation: pet-shake 0.4s ease-in-out; }

        /* Petdex standard spritesheet animation (CSS steps) */
        .pet-sprite {
          --frame-w: 192px;
          --frame-h: 208px;
          --img-w: 1536px;
          --img-h: 1872px;
          --sprite-row: 0;
          --sprite-frames: 6;
          --sprite-duration: 1100ms;
          --sprite-y: calc(var(--sprite-row) * var(--frame-h) * -1);
          --sprite-end-x: calc(var(--sprite-frames) * var(--frame-w) * -1);
          width: var(--frame-w);
          height: var(--frame-h);
          background-image: var(--sprite-url);
          background-repeat: no-repeat;
          background-size: var(--img-w) var(--img-h);
          image-rendering: pixelated;
          animation: pet-sprite-anim var(--sprite-duration) steps(var(--sprite-frames)) infinite;
        }
        @keyframes pet-sprite-anim {
          from { background-position: 0 var(--sprite-y); }
          to   { background-position: var(--sprite-end-x) var(--sprite-y); }
        }
        @media (prefers-reduced-motion: reduce) {
          .pet-sprite { animation: none; }
        }
      `}</style>
    </div>
  )
}
