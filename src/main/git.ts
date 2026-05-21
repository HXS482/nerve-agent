import simpleGit from 'simple-git'
import { GitStatus, GitBranch, GitCommit, GitStashEntry } from '../shared/types'

export class GitService {
  async getStatus(cwd: string): Promise<GitStatus> {
    const git = simpleGit({ baseDir: cwd })
    const status = await git.status()
    return {
      current: status.current ?? '',
      tracking: status.tracking ?? '',
      ahead: status.ahead,
      behind: status.behind,
      files: status.files.map(f => ({ path: f.path, index: f.index, working_dir: f.working_dir })),
      staged: status.staged,
      conflicts: status.conflicted,
      created: status.created,
      deleted: status.deleted,
      modified: status.modified,
      renamed: status.renamed.map(r => (typeof r === 'string' ? r : r.to)),
      not_added: status.not_added,
    }
  }

  async stageFiles(cwd: string, files: string[]): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.add(files)
  }

  async unstageFiles(cwd: string, files: string[]): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.reset(['--', ...files])
  }

  async commit(cwd: string, message: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.commit(message)
  }

  async push(cwd: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.push()
  }

  async pull(cwd: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.pull()
  }

  async getLog(cwd: string, maxCount?: number): Promise<GitCommit[]> {
    const git = simpleGit({ baseDir: cwd })
    const log = await git.log({ maxCount: maxCount ?? 30 })
    return log.all.map(c => ({
      hash: c.hash,
      date: c.date,
      message: c.message,
      author_name: c.author_name,
      author_email: c.author_email,
    }))
  }

  async listBranches(cwd: string): Promise<GitBranch[]> {
    const git = simpleGit({ baseDir: cwd })
    const branches = await git.branch()
    return Object.entries(branches.branches).map(([name, info]) => ({
      name,
      current: info.current,
      commit: info.commit,
      label: info.label,
    }))
  }

  async checkout(cwd: string, branch: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.checkout(branch)
  }

  async checkoutNewBranch(cwd: string, branch: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.checkoutLocalBranch(branch)
  }

  async getDiff(cwd: string, files?: string[], staged?: boolean): Promise<string> {
    const git = simpleGit({ baseDir: cwd })
    if (staged) {
      return git.diff(['--cached', ...(files ?? [])])
    }
    return git.diff(files ?? [])
  }

  async init(cwd: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.init()
  }

  async listStashes(cwd: string): Promise<GitStashEntry[]> {
    const git = simpleGit({ baseDir: cwd })
    const result = await git.stashList({ maxCount: 50 })
    return result.all.map((entry, i) => ({
      hash: entry.hash.slice(0, 7),
      message: entry.message,
      date: entry.date,
      index: i,
    }))
  }

  async stashPush(cwd: string, message?: string, includeUntracked?: boolean): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    const args = ['stash', 'push']
    if (includeUntracked) args.push('-u')
    if (message) args.push('-m', message)
    await git.raw(args)
  }

  async stashPop(cwd: string, index?: number): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    const ref = index != null ? `stash@{${index}}` : undefined
    await git.raw(['stash', 'pop', ...(ref ? [ref] : [])])
  }

  async stashApply(cwd: string, index?: number): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    const ref = index != null ? `stash@{${index}}` : undefined
    await git.raw(['stash', 'apply', ...(ref ? [ref] : [])])
  }

  async stashDrop(cwd: string, index: number): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.raw(['stash', 'drop', `stash@{${index}}`])
  }

  async discardChanges(cwd: string, files: string[], tracked: boolean): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    if (tracked) {
      await git.checkout(['--', ...files])
    } else {
      await git.raw(['clean', '-f', ...files])
    }
  }

  async deleteBranch(cwd: string, branchName: string, force?: boolean): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.deleteLocalBranch(branchName, force)
  }

  async getCommitDiff(cwd: string, hash: string): Promise<string> {
    const git = simpleGit({ baseDir: cwd })
    return git.show([hash])
  }

  async fetch(cwd: string): Promise<void> {
    const git = simpleGit({ baseDir: cwd })
    await git.fetch()
  }
}
