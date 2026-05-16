import { useState, useEffect, useMemo } from 'react'
import { useChatStore } from '../stores/chatStore'
import {
  PetSkin, PetState, PetdexAnimId, PetAnimState,
  DEFAULT_STATE_MAP, PETDEX_STATES,
  PETDEX_FRAME_W, PETDEX_FRAME_H, PETDEX_IMG_W, PETDEX_IMG_H,
} from '../../shared/types'

// Default pixel art constants
const PX = 6
const COLS = 16
const ROWS = 16

// Color palettes for default skin
export type ColorScheme = 'purple' | 'blue' | 'green' | 'pink' | 'orange'

export const COLOR_SCHEMES: Record<ColorScheme, { name: string; B: string; b: string; L: string; o: string; P: string }> = {
  purple: { name: 'Purple', B: '#1a1a2e', b: '#2d2d5e', L: '#4a4a8a', o: '#3a3a6a', P: '#ff6b9d' },
  blue:   { name: 'Blue',   B: '#0f1a2e', b: '#1a3a6e', L: '#3a6aaa', o: '#2a4a7a', P: '#ff8faa' },
  green:  { name: 'Green',  B: '#0a1e0a', b: '#1a3e1a', L: '#3a7a3a', o: '#2a5a2a', P: '#ff6b9d' },
  pink:   { name: 'Pink',   B: '#2e1a2e', b: '#5e2d5e', L: '#8a4a8a', o: '#6a3a6a', P: '#ffaa57' },
  orange: { name: 'Orange', B: '#2e1a0a', b: '#5e3a1a', L: '#8a5a3a', o: '#6a4a2a', P: '#ff6b9d' },
}

const DEFAULT_SCHEME: ColorScheme = 'purple'

function buildPalette(scheme: ColorScheme) {
  const s = COLOR_SCHEMES[scheme]
  return {
    _: 'transparent',
    B: s.B,
    b: s.b,
    L: s.L,
    W: '#ffffff',
    K: '#111111',
    P: s.P,
    R: '#ff4444',
    Y: '#ffdd57',
    G: '#27C93F',
    o: s.o,
  }
}

// --- Default pixel art frames (our 6 behavioral states) ---

type Frame = string[][]

const idleFrames: Frame[] = [
  [
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
    '______oBBo______',
    '________________',
  ],
  [
    '________________',
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
    '______oBBo______',
  ],
]

const workingFrames: Frame[] = [
  [
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '__oo_oBBBBo_oo__',
    '__oBo_oBBo_oBo__',
    '__oo___oo___oo__',
    '________________',
  ],
  [
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '___oo_oBBBo_oo__',
    '___oBo_oBo_oBo__',
    '___oo__oo___oo__',
    '________________',
  ],
]

const thinkingFrames: Frame[] = [
  [
    '___o___________',
    '__oWo__________',
    '_oWWWo_____o___',
    '__oWWo_____oWo__',
    '___o______oWo__',
    '____oooooo_o___',
    '___oBBBBBBo____',
    '__oBbBBbBBbBo__',
    '__oBbBBbBBbBo__',
    '__oBBWBKWBBBo__',
    '__oBBWBKWBBBo__',
    '__oBBBPPPPBBBo_',
    '__oBBBBBBBBBBo_',
    '___oBbBBBBbBo__',
    '___oBbLLLLbBo__',
    '____ooBbBBoo___',
  ],
  [
    '________________',
    '___o____________',
    '__oWo______o___',
    '_oWWWo____oWo__',
    '__oWWo____oWo__',
    '___o______o____',
    '____oooooo_____',
    '___oBBBBBBo____',
    '__oBbBBbBBbBo__',
    '__oBbBBbBBbBo__',
    '__oBBWBKWBBBo__',
    '__oBBWBKWBBBo__',
    '__oBBBPPPPBBBo_',
    '__oBBBBBBBBBBo_',
    '___oBbBBBBbBo__',
    '___oBbLLLLbBo__',
  ],
]

const happyFrames: Frame[] = [
  [
    '________________',
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBWKKWBBBo___',
    '__oBBWKKWBBBo___',
    '___oBBPPBBBo____',
    '___oBBBbBBBo____',
    '____ooBbBBoo____',
    '__oBo_oBBBBo_oB_',
    '__oo___oBBo__oo_',
    '_______oo______',
    '________________',
  ],
  [
    '____Y___Y_______',
    '_____Y_Y________',
    '______Y_________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBWKKWBBBo___',
    '__oBBWKKWBBBo___',
    '___oBBPPBBBo____',
    '___oBBBbBBBo____',
    '____ooBbBBoo____',
    '___oo_oBBBo_oo__',
    '___oBo_oBo_oBo__',
    '___oo__oo___oo__',
    '________________',
  ],
]

