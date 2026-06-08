import { join, dirname, basename } from 'path'
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod'
import { zodToInputSchema } from './tool-schema'
import { estimateTokens } from './core/token-estimator'
import { saveImage, getImagesDir } from './images'
import simpleGit from 'simple-git'

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])
const ARTIFACT_EXTS = new Set(['.html', '.htm'])

function isImageFile(filePath: string): boolean {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? IMAGE_EXTS.has(ext) : false
}

function isArtifact(filePath: string): boolean {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? ARTIFACT_EXTS.has(ext) : false
}

function getArtifactPath(fp: string, projectDir: string): string {
  const artifactsDir = join(projectDir, '.nerve', 'artifacts')
  if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true })
  return join(artifactsDir, basename(fp))
}

function moveToGallery(filePath: string, source?: string): { moved: boolean; galleryPath?: string; error?: string } {
  try {
    if (!existsSync(filePath)) return { moved: false, error: 'File not found' }
    const st = statSync(filePath)
    if (st.size === 0) return { moved: false, error: 'File is empty' }
    const buffer = readFileSync(filePath)
    const name = basename(filePath)
    const saved = saveImage(name, buffer, source || name)
    // Remove original after successful save
    try { unlinkSync(filePath) } catch { /* ignore */ }
    return { moved: true, galleryPath: saved.path }
  } catch (err: any) {
    return { moved: false, error: err.message }
  }
}

const execFileAsync = promisify(execFile)

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', '.next',
  '.venv', 'venv', '__pycache__', '.idea', '.vscode',
  'coverage', '.nyc_output', '.cache', '.turbo', '.nx',
  'out', 'target', '.gradle', 'build',
])

function matchGlob(pattern: string, filePath: string): boolean {
  // Step 1: Extract brace alternatives before any escaping
  const alternatives: string[][] = []
  let processed = pattern.replace(/\{([^}]+)\}/g, (_, opts) => {
    const idx = alternatives.length
    alternatives.push(opts.split(','))
    return `\x00ALT${idx}\x00`
  })

  // Step 2: Escape regex special characters in literal parts
  processed = processed.replace(/[.+^${}()|[\]\\]/g, '\\$&')

  // Step 3: Replace glob wildcards with regex
  processed = processed
    .replace(/\*\*/g, '\x00GLOBSTAR\x00')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\x00GLOBSTAR\x00/g, '.*')

  // Step 4: Restore brace groups with individually-escaped alternatives
  processed = processed.replace(/\x00ALT(\d+)\x00/g, (_, idx) => {
    const opts = alternatives[parseInt(idx)]
    return `(${opts.map(o => o.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('|')})`
  })

  const regex = new RegExp(`^${processed}$`)
  return regex.test(filePath)
}

