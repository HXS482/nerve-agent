import { useState, useRef, useCallback, useEffect } from 'react'

interface VoiceInputState {
  isRecording: boolean
  isTranscribing: boolean
  error: string | null
  duration: number // seconds
}

interface VoiceInputActions {
  start: () => void
  stop: () => void
  toggle: () => void
}

export function useVoiceInput(onResult: (text: string) => void): VoiceInputState & VoiceInputActions {
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    mediaRecorderRef.current = null
    chunksRef.current = []
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    setError(null)
    setDuration(0)

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Prefer webm/opus, fallback to whatever is available
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : ''

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const actualMime = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: actualMime })

        // Skip if too short (< 0.3s of audio, likely accidental click)
        if (blob.size < 1000) {
          cleanup()
          return
        }

        setIsTranscribing(true)
        try {
          const arrayBuffer = await blob.arrayBuffer()
          const uint8 = new Uint8Array(arrayBuffer)
          const result = await window.claude.transcribeAudio(uint8, actualMime)

          if (result.ok && result.text) {
            onResultRef.current(result.text)
          } else if (result.error) {
            setError(result.error)
          }
        } catch (err: any) {
          setError(err.message || 'Transcription failed')
        } finally {
          setIsTranscribing(false)
          cleanup()
        }
      }

      mediaRecorderRef.current = recorder
      recorder.start(250) // collect data every 250ms
      setIsRecording(true)

      // Duration counter
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1)
      }, 1000)
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Microphone permission denied')
      } else if (err.name === 'NotFoundError') {
        setError('No microphone found')
      } else {
        setError(err.message || 'Failed to access microphone')
      }
    }
  }, [cleanup])

  const stop = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const toggle = useCallback(() => {
    if (isRecording) {
      stop()
    } else {
      start()
    }
  }, [isRecording, start, stop])

  return { isRecording, isTranscribing, error, duration, start, stop, toggle }
}
