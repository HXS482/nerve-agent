import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AgentCore } from '../../core/agent-core'

describe('AgentCore config cwd', () => {
  it('使用 settings.cwd 作为 config.cwd', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'nerve-config-project-'))
    const settingsDir = mkdtempSync(join(tmpdir(), 'nerve-config-settings-'))

    try {
      const core = new AgentCore({
        projectDir,
        sourceDir: projectDir,
        settings: { cwd: settingsDir } as any,
      })

      expect(core.getConfig().cwd).toBe(settingsDir)
    } finally {
      rmSync(projectDir, { recursive: true, force: true })
      rmSync(settingsDir, { recursive: true, force: true })
    }
  })
})
