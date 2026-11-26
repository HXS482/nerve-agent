import { getNerveSettings } from './settings'

/**
 * 语音转写：走 OpenAI Whisper 兼容的 `/v1/audio/transcriptions`（multipart 上传）。
 *
 * 早先的实现是把 webm 用 ffmpeg 转成 ogg，再塞进 chat/completions 的 `input_audio`。
 * 那条路有两个死结：
 *   1. 强依赖外部 ffmpeg 二进制 —— 用户机器没装就直接失败，打包也带不上；
 *   2. 让对话模型兼职转写，模型得支持音频输入才行，错的模型只会瞎编或报错。
 * 现在直接走标准转写端点：webm/opus 本身就是 Whisper 支持的容器，不用转码，
 * 也不需要服务端是某个特定厂商的对话模型。
 */

/** 音频容器 → 扩展名。转写端点靠文件名后缀判断格式，MIME 只是辅助 */
const AUDIO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
}

function normalizeMime(mimeType: string): string {
  return (mimeType || '').split(';')[0].trim().toLowerCase()
}

export async function transcribeAudio(
  audioBuffer: Uint8Array,
  mimeType: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const settings = await getNerveSettings()

  let sttEndpoint = settings.sttEndpoint
  let sttApiKey = settings.sttApiKey
  const sttModel = settings.sttModel || 'whisper-1'

  // 没单独配语音端点就复用「当前 provider」的地址与 key —— 同一个 OpenAI 兼容网关
  // 通常对话和转写都提供。注意不能回落到 settings.baseURL：那是旧的 ANTHROPIC_BASE_URL
  // （如 https://api.kimi.com/coding/），它只服务对话，打转写端点必然 404
  if (!sttEndpoint || !sttApiKey) {
    const activeId = settings.defaultProvider
    const active = activeId ? settings.providers?.[activeId] : undefined
    if (active) {
      if (!sttEndpoint) sttEndpoint = active.baseURL || ''
      if (!sttApiKey) sttApiKey = active.authToken || ''
    }
  }

  if (!sttApiKey) {
    return { ok: false, error: 'No API key configured. Set one in Settings → Voice.' }
  }
  if (!sttEndpoint) {
    return { ok: false, error: 'No STT endpoint configured. Set one in Settings → Voice.' }
  }

  const mime = normalizeMime(mimeType) || 'audio/webm'
  const ext = AUDIO_EXT[mime]
  if (!ext) {
    return { ok: false, error: `Unsupported audio format: ${mimeType || 'unknown'}` }
  }

  // 归一化：去掉末尾斜杠与 /v1、/anthropic 尾巴，再拼标准转写路径。
  // 用户如果已经把完整路径填进来了，就直接用，不再二次拼接
  let base = sttEndpoint.trim().replace(/\/+$/, '')
  const url = /\/audio\/transcriptions$/.test(base)
    ? base
    : `${base.replace(/\/v1$/, '').replace(/\/anthropic$/, '')}/v1/audio/transcriptions`

  const form = new FormData()
  // 必须给 filename：多数实现在没有文件名时会拒收，或退回猜测容器
  // Buffer.from 兜一层：Node 的 Uint8Array 泛型是 ArrayBufferLike，BlobPart 只认 ArrayBuffer
  form.append('file', new Blob([Buffer.from(audioBuffer)], { type: mime }), `audio.${ext}`)
  form.append('model', sttModel)

  try {
    const res = await fetch(url, {
      method: 'POST',
      // Content-Type 交给 fetch 自己写：它要带上 multipart 的 boundary，手写会破坏请求体
      headers: { Authorization: `Bearer ${sttApiKey}` },
      body: form,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const detail = errText.slice(0, 300) || res.statusText
      if (res.status === 404) {
        return {
          ok: false,
          error: `STT endpoint not found (404) at ${url}. 这个地址可能没有提供 /v1/audio/transcriptions —— 检查 Settings → Voice 的 Endpoint 是否指向支持 Whisper 的服务。`,
        }
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `STT auth failed (${res.status}). 检查 Settings → Voice 的 API key。` }
      }
      return { ok: false, error: `STT HTTP ${res.status}: ${detail}` }
    }

    // 正常返回 JSON 的 { text }；个别实现按纯文本回，一并兜住
    const raw = await res.text()
    let text = ''
    try {
      const data = JSON.parse(raw) as { text?: string }
      text = (data?.text || '').trim()
    } catch {
      text = raw.trim()
    }

    return { ok: true, text }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
