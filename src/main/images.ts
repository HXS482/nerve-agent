import { join, resolve } from 'path'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
import { homedir } from 'os'

const IMAGES_DIR = join(homedir(), '.nerve', 'images')

export interface GalleryImage {
  id: string
  filename: string
  path: string
  size: number
  createdAt: number
  source?: string
}

function ensureDir() {
  if (!existsSync(IMAGES_DIR)) mkdirSync(IMAGES_DIR, { recursive: true })
}

function readMeta(): Record<string, { source?: string; createdAt: number }> {
  const metaPath = join(IMAGES_DIR, 'meta.json')
  if (!existsSync(metaPath)) return {}
  try { return JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { return {} }
}

function writeMeta(meta: Record<string, { source?: string; createdAt: number }>) {
  writeFileSync(join(IMAGES_DIR, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')
}

export function saveImage(filename: string, buffer: Buffer, source?: string): GalleryImage {
  ensureDir()
  const id = filename.replace(/\.[^.]+$/, '') + '-' + Date.now()
  const ext = filename.match(/\.(\w+)$/)?.[1] || 'png'
  const safeName = `${id}.${ext}`
  const filePath = join(IMAGES_DIR, safeName)

  writeFileSync(filePath, buffer)

  const meta = readMeta()
  meta[safeName] = { source, createdAt: Date.now() }
  writeMeta(meta)

  return {
    id: safeName,
    filename: safeName,
    path: filePath,
    size: buffer.length,
    createdAt: Date.now(),
    source,
  }
}

export function listImages(): GalleryImage[] {
  ensureDir()
  const meta = readMeta()
  const files = readdirSync(IMAGES_DIR).filter((f) => /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(f))

  return files
    .map((f) => {
      const filePath = join(IMAGES_DIR, f)
      const stat = statSync(filePath)
      const m = meta[f] || {}
      return {
        id: f,
        filename: f,
        path: filePath,
        size: stat.size,
        createdAt: m.createdAt || stat.mtimeMs,
        source: m.source,
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function deleteImage(filename: string): boolean {
  const filePath = resolve(join(IMAGES_DIR, filename))
  // Path traversal guard
  if (!filePath.startsWith(resolve(IMAGES_DIR))) return false
  if (!existsSync(filePath)) return false
  unlinkSync(filePath)

  const meta = readMeta()
  delete meta[filename]
  writeMeta(meta)
  return true
}

export function getImagePath(filename: string): string | null {
  const filePath = resolve(join(IMAGES_DIR, filename))
  // Path traversal guard
  if (!filePath.startsWith(resolve(IMAGES_DIR))) return null
  return existsSync(filePath) ? filePath : null
}

export function getImagesDir(): string {
  ensureDir()
  return IMAGES_DIR
}
