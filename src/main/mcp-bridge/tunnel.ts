import { spawn, type ChildProcess } from 'node:child_process'

export class TunnelManager {
  private process: ChildProcess | null = null
  private tunnelUrl: string | null = null
  private urlResolve: ((url: string) => void) | null = null

  async start(localPort: number): Promise<string> {
    if (this.process && this.tunnelUrl) return this.tunnelUrl

    return new Promise<string>((resolve, reject) => {
      this.urlResolve = resolve

      this.process = spawn('cloudflared', [
        'tunnel', '--url', `http://127.0.0.1:${localPort}`
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      this.process.stderr!.on('data', (chunk: Buffer) => {
        const text = chunk.toString()
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
        if (match && !this.tunnelUrl) {
          this.tunnelUrl = match[0]
          this.urlResolve?.(this.tunnelUrl)
          this.urlResolve = null
        }
      })

      this.process.on('error', (err) => {
        this.process = null
        if (this.urlResolve) {
          this.urlResolve = null
          reject(new Error('cloudflared not found. Install: npm i -g cloudflared'))
        }
      })

      this.process.on('exit', () => {
        this.process = null
        this.tunnelUrl = null
      })

      setTimeout(() => {
        if (this.urlResolve) {
          this.urlResolve = null
          this.process?.kill()
          this.process = null
          reject(new Error('Tunnel startup timed out'))
        }
      }, 30_000)
    })
  }

  stop(): void {
    this.process?.kill()
    this.process = null
    this.tunnelUrl = null
  }

  getUrl(): string | null {
    return this.tunnelUrl
  }

  isRunning(): boolean {
    return this.process !== null
  }
}
