import { create } from 'zustand'
import type { GitStatus, GitBranch, GitCommit, GitStashEntry } from '../../shared/types'

// IPC wrapper with error handling
const git = {
  status: (dir: string) => (window as any).claude.gitStatus(dir),
  stage: (files: string[], dir: string) => (window as any).claude.gitStage(files, dir),
  unstage: (files: string[], dir: string) => (window as any).claude.gitUnstage(files, dir),
  commit: (msg: string, dir: string) => (window as any).claude.gitCommit(msg, dir),
  push: (dir: string) => (window as any).claude.gitPush(dir),
  pull: (dir: string) => (window as any).claude.gitPull(dir),
  log: (dir: string, n: number) => (window as any).claude.gitLog(dir, n),
  branches: (dir: string) => (window as any).claude.gitListBranches(dir),
  checkout: (branch: string, dir: string) => (window as any).claude.gitCheckout(branch, dir),
  diff: (files: string[] | undefined, dir: string, staged?: boolean) => (window as any).claude.gitDiff(files, dir, staged),
  init: (dir: string) => (window as any).claude.gitInit(dir),
  createBranch: (name: string, dir: string) => (window as any).claude.gitCreateBranch(name, dir),
  stashList: (dir: string) => (window as any).claude.gitStashList(dir),
  stashPush: (dir: string, msg?: string, untracked?: boolean) => (window as any).claude.gitStashPush(dir, msg, untracked),
  stashPop: (dir: string, index?: number) => (window as any).claude.gitStashPop(dir, index),
  stashApply: (dir: string, index?: number) => (window as any).claude.gitStashApply(dir, index),
  stashDrop: (dir: string, index: number) => (window as any).claude.gitStashDrop(dir, index),
  deleteBranch: (dir: string, branch: string, force?: boolean) => (window as any).claude.gitDeleteBranch(dir, branch, force),
  discard: (dir: string, files: string[], tracked: boolean) => (window as any).claude.gitDiscard(dir, files, tracked),
  showDiff: (dir: string, hash: string) => (window as any).claude.gitShowDiff(dir, hash),
  gitFetch: (dir: string) => (window as any).claude.gitFetch(dir),
}

interface GitState {
  status: GitStatus | null
  branches: GitBranch[]
  log: GitCommit[]
  stashes: GitStashEntry[]
  diff: string
  selectedDiffFile: string | null
  commitDiff: string
  selectedCommitHash: string | null
  loading: boolean
  error: string
  cwd: string
  lastRefresh: number

  setCwd: (cwd: string) => void
  setSelectedDiffFile: (file: string | null) => void
  clearError: () => void

  // Fetch operations
  fetchStatus: () => Promise<void>
  fetchBranches: () => Promise<void>
  fetchLog: () => Promise<void>
  fetchStashes: () => Promise<void>
  fetchDiff: (files?: string[], staged?: boolean) => Promise<void>
  fetchCommitDiff: (hash: string) => Promise<void>
  clearCommitDiff: () => void
  refresh: () => Promise<void>

  // Mutations
  stageFiles: (files: string[]) => Promise<void>
  unstageFiles: (files: string[]) => Promise<void>
  commit: (message: string) => Promise<void>
  commitAndPush: (message: string) => Promise<void>
  push: () => Promise<void>
  pull: () => Promise<void>
  fetch: () => Promise<void>
  checkout: (branch: string) => Promise<void>
  init: () => Promise<void>
  createBranch: (name: string) => Promise<void>
  deleteBranch: (branchName: string, force?: boolean) => Promise<void>
  discardChanges: (files: string[], tracked: boolean) => Promise<void>
  stashPush: (message?: string, includeUntracked?: boolean) => Promise<void>
  stashPop: (index?: number) => Promise<void>
  stashApply: (index?: number) => Promise<void>
  stashDrop: (index: number) => Promise<void>
}

