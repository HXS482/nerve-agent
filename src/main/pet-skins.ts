import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, cpSync, rmSync } from 'fs'
import { join, resolve, basename, extname } from 'path'
import { homedir } from 'os'
import { dialog, BrowserWindow } from 'electron'
import {
  PetSkin, PetAnimState, PetdexAnimId,
  PETDEX_STATES, PETDEX_FRAME_W, PETDEX_FRAME_H, PETDEX_IMG_W, PETDEX_IMG_H,
} from '../shared/types'

// Read WebP dimensions from file header
function readWebPDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buf = readFileSync(filePath)
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null

    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8L') {
      const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | (buf[24] << 24)
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 }
    }
    if (chunk === 'VP8 ') {
      return { width: buf[26] | (buf[27] << 8), height: buf[28] | (buf[29] << 8) }
    }
    if (chunk === 'VP8X') {
      return {
        width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
        height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
      }
    }
    return null
  } catch {
    return null
  }
}

// Read PNG dimensions from IHDR chunk
function readPNGDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buf = readFileSync(filePath)
    if (buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19]
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23]
    return { width: w, height: h }
  } catch {
    return null
  }
}

// Petdex pet.json state → our PetdexAnimId
const PETDEX_NAME_TO_ID: Record<string, PetdexAnimId> = {
  'idle': 'idle',
  'run right': 'running-right',
  'running-right': 'running-right',
  'run left': 'running-left',
  'running-left': 'running-left',
  'waving': 'waving',
  'jumping': 'jumping',
  'failed': 'failed',
  'waiting': 'waiting',
  'running': 'running',
  'review': 'review',
}

export class PetSkinManager {
  private skinsDir: string

  constructor() {
    this.skinsDir = join(homedir(), '.nerve', 'pets')
    mkdirSync(this.skinsDir, { recursive: true })
  }

  listSkins(): PetSkin[] {
    const skins: PetSkin[] = []
    const entries = readdirSync(this.skinsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skinDir = join(this.skinsDir, entry.name)
      const jsonPath = join(skinDir, 'skin.json')
      if (!existsSync(jsonPath)) continue

      try {
        const raw = readFileSync(jsonPath, 'utf-8')
        const skin: PetSkin = JSON.parse(raw)
        skin.id = entry.name
        if (skin.spritesheetPath) {
          skin.spritesheetPath = join(skinDir, skin.spritesheetPath)
        }
        skins.push(skin)
      } catch {
        // Skip invalid skins
      }
    }

    return skins
  }

  getSkin(id: string): PetSkin | null {
    const skinDir = resolve(join(this.skinsDir, id))
    if (!skinDir.startsWith(resolve(this.skinsDir))) return null
    const jsonPath = join(skinDir, 'skin.json')
    if (!existsSync(jsonPath)) return null

    try {
      const raw = readFileSync(jsonPath, 'utf-8')
      const skin: PetSkin = JSON.parse(raw)
      skin.id = id
      if (skin.spritesheetPath) {
        skin.spritesheetPath = join(skinDir, skin.spritesheetPath)
      }
      return skin
    } catch {
      return null
    }
  }

