/**
 * ClaudeService — Electron 特定的 Agent 服务包装
 *
 * 使用 AgentCore + IPCChannel，保持现有公共 API 不变
 * 所有 BrowserWindow 特定逻辑都在这里，AgentCore 不依赖 Electron
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { IPC_CHANNELS, ClaudeConfig, SendMessagePayload, PetState, SessionUsage, ProviderInfo, ToolApprovalResponse } from '../shared/types'
import { AgentCore } from './core/agent-core'
import { IPCChannel } from './core/ipc-channel'
import { FileSessionStore } from './session-store'
import { loadSettings, NERVE_DIR, ClaudeSettings } from './settings'
import { ProviderRegistry } from './provider-registry'

export { testConnection, fetchModels } from './provider'
export { transcribeAudio } from './stt'
export { getSkills, toggleSkill } from './skills'

export class ClaudeService {
  private core: AgentCore
  private channel: IPCChannel
  private window: BrowserWindow
  private petWindow: BrowserWindow | null = null
  private projectDir: string
  private sourceDir: string
  private settings: ClaudeSettings

  constructor(window: BrowserWindow, projectDir: string) {
    this.window = window
    this.settings = loadSettings()
    this.sourceDir = projectDir
    this.projectDir = this.settings.cwd || projectDir

    // 创建 IPCChannel
    this.channel = new IPCChannel(window)

    // 创建 AgentCore
    this.core = new AgentCore({
      projectDir: this.projectDir,
      sourceDir: this.sourceDir,
      settings: this.settings,
    })

    // 从 settings 初始化 config
    if (this.settings.model) this.core.setModel(this.settings.model)
    if (this.settings.defaultProvider) this.core.setProvider(this.settings.defaultProvider)
  }

  setPetWindow(petWin: BrowserWindow) {
    this.petWindow = petWin
    this.channel.setPetWindow(petWin)
  }

  setMemoryCore(core: any) {
    this.core.setMemoryCore(core)
  }

  setOffloadBridge(bridge: any) {
    this.core.setOffloadBridge(bridge)
  }

  async initPlugins(): Promise<void> {
    return this.core.initPlugins()
  }

  private send(channel: string, data: unknown) {
    if (!this.window.isDestroyed()) {
      this.window.webContents.send(channel, data)
    }
  }

  private sendPetState(state: PetState) {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.webContents.send(IPC_CHANNELS.PET_STATE_CHANGE, state)
    }
  }

  async sendMessage(payload: SendMessagePayload) {
    // 清理之前的流
    this.send(IPC_CHANNELS.STREAM_CLEAR, {})
    this.sendPetState('jumping')

    // 调用 AgentCore
    await this.core.sendMessage(payload, this.channel)
  }

  cancel() {
    this.core.cancel()
    this.sendPetState('idle')
  }

  handleToolApprovalResponse(response: ToolApprovalResponse) {
    this.core.handleToolApprovalResponse(response.approvalId, response.approved)
  }

  setModel(model: string) {
    this.core.setModel(model)
  }

  setProvider(providerId: string) {
    this.core.setProvider(providerId)
  }

  setEffort(effort: ClaudeConfig['effort']) {
    this.core.setEffort(effort)
  }

  async setCwd(cwd: string) {
    await this.core.setCwd(cwd)
    this.projectDir = cwd
  }

  setPermissionMode(mode: ClaudeConfig['permissionMode']) {
    this.core.setPermissionMode(mode)
  }

  setWindow(window: BrowserWindow) {
    this.window = window
    this.channel.setMainWindow(window)
  }

  setPetSkin(id: string) {
    if (this.petWindow && !this.petWindow.isDestroyed()) {
      this.petWindow.webContents.send(IPC_CHANNELS.PET_SKIN_CHANGED, id)
    }
  }

  pushFlowItem(type: string, content: string, meta?: Record<string, any>) {
    this.send(IPC_CHANNELS.FLOW_ITEM, { type, content, meta })
  }

  getConfig(): ClaudeConfig {
    return this.core.getConfig()
  }

  getSettings(): ClaudeSettings {
    return this.core.getSettings()
  }

  getSourceDir(): string {
    return this.core.getSourceDir()
  }

  reloadProvider() {
    this.core.reloadProvider()
  }

  async listSessions() {
    return this.core.listSessions()
  }

  async getSessionMessages(sessionId: string) {
    return this.core.getSessionMessages(sessionId)
  }

  async deleteSession(sessionId: string) {
    return this.core.deleteSession(sessionId)
  }

  async tagSession(sessionId: string, tag: string) {
    return this.core.tagSession(sessionId, tag)
  }

  async branchSession(sessionId: string, fromEntryId: string, branchName?: string) {
    return this.core.branchSession(sessionId, fromEntryId, branchName)
  }

  async switchBranch(sessionId: string, branchName: string) {
    return this.core.switchBranch(sessionId, branchName)
  }

  async listBranches(sessionId: string) {
    return this.core.listBranches(sessionId)
  }

  async getSessionUsage(sessionId: string): Promise<SessionUsage> {
    return this.core.getSessionUsage(sessionId)
  }

  getProviders(): ProviderInfo[] {
    return this.core.getProviders()
  }

  async getUsageStats() {
    return this.core.getUsageStats()
  }

  async close() {
    return this.core.close()
  }

  // Plugins
  getPlugins() { return this.core.getPlugins() }
  togglePlugin(pluginId: string, enabled: boolean) { return this.core.togglePlugin(pluginId, enabled) }
  reloadPlugin(pluginId: string) { return this.core.reloadPlugin(pluginId) }
  rollbackMcp(serverId: string) { return this.core.rollbackMcp(serverId) }
}