export const useGitStore = create<GitState>()((set, get) => ({
  status: null,
  branches: [],
  log: [],
  stashes: [],
  diff: '',
  selectedDiffFile: null,
  commitDiff: '',
  selectedCommitHash: null,
  loading: false,
  error: '',
  cwd: '',
  lastRefresh: 0,

  setCwd: (cwd) => set({ cwd, status: null, branches: [], log: [], stashes: [], commitDiff: '', selectedCommitHash: null }),
  setSelectedDiffFile: (file) => set({ selectedDiffFile: file }),
  clearError: () => set({ error: '' }),

  // === Fetch Operations ===

  fetchStatus: async () => {
    const { cwd } = get()
    if (!cwd) return
    try {
      const status = await git.status(cwd)
      set({ status, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch status' })
    }
  },

  fetchBranches: async () => {
    const { cwd } = get()
    if (!cwd) return
    try {
      const branches = await git.branches(cwd)
      set({ branches, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch branches' })
    }
  },

  fetchLog: async () => {
    const { cwd } = get()
    if (!cwd) return
    try {
      const log = await git.log(cwd, 30)
      set({ log, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch log' })
    }
  },

  fetchStashes: async () => {
    const { cwd } = get()
    if (!cwd) return
    try {
      const stashes = await git.stashList(cwd)
      set({ stashes, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch stashes' })
    }
  },

  fetchDiff: async (files, staged) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, diff: '' })
    try {
      const diff = await git.diff(files, cwd, staged)
      set({ diff, loading: false, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch diff', loading: false })
    }
  },

  fetchCommitDiff: async (hash) => {
    const { cwd } = get()
    if (!cwd) return
    set({ selectedCommitHash: hash, commitDiff: '', loading: true })
    try {
      const diff = await git.showDiff(cwd, hash)
      set({ commitDiff: diff, loading: false, error: '' })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch commit diff', loading: false })
    }
  },

  clearCommitDiff: () => set({ selectedCommitHash: null, commitDiff: '' }),

  refresh: async () => {
    const { cwd, lastRefresh } = get()
    if (!cwd) return
    const now = Date.now()
    if (now - lastRefresh < 1000) return
    set({ lastRefresh: now })
    await Promise.all([
      get().fetchStatus(),
      get().fetchBranches(),
      get().fetchLog(),
      get().fetchStashes(),
    ])
  },

  // === Mutations ===

  stageFiles: async (files) => {
    const { cwd, status } = get()
    if (!cwd || !status) return
    const newStaged = [...new Set([...status.staged, ...files])]
    set({ status: { ...status, staged: newStaged }, error: '' })
    try {
      await git.stage(files, cwd)
      await get().fetchStatus()
    } catch (err: any) {
      set({ error: err.message || 'Failed to stage files' })
      await get().fetchStatus()
    }
  },

  unstageFiles: async (files) => {
    const { cwd, status } = get()
    if (!cwd || !status) return
    const newStaged = status.staged.filter((f) => !files.includes(f))
    set({ status: { ...status, staged: newStaged }, error: '' })
    try {
      await git.unstage(files, cwd)
      await get().fetchStatus()
    } catch (err: any) {
      set({ error: err.message || 'Failed to unstage files' })
      await get().fetchStatus()
    }
  },

  commit: async (message) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.commit(message, cwd)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to commit', loading: false })
    }
  },

  commitAndPush: async (message) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.commit(message, cwd)
      await git.push(cwd)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to commit and push', loading: false })
    }
  },

  push: async () => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.push(cwd)
      await get().fetchStatus()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to push', loading: false })
    }
  },

  pull: async () => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.pull(cwd)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to pull', loading: false })
    }
  },

  fetch: async () => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.gitFetch(cwd)
      await get().fetchStatus()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to fetch', loading: false })
    }
  },

  checkout: async (branch) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.checkout(branch, cwd)
      await get().fetchStatus()
      await get().fetchBranches()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to checkout', loading: false })
    }
  },

  init: async () => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.init(cwd)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to init repository', loading: false })
    }
  },

  createBranch: async (name) => {
    const { cwd } = get()
    if (!cwd) return
    set({ error: '' })
    try {
      await git.createBranch(name, cwd)
      await get().refresh()
    } catch (err: any) {
      set({ error: err.message || 'Failed to create branch' })
    }
  },

  deleteBranch: async (branchName, force) => {
    const { cwd } = get()
    if (!cwd) return
    set({ error: '' })
    try {
      await git.deleteBranch(cwd, branchName, force)
      await get().fetchBranches()
    } catch (err: any) {
      set({ error: err.message || 'Failed to delete branch' })
    }
  },

  discardChanges: async (files, tracked) => {
    const { cwd } = get()
    if (!cwd) return
    set({ error: '' })
    try {
      await git.discard(cwd, files, tracked)
      await get().fetchStatus()
    } catch (err: any) {
      set({ error: err.message || 'Failed to discard changes' })
    }
  },

  stashPush: async (message, includeUntracked) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.stashPush(cwd, message, includeUntracked)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to stash', loading: false })
    }
  },

  stashPop: async (index) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.stashPop(cwd, index)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to pop stash', loading: false })
    }
  },

  stashApply: async (index) => {
    const { cwd } = get()
    if (!cwd) return
    set({ loading: true, error: '' })
    try {
      await git.stashApply(cwd, index)
      await get().refresh()
      set({ loading: false })
    } catch (err: any) {
      set({ error: err.message || 'Failed to apply stash', loading: false })
    }
  },

  stashDrop: async (index) => {
    const { cwd } = get()
    if (!cwd) return
    set({ error: '' })
    try {
      await git.stashDrop(cwd, index)
      await get().fetchStashes()
    } catch (err: any) {
      set({ error: err.message || 'Failed to drop stash' })
    }
  },
}))