const errorFrames: Frame[] = [
  [
    '________________',
    '________________',
    '____oooooo______',
    '___oRRRRRRo_____',
    '__oRrRRrRRrRo___',
    '__oRrRRrRRrRo___',
    '__oRRRWKRWRRO___',
    '__oRRRWKRWRRO___',
    '__oRRRPPPRRRO___',
    '__oRRRRRRRRRO___',
    '___oRrRRRRrRo___',
    '___oRrLLLLrRo___',
    '____ooRrRRoo____',
    '_____oRRRRo_____',
    '______oRRo______',
    '________________',
  ],
  [
    '________________',
    '________________',
    '_____oooooo_____',
    '____oRRRRRRo____',
    '___oRrRRrRRrRo__',
    '___oRrRRrRRrRo__',
    '___oRRRWKRWRRO__',
    '___oRRRWKRWRRO__',
    '___oRRRPPPRRRO__',
    '___oRRRRRRRRRO__',
    '____oRrRRRRrRo__',
    '____oRrLLLLrRo__',
    '_____ooRrRRoo___',
    '______oRRRRo____',
    '_______oRRo_____',
    '________________',
  ],
]

const sleepingFrames: Frame[] = [
  [
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBoBoBBBo___',
    '__oBBBoBoBBBo___',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
    '______oBBo______',
    '________________',
  ],
  [
    '____________o___',
    '___________oW___',
    '__________oWWo__',
    '___________oWo__',
    '____oooooo__o___',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBoBoBBBo___',
    '__oBBBoBoBBBo___',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
  ],
]

const jumpingFrames: Frame[] = [
  [
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '__oo_oBbLLBo_oo_',
    '__oBo_oBBBBo_oB_',
    '__oo___oBBo__oo_',
    '_______oo______',
    '________________',
    '________________',
  ],
  [
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '__oBo_oBBBBo_oB_',
    '__oo___oBBo__oo_',
    '_______oo______',
    '________________',
    '________________',
  ],
]

const waitingFrames: Frame[] = [
  [
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBWBKWBBBo__',
    '__oBBWBKWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
    '______oBBo______',
    '________________',
  ],
  [
    '________________',
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '_____oBBBBo_____',
    '______oBBo______',
    '________________',
  ],
]

const runningLeftFrames: Frame[] = [
  [
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '__oo_oBBBBo_oo__',
    '__oBo_oBBo_oBo__',
    '__oo___oo___oo__',
    '________________',
  ],
  [
    '________________',
    '____oooooo______',
    '___oBBBBBBo_____',
    '__oBbBBbBBbBo___',
    '__oBbBBbBBbBo___',
    '__oBBBWKBWBBBo__',
    '__oBBBWKBWBBBo__',
    '__oBBBPPPPBBBo__',
    '__oBBBBBBBBBBo__',
    '___oBbBBBBbBo___',
    '___oBbLLLLbBo___',
    '____ooBbBBoo____',
    '___oo_oBBBo_oo__',
    '___oBo_oBo_oBo__',
    '___oo__oo___oo__',
    '________________',
  ],
]

export const defaultStateFrames: Record<PetState, Frame[]> = {
  idle: idleFrames,
  working: workingFrames,
  'running-left': runningLeftFrames,
  thinking: thinkingFrames,
  happy: happyFrames,
  error: errorFrames,
  sleeping: sleepingFrames,
  jumping: jumpingFrames,
  waiting: waitingFrames,
}

const defaultStateSpeeds: Record<PetState, number> = {
  idle: 800,
  working: 300,
  'running-left': 300,
  thinking: 600,
  happy: 400,
  error: 150,
  sleeping: 1200,
  jumping: 250,
  waiting: 900,
}