  async importSkin(window: BrowserWindow): Promise<PetSkin | null> {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Select pet skin folder',
    })

    if (result.canceled || result.filePaths.length === 0) return null

    const sourceDir = result.filePaths[0]
    const skinJsonPath = join(sourceDir, 'skin.json')
    const petJsonPath = join(sourceDir, 'pet.json')

    if (!existsSync(skinJsonPath) && !existsSync(petJsonPath)) return null

    try {
      const id = basename(sourceDir).toLowerCase().replace(/[^a-z0-9-]/g, '-')
      const destDir = join(this.skinsDir, id)

      if (existsSync(destDir)) {
        rmSync(destDir, { recursive: true, force: true })
      }

      cpSync(sourceDir, destDir, { recursive: true })

      let skin: PetSkin

      if (existsSync(join(destDir, 'skin.json'))) {
        // Native format — read and ensure defaults
        const raw = readFileSync(join(destDir, 'skin.json'), 'utf-8')
        skin = this.normalizeSkin(JSON.parse(raw))
      } else {
        // Petdex format — convert pet.json → skin.json
        skin = this.convertPetJson(destDir, id)
      }

      // Write normalized skin.json
      writeFileSync(join(destDir, 'skin.json'), JSON.stringify(skin, null, 2), 'utf-8')

      skin.id = id
      return skin
    } catch {
      return null
    }
  }

  // Normalize a skin.json: fill missing fields with Petdex defaults
  private normalizeSkin(raw: any): PetSkin {
    return {
      id: raw.id || '',
      displayName: raw.displayName || raw.id || 'Unknown',
      description: raw.description || '',
      spritesheetPath: raw.spritesheetPath,
      frameWidth: raw.frameWidth || PETDEX_FRAME_W,
      frameHeight: raw.frameHeight || PETDEX_FRAME_H,
      imageWidth: raw.imageWidth || PETDEX_IMG_W,
      imageHeight: raw.imageHeight || PETDEX_IMG_H,
      states: raw.states || PETDEX_STATES,
      stateMap: raw.stateMap,
      isDefault: raw.isDefault,
    }
  }

  // Convert Petdex pet.json to our skin.json format
  private convertPetJson(destDir: string, id: string): PetSkin {
    const raw = readFileSync(join(destDir, 'pet.json'), 'utf-8')
    const petJson = JSON.parse(raw)

    // Find spritesheet file
    const spritesheetFile = petJson.spritesheetPath ||
      readdirSync(destDir).find(f => /\.(png|webp|gif|jpg)$/i.test(f)) || ''

    // Read image dimensions
    let frameW = PETDEX_FRAME_W
    let frameH = PETDEX_FRAME_H
    let imgW: number | undefined
    let imgH: number | undefined
    const spritesheetAbs = join(destDir, spritesheetFile)
    if (existsSync(spritesheetAbs)) {
      const ext = extname(spritesheetFile).toLowerCase()
      if (ext === '.webp') {
        const dims = readWebPDimensions(spritesheetAbs)
        if (dims) { imgW = dims.width; imgH = dims.height }
      } else if (ext === '.png') {
        const dims = readPNGDimensions(spritesheetAbs)
        if (dims) { imgW = dims.width; imgH = dims.height }
      }
    }

    // If we got dimensions, derive frame size from Petdex standard grid
    if (imgW && imgH) {
      frameW = Math.floor(imgW / 8)  // 8 columns
      frameH = Math.floor(imgH / 9)  // 9 rows
    }

    // Parse Petdex states from pet.json
    let states: PetAnimState[] = PETDEX_STATES

    if (Array.isArray(petJson.states)) {
      states = petJson.states.map((s: any, idx: number) => {
        const animId = PETDEX_NAME_TO_ID[s.name?.toLowerCase?.()] ||
                       PETDEX_NAME_TO_ID[s.id?.toLowerCase?.()]
        return {
          id: animId || PETDEX_STATES[idx]?.id || 'idle',
          label: s.label || s.name || PETDEX_STATES[idx]?.label || 'Unknown',
          row: s.row ?? idx,
          frames: s.frames ?? 6,
          durationMs: s.durationMs ?? Math.round((s.frames ?? 6) * 150),
        }
      })
    }

    const skin: PetSkin = {
      id,
      displayName: petJson.displayName || id,
      description: petJson.description || '',
      spritesheetPath: spritesheetFile,
      frameWidth: frameW,
      frameHeight: frameH,
      imageWidth: imgW,
      imageHeight: imgH,
      states,
    }

    return skin
  }

  deleteSkin(id: string): boolean {
    const skinDir = resolve(join(this.skinsDir, id))
    // Path traversal guard
    if (!skinDir.startsWith(resolve(this.skinsDir))) return false
    if (!existsSync(skinDir)) return false

    rmSync(skinDir, { recursive: true, force: true })
    return true
  }
}
