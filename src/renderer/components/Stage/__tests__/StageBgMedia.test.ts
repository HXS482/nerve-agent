import { describe, it, expect, vi, afterEach } from 'vitest'
import { htmlFromDataUrl, htmlForIframe, isHtmlBg } from '../StageBgMedia'

function toDataUrl(html: string): string {
  const bytes = new TextEncoder().encode(html)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return 'data:text/html;base64,' + btoa(bin)
}

describe('htmlFromDataUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decodes a base64 data URL back to the original HTML', () => {
    const html = '<html><body><h1>hi</h1></body></html>'
    expect(htmlFromDataUrl(toDataUrl(html))).toBe(html)
  })

  it('preserves multi-byte UTF-8 (Chinese) content', () => {
    const html = '<p>中文标题 · 弧光背景</p>'
    expect(htmlFromDataUrl(toDataUrl(html))).toBe(html)
  })

  it('decodes a percent-encoded (non-base64) data URL', () => {
    expect(htmlFromDataUrl('data:text/html,%3Cp%3Ei%3C%2Fp%3E')).toBe('<p>i</p>')
  })

  it('returns empty string for a non-HTML src', () => {
    expect(htmlFromDataUrl('data:image/png;base64,AAAA')).toBe('')
  })

  it('decodes the payload only once per src, not once per call', () => {
    // The Stage tree re-renders on every stream flush (~25/s) and BgHtml calls
    // this each time. Re-decoding an unchanged ~300KB data URL measured ~4ms
    // per call, so the work has to be cached. Spying on atob is the only
    // reliable probe: V8 interns the decoded string, so reference identity
    // cannot distinguish "cached" from "recomputed".
    const spy = vi.spyOn(globalThis, 'atob')
    const src = toDataUrl('<html><body>' + 'x'.repeat(50_000) + '</body></html>')

    for (let i = 0; i < 5; i++) htmlFromDataUrl(src)

    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('re-decodes after the src changes', () => {
    const spy = vi.spyOn(globalThis, 'atob')
    const a = toDataUrl('<p>A</p>')
    const b = toDataUrl('<p>B</p>')

    htmlFromDataUrl(a)
    htmlFromDataUrl(b)

    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('does not return a stale value when src changes', () => {
    const a = toDataUrl('<p>A</p>')
    const b = toDataUrl('<p>B</p>')
    expect(htmlFromDataUrl(a)).toBe('<p>A</p>')
    expect(htmlFromDataUrl(b)).toBe('<p>B</p>')
    expect(htmlFromDataUrl(a)).toBe('<p>A</p>')
  })
})

describe('htmlForIframe', () => {
  it('disables scrolling inside the iframe document', () => {
    const out = htmlForIframe(toDataUrl('<html><body><p>hi</p></body></html>'))
    expect(out).toContain('overflow:hidden')
  })

  it('keeps the original markup intact', () => {
    const out = htmlForIframe(toDataUrl('<html><body><p>hi</p></body></html>'))
    expect(out).toContain('<p>hi</p>')
  })

  it('injects before </body> so it cannot trigger quirks mode', () => {
    const out = htmlForIframe(toDataUrl('<!DOCTYPE html><html><body>x</body></html>'))
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(out.indexOf('overflow:hidden')).toBeLessThan(out.indexOf('</body>'))
  })

  it('appends when the markup has no </body>', () => {
    const out = htmlForIframe(toDataUrl('<p>fragment</p>'))
    expect(out).toContain('<p>fragment</p>')
    expect(out).toContain('overflow:hidden')
  })

  it('returns empty string for a non-HTML src', () => {
    expect(htmlForIframe('data:image/png;base64,AAAA')).toBe('')
  })
})

describe('isHtmlBg', () => {
  it('detects an HTML data URL', () => {
    expect(isHtmlBg('data:text/html;base64,AAAA')).toBe(true)
  })

  it('detects an .html file URL', () => {
    expect(isHtmlBg('file:///C:/bg/x.html')).toBe(true)
  })

  it('rejects images and video', () => {
    expect(isHtmlBg('data:image/png;base64,AAAA')).toBe(false)
    expect(isHtmlBg('data:video/mp4;base64,AAAA')).toBe(false)
  })
})