export function getBuiltinTools(cwd: string, gitNotify?: { refresh: () => void }, projectDir?: string, skillRegistry?: import('./skill-registry').SkillRegistry): Record<string, { description: string; input_schema: Record<string, unknown>; execute: (args: any) => Promise<any> }> {
  const effectiveCwd = existsSync(cwd) ? cwd : homedir()
  const artifactRoot = projectDir && existsSync(projectDir) ? projectDir : effectiveCwd

  const bashSchema = z.object({
    command: z.string().describe('The bash command to execute'),
  })
  const writeSchema = z.object({
    file_path: z.string().describe('Absolute path to the file'),
    content: z.string().describe('Content to write'),
  })
  const readSchema = z.object({
    file_path: z.string().describe('Absolute path to the file'),
  })
  const editSchema = z.object({
    file_path: z.string().describe('Absolute path to the file'),
    old_string: z.string().describe('Exact string to find and replace'),
    new_string: z.string().describe('Replacement string'),
  })
  const globSchema = z.object({
    pattern: z.string().describe('Glob pattern (e.g. "**/*.ts")'),
    path: z.string().optional().describe('Directory to search in (defaults to cwd)'),
  })
  const grepSchema = z.object({
    pattern: z.string().describe('Regex pattern to search for'),
    path: z.string().optional().describe('File or directory to search in'),
    glob: z.string().optional().describe('Glob filter for files (e.g. "*.ts")'),
  })
  const generateImageSchema = z.object({
    prompt: z.string().describe('Detailed description of the image to generate'),
    size: z.enum(['1024x1024', '1024x1792', '1792x1024']).optional().describe('Image size (default: 1024x1024)'),
    quality: z.enum(['standard', 'hd']).optional().describe('Image quality (default: standard)'),
  })
  const moveImageSchema = z.object({
    file_path: z.string().describe('Absolute path to the image file to move'),
    source: z.string().optional().describe('Description of where the image came from'),
  })

  return {
    Bash: {
      description: 'Execute a bash command and return its output. Use this for running shell commands, creating directories, installing packages, etc. Image files (.png, .jpg, etc.) created in the working directory are automatically moved to the internal gallery.',
      input_schema: zodToInputSchema(bashSchema),
      execute: async ({ command }: { command: string }) => {
        const psExe = 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'

        // Snapshot existing image/artifact files before execution
        const beforeImages = new Set<string>()
        const beforeArtifacts = new Set<string>()
        try {
          for (const f of readdirSync(effectiveCwd)) {
            if (isImageFile(f)) beforeImages.add(f)
            if (isArtifact(f)) beforeArtifacts.add(f)
          }
        } catch { /* ignore */ }

        try {
          const { stdout, stderr } = await execFileAsync(psExe, ['-NoProfile', '-Command', command], {
            cwd: effectiveCwd,
            encoding: 'utf-8',
            timeout: 120000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              SystemRoot: 'C:\\WINDOWS',
              windir: 'C:\\WINDOWS',
              PATH: `C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0;${process.env.PATH || ''}`,
            },
          })
          const out = (stdout || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          const err = (stderr || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
          const output = (out + (err ? '\n' + err : '')).slice(0, 10000) || '(no output)'

          // Scan for new image files after execution
          const movedImages: string[] = []
          const scanDirs = [effectiveCwd, join(homedir(), 'Desktop')]
          const seen = new Set<string>()
          for (const dir of scanDirs) {
            try {
              for (const f of readdirSync(dir)) {
                if (!isImageFile(f) || seen.has(f)) continue
                seen.add(f)
                const fullPath = join(dir, f)
                // For Desktop: only grab files created in the last 60s
                if (dir !== effectiveCwd) {
                  try {
                    const age = Date.now() - statSync(fullPath).birthtimeMs
                    if (age > 60000) continue
                  } catch { continue }
                }
                if (dir === effectiveCwd && beforeImages.has(f)) continue
                const result = moveToGallery(fullPath, `Bash output: ${f}`)
                if (result.moved && result.galleryPath) {
                  movedImages.push(result.galleryPath)
                }
              }
            } catch { /* ignore scan errors for this dir */ }
          }

          // Scan for new artifact files (HTML etc.) and move to .nerve/artifacts/
          const movedArtifacts: string[] = []
          try {
            for (const f of readdirSync(effectiveCwd)) {
              if (!isArtifact(f) || beforeArtifacts.has(f)) continue
              const fullPath = join(effectiveCwd, f)
              const destPath = getArtifactPath(f, artifactRoot)
              try {
                writeFileSync(destPath, readFileSync(fullPath))
                unlinkSync(fullPath)
                movedArtifacts.push(destPath)
              } catch { /* ignore */ }
            }
          } catch { /* ignore */ }

          const saved: string[] = []
          if (movedImages.length > 0) saved.push(`${movedImages.length} image(s) to gallery`)
          if (movedArtifacts.length > 0) saved.push(`${movedArtifacts.length} artifact(s) to .nerve/artifacts/`)
          if (saved.length > 0) {
            return { output: output + `\n\n[Auto-saved ${saved.join(', ')}]`, savedImages: movedImages, savedArtifacts: movedArtifacts }
          }

          return { output, ...(err ? { error: err } : {}) }
        } catch (err: any) {
          if (err.killed) return { error: 'Command timed out (120s)' }
          const out = (err.stdout || '').replace(/\r\n/g, '\n')
          const er = (err.stderr || err.message || '').replace(/\r\n/g, '\n')
          const output = (out + (er ? '\n' : '') + er).slice(0, 10000)
          return { error: output || `Process exited with code ${err.code}` }
        }
      },
    },
    Write: {
      description: 'Write content to a file. Creates parent directories if needed. For image files (.png, .jpg, etc.), the file is automatically saved to the internal gallery. HTML files are saved to .nerve/artifacts/.',
      input_schema: zodToInputSchema(writeSchema),
      execute: async (args: any) => {
        try {
          let fp = args.file_path || args.filePath || args.path
          const content = args.content

          // Auto-intercept: artifact files → .nerve/artifacts/
          if (isArtifact(fp)) {
            fp = getArtifactPath(fp, artifactRoot)
          }

          const dir = dirname(fp)
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
          writeFileSync(fp, content, 'utf-8')

          // Auto-intercept: if it's an image file, move to gallery
          if (isImageFile(fp)) {
            const result = moveToGallery(fp, `Written by agent: ${basename(fp)}`)
            if (result.moved) {
              return { success: true, file_path: result.galleryPath, savedTo: 'gallery', note: 'Image automatically saved to gallery' }
            }
          }

          return { success: true, file_path: fp }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Write failed' }
        }
      },
    },
    Read: {
      description: 'Read the contents of a file.',
      input_schema: zodToInputSchema(readSchema),
      execute: async (args: any) => {
        try {
          const fp = args.file_path || args.filePath || args.path
          const content = readFileSync(fp, 'utf-8')
          return { content: content.slice(0, 50000) }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Read failed' }
        }
      },
    },
    Edit: {
      description: 'Edit a file by replacing old_string with new_string.',
      input_schema: zodToInputSchema(editSchema),
      execute: async (args: any) => {
        try {
          const fp = args.file_path || args.filePath || args.path
          const old_string = args.old_string || args.oldString
          const new_string = args.new_string || args.newString
          let content = readFileSync(fp, 'utf-8')
          if (!content.includes(old_string)) {
            return { error: `old_string not found in ${fp}` }
          }
          content = content.split(old_string).join(new_string)
          writeFileSync(fp, content, 'utf-8')
          return { success: true, file_path: fp }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Edit failed' }
        }
      },
    },
    Glob: {
      description: 'Find files matching a glob pattern.',
      input_schema: zodToInputSchema(globSchema),
      execute: async ({ pattern, path: searchPath }: { pattern: string; path?: string }) => {
        try {
          const dir = searchPath || cwd
          const files: string[] = []

          function scan(d: string) {
            if (files.length >= 200) return
            let entries: any[]
            try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
            for (const e of entries) {
              if (files.length >= 200) return
              const full = join(d, e.name)
              if (e.isDirectory()) {
                if (!SKIP_DIRS.has(e.name)) scan(full)
              } else if (e.isFile()) {
                const rel = full.slice(dir.length + 1).replace(/\\/g, '/')
                if (matchGlob(pattern, rel)) files.push(full)
              }
            }
          }
          scan(dir)
          return { files }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Glob failed' }
        }
      },
    },
    Grep: {
      description: 'Search for a regex pattern in file contents.',
      input_schema: zodToInputSchema(grepSchema),
      execute: async ({ pattern, path: searchPath, glob: globFilter }: { pattern: string; path?: string; glob?: string }) => {
        try {
          const dir = searchPath || cwd
          const regex = new RegExp(pattern, 'i')
          const results: Array<{ file: string; line: number; text: string }> = []

          function scan(d: string) {
            if (results.length >= 100) return
            let entries: any[]
            try { entries = readdirSync(d, { withFileTypes: true }) } catch { return }
            for (const e of entries) {
              if (results.length >= 100) return
              const full = join(d, e.name)
              if (e.isDirectory()) {
                if (SKIP_DIRS.has(e.name)) continue
                scan(full)
              } else if (e.isFile()) {
                if (globFilter && !e.name.match(new RegExp(globFilter.replace(/\*/g, '.*')))) continue
                try {
                  const st = statSync(full)
                  if (st.size > 512 * 1024) continue
                  const lines = readFileSync(full, 'utf-8').split('\n')
                  for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                      results.push({ file: full, line: i + 1, text: lines[i].slice(0, 200) })
                      if (results.length >= 100) break
                    }
                  }
                } catch { /* skip binary files */ }
              }
            }
          }
          scan(dir)
          return { results }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Grep failed' }
        }
      },
    },
    GenerateImage: {
      description: 'Generate an image from a text prompt using SiliconFlow API (Kwai-Kolors). Saves to .nerve/gallery/. Requires SILICONFLOW_API_KEY in settings.',
      input_schema: zodToInputSchema(generateImageSchema),
      execute: async ({ prompt, size = '1024x1024' }: { prompt: string; size?: string; quality?: string }) => {
        try {
          const apiKey = process.env.SILICONFLOW_API_KEY
          if (!apiKey) {
            return { error: 'SILICONFLOW_API_KEY not configured. Add it to ~/.nerve/settings.json env section.' }
          }

          // Map DALL-E sizes to SiliconFlow sizes
          const sizeMap: Record<string, string> = {
            '1024x1024': '1024x1024',
            '1024x1792': '960x1280',
            '1792x1024': '768x1024',
          }
          const imageSize = sizeMap[size] || '1024x1024'

          const res = await fetch('https://api.siliconflow.cn/v1/images/generations', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'Kwai-Kolors/Kolors',
              prompt,
              negative_prompt: 'blurry, bad anatomy, deformed, extra limbs, low quality, watermark, text',
              image_size: imageSize,
              num_inference_steps: 25,
              guidance_scale: 7.5,
            }),
          })

          if (!res.ok) {
            const body = await res.text().catch(() => '')
            return { error: `SiliconFlow API error ${res.status}: ${body.slice(0, 300)}` }
          }

          const json = await res.json() as any
          const imageUrl = json?.data?.[0]?.url
          if (!imageUrl) {
            return { error: 'No image URL in SiliconFlow response' }
          }

          // Download image
          const imgRes = await fetch(imageUrl)
          if (!imgRes.ok) {
            return { error: `Image download failed: ${imgRes.status}` }
          }

          const arrayBuffer = await imgRes.arrayBuffer()
          const buffer = Buffer.from(arrayBuffer)
          const filename = `gen-${Date.now()}.png`
          const saved = saveImage(filename, buffer, prompt)

          return { path: saved.path, filename: saved.filename, prompt, savedTo: 'gallery' }
        } catch (err: any) {
          return { error: `Image generation failed: ${(err.message || 'unknown').slice(0, 500)}` }
        }
      },
    },
    moveImageToGallery: {
      description: 'Move an image file from any location (e.g. Desktop) to the internal gallery. Use after saving an image via Bash/Write if it was not auto-captured.',
      input_schema: zodToInputSchema(moveImageSchema),
      execute: async ({ file_path, source }: { file_path: string; source?: string }) => {
        const result = moveToGallery(file_path, source)
        if (result.moved) {
          return { success: true, galleryPath: result.galleryPath, message: `Moved to gallery: ${result.galleryPath}` }
        }
        return { error: result.error || 'Failed to move image' }
      },
    },
    GitStageAll: {
      description: 'Stage all changes (git add -A) in the current repository. Call this before commit.',
      input_schema: zodToInputSchema(z.object({})),
      execute: async () => {
        try {
          const git = simpleGit({ baseDir: effectiveCwd })
          await git.add('.')
          gitNotify?.refresh()
          return { success: true, message: 'All changes staged.' }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Stage failed' }
        }
      },
    },
    GitCommit: {
      description: 'Stage all changes, commit, pull --rebase, then push. Single operation — use this for all commits to avoid sync issues.',
      input_schema: zodToInputSchema(z.object({
        message: z.string().describe('Commit message'),
      })),
      execute: async ({ message }: { message: string }) => {
        try {
          const git = simpleGit({ baseDir: effectiveCwd })
          const steps: string[] = []
          const warnings: string[] = []

          // 1. Stage all
          await git.add('.')
          steps.push('staged')

          // 2. Commit
          const statusBefore = await git.status()
          if (statusBefore.staged.length === 0 && statusBefore.created.length === 0 && statusBefore.modified.length === 0 && statusBefore.not_added.length === 0 && statusBefore.deleted.length === 0 && statusBefore.renamed.length === 0) {
            return { success: true, message: 'Nothing to commit — working tree clean.' }
          }
          await git.commit(message)
          steps.push('committed')

          // 3. Pull --rebase (safe: skip if no remote)
          try {
            const remotes = await git.getRemotes()
            if (remotes.length > 0) {
              await git.pull(['--rebase'])
              steps.push('synced')
            } else {
              warnings.push('no remote configured, skipped sync')
            }
          } catch (pullErr: any) {
            const msg = pullErr?.message || ''
            if (msg.includes('merge')) {
              // Rebase conflict — abort rebase, user needs to resolve manually
              await git.raw(['rebase', '--abort']).catch(() => {})
              warnings.push('pull --rebase conflict, manual resolution needed')
            } else {
              warnings.push(`pull skipped: ${msg.slice(0, 120)}`)
            }
          }

          // 4. Push (only if we have a remote and pull succeeded)
          const hasRemote = (await git.getRemotes()).length > 0
          if (hasRemote && !warnings.some(w => w.includes('conflict'))) {
            try {
              await git.push()
              steps.push('pushed')
            } catch (pushErr: any) {
              const msg = pushErr?.message || ''
              if (msg.includes('rejected')) {
                warnings.push('push rejected — remote diverged, force push needed')
              } else {
                warnings.push(`push skipped: ${msg.slice(0, 120)}`)
              }
            }
          }

          gitNotify?.refresh()
          const result = `Committed: ${message} [${steps.join(' → ')}]`
          if (warnings.length > 0) {
            return { success: true, message: result, warnings, error: warnings.join('; ') }
          }
          return { success: true, message: result }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Commit failed' }
        }
      },
    },
    GitPull: {
      description: 'Pull latest changes from the remote tracking branch (pull --rebase).',
      input_schema: zodToInputSchema(z.object({})),
      execute: async () => {
        try {
          const git = simpleGit({ baseDir: effectiveCwd })
          await git.pull(['--rebase'])
          gitNotify?.refresh()
          return { success: true, message: 'Pulled from remote with rebase.' }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Pull failed' }
        }
      },
    },
    GitInit: {
      description: 'Initialize a git repository in the current directory.',
      input_schema: zodToInputSchema(z.object({})),
      execute: async () => {
        try {
          const git = simpleGit({ baseDir: effectiveCwd })
          await git.init()
          gitNotify?.refresh()
          return { success: true, message: 'Git repository initialized.' }
        } catch (err: any) {
          return { error: err.message?.slice(0, 2000) || 'Init failed' }
        }
      },
    },

    // load_skill — on-demand skill loading (two-layer model)
    ...(skillRegistry ? (() => {
      const loadSkillSchema = z.object({
        skill_name: z.string().describe('Name of the skill to load'),
      })
      return {
        load_skill: {
          description: `Load a skill by name to access its full instructions. Available skills: ${skillRegistry.listNames().join(', ')}. Only load when the skill is relevant to the current task.`,
          input_schema: zodToInputSchema(loadSkillSchema),
          execute: async (args: { skill_name: string }) => {
            const skill = skillRegistry.get(args.skill_name)
            if (!skill) {
              return { error: `Skill "${args.skill_name}" not found. Available: ${skillRegistry.listNames().join(', ')}` }
            }
            const prompt = skillRegistry.resolvePrompt(skill)
            const promptTokens = estimateTokens(prompt)
            return {
              skill_name: skill.name,
              description: skill.description,
              content: prompt,
              tokens: promptTokens,
            }
          },
        },
      }
    })() : {}),
  }
}