function renderPixelFrame(frame: Frame, scheme: ColorScheme) {
  const C = buildPalette(scheme)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, ${PX}px)`,
        gridTemplateRows: `repeat(${ROWS}, ${PX}px)`,
        width: COLS * PX,
        height: ROWS * PX,
      }}
    >
      {frame.map((row, y) =>
        row.split('').map((ch, x) => (
          <div
            key={`${y}-${x}`}
            style={{
              width: PX,
              height: PX,
              backgroundColor: C[ch as keyof typeof C] || 'transparent',
            }}
          />
        ))
      )}
    </div>
  )
}

// --- CSS steps() sprite renderer (Petdex standard) ---

function getAnimForState(state: PetState, skin: PetSkin): PetAnimState {
  const animId = skin.stateMap?.[state] || DEFAULT_STATE_MAP[state]
  const found = skin.states.find((s) => s.id === animId)
  return found || skin.states[0] || PETDEX_STATES[0]
}

function PetSpriteSheet({ state, skin }: { state: PetState; skin: PetSkin }) {
  const anim = useMemo(() => getAnimForState(state, skin), [state, skin])
  const frameW = skin.frameWidth || PETDEX_FRAME_W
  const frameH = skin.frameHeight || PETDEX_FRAME_H
  const imgW = skin.imageWidth || PETDEX_IMG_W
  const imgH = skin.imageHeight || PETDEX_IMG_H

  // Use custom protocol to bypass Electron file:// restrictions
  const spritesheetUrl = skin.spritesheetPath
    ? `pet-sprite://${skin.id}/${skin.spritesheetPath.split(/[\\/]/).pop()}`
    : ''

  const animationClass =
    state === 'happy' ? 'pet-bounce' :
    state === 'error' ? 'pet-shake' :
    state === 'idle' ? 'pet-float' :
    ''

  return (
    <div className={animationClass} style={{ imageRendering: 'pixelated' }} data-pet-sprite>
      <div
        className="pet-sprite"
        style={{
          '--sprite-url': `url(${spritesheetUrl})`,
          '--sprite-row': anim.row,
          '--sprite-frames': anim.frames,
          '--sprite-duration': `${anim.durationMs}ms`,
          '--frame-w': `${frameW}px`,
          '--frame-h': `${frameH}px`,
          '--img-w': `${imgW}px`,
          '--img-h': `${imgH}px`,
        } as React.CSSProperties}
      />
      <style>{`
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
        .pet-float { animation: pet-float 2s ease-in-out infinite; }
        .pet-bounce { animation: pet-bounce 0.6s ease-in-out; }
        .pet-shake { animation: pet-shake 0.4s ease-in-out; }
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
      `}</style>
    </div>
  )
}

// --- Default pixel art renderer ---

function DefaultPixelArt({ state, scheme }: { state: PetState; scheme: ColorScheme }) {
  const [frameIdx, setFrameIdx] = useState(0)
  const frames = defaultStateFrames[state]
  const speed = defaultStateSpeeds[state]

  useEffect(() => {
    setFrameIdx(0)
    const timer = setInterval(() => {
      setFrameIdx((i) => (i + 1) % frames.length)
    }, speed)
    return () => clearInterval(timer)
  }, [state, speed, frames.length])

  const animationClass =
    state === 'happy' ? 'pet-bounce' :
    state === 'error' ? 'pet-shake' :
    state === 'jumping' ? 'pet-bounce' :
    state === 'idle' ? 'pet-float' :
    ''

  return (
    <div className={animationClass} style={{ imageRendering: 'pixelated' }} data-pet-sprite>
      {renderPixelFrame(frames[frameIdx], scheme)}
    </div>
  )
}

// --- Main component ---

interface Props {
  state: PetState
  colorScheme?: ColorScheme
}

export function PetPixelArt({ state, colorScheme }: Props) {
  const scheme = colorScheme || DEFAULT_SCHEME
  const petSkinId = useChatStore((s) => s.petSkinId)
  const [skinData, setSkinData] = useState<PetSkin | null>(null)

  useEffect(() => {
    if (petSkinId === 'default') {
      setSkinData(null)
      return
    }
    window.claude.listPetSkins().then((skins: PetSkin[]) => {
      const found = skins.find((s) => s.id === petSkinId)
      setSkinData(found || null)
    }).catch(() => setSkinData(null))
  }, [petSkinId])

  // Custom skin with spritesheet → CSS steps() animation
  if (skinData && skinData.spritesheetPath && skinData.id !== 'default') {
    return <PetSpriteSheet state={state} skin={skinData} />
  }

  // Default pixel art
  return <DefaultPixelArt state={state} scheme={scheme} />
}
