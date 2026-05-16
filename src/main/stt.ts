import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { getNerveSettings } from './settings'

export async function transcribeAudio(audioBuffer: Uint8Array, mimeType: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const settings = await getNerveSettings()
  let sttEndpoint = settings.sttEndpoint
  let sttApiKey = settings.sttApiKey
  let sttModel = settings.sttModel

  if (!sttEndpoint || !sttApiKey) {
    if (!sttEndpoint) sttEndpoint = settings.baseURL.replace(/\/v1$/, '') || 'https://api.xiaomimimo.com'
    if (!sttApiKey) sttApiKey = settings.authToken
  }

  if (!sttApiKey) {
    return { ok: false, error: 'No API key configured. Go to Settings → Voice or Provider to set one up.' }
  }

  let baseUrl = sttEndpoint.replace(/\/+$/, '')
  baseUrl = baseUrl.replace(/\/v1\/?$/, '').replace(/\/anthropic\/?$/, '')
  const url = `${baseUrl}/v1/chat/completions`

  let audioBase64: string
  let audioMimeType = 'audio/wav'

  // Convert to ogg (compressed, small) — proxy only supports mp3/flac/m4a/wav/ogg
  const id = randomUUID()
  const tmpIn = join(tmpdir(), `nerve-stt-${id}.webm`)
  const tmpOut = join(tmpdir(), `nerve-stt-${id}.ogg`)
  try {
    writeFileSync(tmpIn, Buffer.from(audioBuffer))
    execSync(`ffmpeg -y -i "${tmpIn}" -c:a libvorbis -q:a 5 -ar 16000 -ac 1 "${tmpOut}" 2>&1`, { timeout: 10000 })
    const oggBuffer = readFileSync(tmpOut)
    audioBase64 = oggBuffer.toString('base64')
    audioMimeType = 'audio/ogg'
  } catch (err: any) {
    return { ok: false, error: `ffmpeg conversion failed: ${err.message?.slice(0, 200)}` }
  } finally {
    try { unlinkSync(tmpIn) } catch { /* */ }
    try { unlinkSync(tmpOut) } catch { /* */ }
  }

  // Send raw base64 — some APIs reject the data: URL prefix
  const audioData = audioBase64

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': sttApiKey,
        'Authorization': `Bearer ${sttApiKey}`,
      },
      body: JSON.stringify({
        model: sttModel,
        messages: [
          {
            role: 'system',
            content: '你是一个语音转写助手。将用户的语音转写为文字。只输出转写的原文，不要添加任何解释、标点修正或格式。',
          },
          {
            role: 'user',
            content: [
              { type: 'input_audio', input_audio: { data: audioData } },
              { type: 'text', text: '请将这段语音转写为文字，只输出转写内容。' },
            ],
          },
        ],
        max_completion_tokens: 4096,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: `STT HTTP ${res.status}: ${errText.slice(0, 300)}` }
    }

    const data = await res.json() as any
    const text = data?.choices?.[0]?.message?.content?.trim() || ''
    return { ok: true, text }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
