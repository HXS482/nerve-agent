import simpleGit from 'simple-git'
import { GitStatus, GitBranch, GitCommit } from '../shared/types'

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
}
