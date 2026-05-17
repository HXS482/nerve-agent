import { create } from 'zustand'
import type { GitStatus, GitBranch, GitCommit } from '../../shared/types'

interface GitState {
  status: GitStatus | null
  branches: GitBranch[]
  log: GitCommit[]
  diff: string
  selectedDiffFile: string | null
  loading: boolean
  error: string
  cwd: string

  setCwd: (cwd: string) => void
  setSelectedDiffFile: (file: string | null) => void
  fetchStatus: (cwd?: string) => Promise<void>
  stageFiles: (files: string[], cwd?: string) => Promise<void>
  unstageFiles: (files: string[], cwd?: string) => Promise<void>
  commit: (message: string, cwd?: string) => Promise<void>
  push: (cwd?: string) => Promise<void>
  pull: (cwd?: string) => Promise<void>
  fetchLog: (cwd?: string) => Promise<void>
  fetchBranches: (cwd?: string) => Promise<void>
  checkout: (branch: string, cwd?: string) => Promise<void>
  fetchDiff: (files?: string[], staged?: boolean, cwd?: string) => Promise<void>
  init: (cwd?: string) => Promise<void>
  createBranch: (branch: string, cwd?: string) => Promise<void>
}

export const useGitStore = create<GitState>()((set, get) => ({
  status: null,
  branches: [],
  log: [],
  diff: '',
  selectedDiffFile: null,
  loading: false,
  error: '',
  cwd: '',

  setCwd: (cwd) => set({ cwd }),

  setSelectedDiffFile: (file) => set({ selectedDiffFile: file }),

  fetchStatus: async (cwd) => {
    const dir = cwd ?? get().cwd
    if (!dir) return
    set({ loading: true, error: '' })
    try {
      const res = await (window as any).claude.gitStatus(dir)
      set({ status: res, loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch status', loading: false, status: null })
    }
  },

  stageFiles: async (files, cwd) => {
    const dir = cwd ?? get().cwd
    try {
      set({ error: '' })
      await (window as any).claude.gitStage(files, dir)
      get().fetchStatus(dir)
      get().fetchBranches(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to stage files' })
    }
  },

  unstageFiles: async (files, cwd) => {
    const dir = cwd ?? get().cwd
    try {
      set({ error: '' })
      await (window as any).claude.gitUnstage(files, dir)
      get().fetchStatus(dir)
      get().fetchBranches(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to unstage files' })
    }
  },

  commit: async (message, cwd) => {
    const dir = cwd ?? get().cwd
    try {
      set({ error: '' })
      await (window as any).claude.gitCommit(message, dir)
      get().fetchStatus(dir)
      get().fetchBranches(dir)
      get().fetchLog(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to commit' })
    }
  },

  push: async (cwd) => {
    const dir = cwd ?? get().cwd
    set({ loading: true, error: '' })
    try {
      await (window as any).claude.gitPush(dir)
      set({ loading: false })
      get().fetchStatus(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to push', loading: false })
    }
  },

  pull: async (cwd) => {
    const dir = cwd ?? get().cwd
    set({ loading: true, error: '' })
    try {
      await (window as any).claude.gitPull(dir)
      set({ loading: false })
      get().fetchStatus(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to pull', loading: false })
    }
  },

  fetchLog: async (cwd) => {
    const dir = cwd ?? get().cwd
    if (!dir) return
    try {
      const res = await (window as any).claude.gitLog(dir, 20)
      set({ log: res })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch log' })
    }
  },

  fetchBranches: async (cwd) => {
    const dir = cwd ?? get().cwd
    if (!dir) return
    try {
      const res = await (window as any).claude.gitListBranches(dir)
      set({ branches: res })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch branches' })
    }
  },

  checkout: async (branch, cwd) => {
    const dir = cwd ?? get().cwd
    set({ loading: true, error: '' })
    try {
      await (window as any).claude.gitCheckout(branch, dir)
      set({ loading: false })
      get().fetchStatus(dir)
      get().fetchBranches(dir)
      get().fetchLog(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to checkout branch', loading: false })
    }
  },

  fetchDiff: async (files, staged, cwd) => {
    const dir = cwd ?? get().cwd
    set({ loading: true, error: '', diff: '' })
    try {
      const res = await (window as any).claude.gitDiff(files, dir, staged)
      set({ diff: res, loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch diff', loading: false })
    }
  },

  init: async (cwd) => {
    const dir = cwd ?? get().cwd
    set({ loading: true, error: '' })
    try {
      await (window as any).claude.gitInit(dir)
      set({ loading: false })
      get().fetchStatus(dir)
      get().fetchBranches(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to init repository', loading: false })
    }
  },

  createBranch: async (branch, cwd) => {
    const dir = cwd ?? get().cwd
    try {
      set({ error: '' })
      await (window as any).claude.gitCreateBranch(branch, dir)
      get().fetchBranches(dir)
      get().fetchStatus(dir)
    } catch (err: any) {
      set({ error: err.message || 'Failed to create branch' })
    }
  },
}))
