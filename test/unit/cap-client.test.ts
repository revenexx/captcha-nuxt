// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { resolveLabels } from '../../src/runtime/labels'
import type { CaptchaClientContext, CaptchaWidgetEvents } from '../../src/runtime/types'

/**
 * A stand-in for @cap.js/widget with the shape of its programmatic mode: the
 * constructor appends a hidden <cap-widget> whose shadow root holds Cap's
 * credits link, as the real one does.
 */
const created: Array<{ config: Record<string, unknown>, widget: HTMLElement }> = []
const wasmAtImport: Array<string | undefined> = []
vi.mock('@cap.js/widget', () => {
  wasmAtImport.push((window as unknown as { CAP_CUSTOM_WASM_URL?: string }).CAP_CUSTOM_WASM_URL)
  class Cap {
    widget: HTMLElement
    private listeners: Record<string, Array<(e: CustomEvent) => void>> = {}
    constructor(public config: Record<string, unknown>) {
      this.widget = document.createElement('cap-widget')
      const shadow = this.widget.attachShadow({ mode: 'open' })
      shadow.innerHTML = '<div class="captcha"><a class="credits" href="https://trycap.dev">Cap</a><a class="cap-troubleshoot-link" hidden></a></div>'
      this.widget.style.display = 'none'
      document.documentElement.appendChild(this.widget)
      created.push({ config, widget: this.widget })
    }

    addEventListener(type: string, listener: (e: CustomEvent) => void) {
      (this.listeners[type] ||= []).push(listener)
    }

    async solve() {
      for (const l of this.listeners.progress ?? []) l(new CustomEvent('progress', { detail: { progress: 50 } }))
      return { success: true, token: 'site1:tok:sig' }
    }

    emit(type: string) {
      for (const l of this.listeners[type] ?? []) l(new CustomEvent(type))
    }

    reset() {}
  }
  return { default: Cap }
})

const { default: revenexx } = await import('../../src/runtime/providers/revenexx')

function ctx(): CaptchaClientContext<{ endpoint: string, siteKey: string }> {
  return { name: 'revenexx', options: { endpoint: 'https://captcha.example.com/', siteKey: 'site1' }, invisible: false, labels: resolveLabels(), loadScript: vi.fn() }
}

describe('the cap client', () => {
  it('points Cap at the instance\'s own wasm before importing it, and solves programmatically [@spec:module-contract:AC-11]', async () => {
    const c = ctx()
    await revenexx.client.load(c)
    expect(wasmAtImport[0]).toBe('https://captcha.example.com/assets/cap_wasm_bg.wasm')
    const w = window as unknown as Record<string, unknown>
    expect(w.CAP_CUSTOM_HASHWX_URL).toBe('https://captcha.example.com/assets/hashwx.wasm')

    const events: CaptchaWidgetEvents = { solve: vi.fn(), error: vi.fn(), expire: vi.fn(), progress: vi.fn() }
    const handle = await revenexx.client.render(c, document.createElement('div'), events)
    const raw = await revenexx.client.execute!(handle, c)
    expect(raw).toBe('site1:tok:sig')
    expect(created[0]!.config).toEqual({ apiEndpoint: 'https://captcha.example.com/site1/' })
    expect(events.progress).toHaveBeenCalledWith(50)
  })

  it('leaves no Cap or trycap.dev link in the DOM [@spec:module-contract:AC-11]', () => {
    const widget = created[0]!.widget
    expect(widget.isConnected).toBe(true)
    expect(widget.style.display).toBe('none')
    expect(widget.shadowRoot!.querySelectorAll('a')).toHaveLength(0)
    expect(widget.shadowRoot!.innerHTML).not.toContain('trycap.dev')
  })

  it('reports Cap\'s reset after a solve as expiry and removes the host on reset', async () => {
    const c = ctx()
    const events: CaptchaWidgetEvents = { solve: vi.fn(), error: vi.fn(), expire: vi.fn(), progress: vi.fn() }
    const handle = await revenexx.client.render(c, document.createElement('div'), events)
    await revenexx.client.execute!(handle, c)
    const cap = (handle as unknown as { cap: { emit: (t: string) => void, widget: HTMLElement } }).cap
    cap.emit('reset')
    expect(events.expire).toHaveBeenCalledOnce()
    revenexx.client.reset(handle, c)
    expect(cap.widget.isConnected).toBe(false)
  })

  it('refuses to load without endpoint or site key', async () => {
    await expect(revenexx.client.load({ ...ctx(), options: { endpoint: '', siteKey: 'x' } })).rejects.toThrow(/endpoint and siteKey/)
  })
})
