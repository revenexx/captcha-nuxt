// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveLabels } from '../../src/runtime/labels'
import type { AnyCaptchaProvider, CaptchaClientContext, CaptchaWidgetEvents } from '../../src/runtime/types'

/**
 * The hCaptcha and reCAPTCHA clients against stand-ins for their scripts. The
 * module's `ctx.loadScript` is what wraps @nuxt/scripts' `useScript`; here it
 * records the request and installs the fake global the real script would.
 */
type W = Record<string, unknown>
const w = () => window as unknown as W

interface Rendered { el: HTMLElement, params: Record<string, unknown> }

function fakeHcaptcha() {
  const rendered: Rendered[] = []
  const api = {
    render: vi.fn((el: HTMLElement, params: Record<string, unknown>) => {
      rendered.push({ el, params })
      return `hc-${rendered.length}`
    }),
    execute: vi.fn((id: string) => {
      const params = rendered[Number(id.slice(3)) - 1]!.params
      ;(params.callback as (t: string) => void)('P1_token')
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  return { api, rendered }
}

function fakeRecaptcha() {
  const rendered: Rendered[] = []
  let n = 0
  const api = {
    ready: (cb: () => void) => cb(),
    render: vi.fn((el: HTMLElement, params: Record<string, unknown>) => {
      rendered.push({ el, params })
      return rendered.length - 1 // ids start at 0
    }),
    execute: vi.fn((idOrKey: number | string, options?: { action?: string }) => {
      if (typeof idOrKey === 'number') {
        (rendered[idOrKey]!.params.callback as (t: string) => void)('03AF_v2')
        return undefined
      }
      return Promise.resolve(`03AF_v3_${options?.action}_${++n}`)
    }),
    reset: vi.fn(),
  }
  return { api, rendered }
}

/** A stand-in for the module's loadScript (@nuxt/scripts): installs the global, then fires what the real script fires. */
function loader(install: () => void) {
  return vi.fn(async (src: string, options?: { key?: string, use?: () => unknown }) => {
    install()
    if (src.includes('hcaptcha.com')) (w().__rvxCaptchaHcaptchaOnload as () => void)?.()
    if (src.includes('google.com/recaptcha')) {
      const cfg = w().___grecaptcha_cfg as { fns?: Array<() => void> } | undefined
      for (const fn of cfg?.fns ?? []) fn()
    }
    return options?.use?.()
  })
}

function ctx<O>(name: string, options: O, over: Partial<CaptchaClientContext<O>> = {}): CaptchaClientContext<O> {
  return { name, options, action: 'contact', invisible: false, labels: resolveLabels(), loadScript: vi.fn() as never, ...over }
}

const events = (): CaptchaWidgetEvents & Record<string, ReturnType<typeof vi.fn>> => ({ solve: vi.fn(), error: vi.fn(), expire: vi.fn(), progress: vi.fn() })

async function fresh(name: 'hcaptcha' | 'recaptcha'): Promise<AnyCaptchaProvider> {
  vi.resetModules()
  return (await import(`../../src/runtime/providers/${name}.ts`)).default
}

beforeEach(() => {
  for (const key of ['hcaptcha', 'grecaptcha', '___grecaptcha_cfg', '__rvxCaptchaHcaptchaOnload']) Reflect.deleteProperty(w(), key)
  document.getElementById('rvx-captcha-recaptcha-badge')?.remove()
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the hcaptcha client', () => {
  it('loads the explicit script through @nuxt/scripts and waits for its onload [@spec:module-contract:AC-15]', async () => {
    const hcaptcha = await fresh('hcaptcha')
    const fake = fakeHcaptcha()
    const loadScript = loader(() => { w().hcaptcha = fake.api })
    const c = ctx('hcaptcha', { siteKey: 'hc-site', theme: 'dark', language: 'de' }, { loadScript: loadScript as never })
    await hcaptcha.client.load(c)
    const [src, request] = loadScript.mock.calls[0]!
    expect(src.startsWith('https://js.hcaptcha.com/1/api.js?render=explicit')).toBe(true)
    expect(src).toContain('recaptchacompat=off')
    expect(src).toContain('onload=__rvxCaptchaHcaptchaOnload')
    expect(request?.key).toBe('hcaptcha')

    const el = document.createElement('div')
    const e = events()
    const handle = await hcaptcha.client.render(c, el, e)
    expect(fake.rendered[0]!.el).toBe(el)
    expect(fake.rendered[0]!.params).toMatchObject({ sitekey: 'hc-site', size: 'normal', theme: 'dark', hl: 'de' })
    ;(fake.rendered[0]!.params.callback as (t: string) => void)('P1_visible')
    expect(e.solve).toHaveBeenCalledWith('P1_visible')
    ;(fake.rendered[0]!.params['expired-callback'] as () => void)()
    expect(e.expire).toHaveBeenCalledOnce()
    hcaptcha.client.reset(handle, c)
    expect(fake.api.reset).toHaveBeenCalledWith('hc-1')
    hcaptcha.client.destroy!(handle)
    expect(fake.api.remove).toHaveBeenCalledWith('hc-1')
  })

  it('runs invisibly with size invisible and execute [@spec:module-contract:AC-15]', async () => {
    const hcaptcha = await fresh('hcaptcha')
    const fake = fakeHcaptcha()
    const c = ctx('hcaptcha', { siteKey: 'hc-site' }, { invisible: true, loadScript: loader(() => { w().hcaptcha = fake.api }) as never })
    await hcaptcha.client.load(c)
    const e = events()
    const handle = await hcaptcha.client.render(c, document.createElement('div'), e)
    expect(fake.rendered[0]!.params.size).toBe('invisible')
    await hcaptcha.client.execute!(handle, c)
    expect(fake.api.execute).toHaveBeenCalledWith('hc-1')
    expect(e.solve).toHaveBeenCalledWith('P1_token')
    ;(fake.rendered[0]!.params['close-callback'] as () => void)()
    expect(e.error).toHaveBeenCalledOnce()
  })

  it('fails to load without a site key or when the script is blocked, so the fallback can run [@spec:module-contract:AC-14]', async () => {
    const hcaptcha = await fresh('hcaptcha')
    await expect(hcaptcha.client.load(ctx('hcaptcha', { siteKey: '' }))).rejects.toThrow(/siteKey is required/)
    const blocked = vi.fn(async () => { throw new Error('blocked') })
    await expect(hcaptcha.client.load(ctx('hcaptcha', { siteKey: 'k' }, { loadScript: blocked as never }))).rejects.toThrow('blocked')
    const fake = fakeHcaptcha()
    await expect(hcaptcha.client.load(ctx('hcaptcha', { siteKey: 'k' }, { loadScript: loader(() => { w().hcaptcha = fake.api }) as never }))).resolves.toBeUndefined()
  })
})

describe('the recaptcha v2 client', () => {
  it('loads api.js?render=explicit through @nuxt/scripts and renders the checkbox [@spec:module-contract:AC-16]', async () => {
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const loadScript = loader(() => { w().grecaptcha = fake.api })
    const c = ctx('recaptcha', { siteKey: '6Lv2', theme: 'dark' as const }, { loadScript: loadScript as never })
    await recaptcha.client.load(c)
    expect(loadScript.mock.calls[0]![0]).toBe('https://www.google.com/recaptcha/api.js?render=explicit')
    expect(loadScript.mock.calls[0]![1]?.key).toBe('google-recaptcha')

    const el = document.createElement('div')
    const e = events()
    const handle = await recaptcha.client.render(c, el, e)
    expect(el.contains(fake.rendered[0]!.el)).toBe(true)
    expect(fake.rendered[0]!.params).toMatchObject({ sitekey: '6Lv2', size: 'normal', theme: 'dark' })
    expect(fake.rendered[0]!.params.badge).toBeUndefined()
    expect(el.querySelector('[data-captcha-recaptcha-notice]')).toBeNull()
    ;(fake.rendered[0]!.params.callback as (t: string) => void)('03AF_click')
    expect(e.solve).toHaveBeenCalledWith('03AF_click')
    recaptcha.client.reset(handle, c)
    expect(fake.api.reset).toHaveBeenCalledWith(0)
    recaptcha.client.destroy!(handle)
    expect(el.childElementCount).toBe(0)
  })

  it('runs invisibly with size invisible and execute(widgetId), widget id 0 included [@spec:module-contract:AC-16]', async () => {
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const c = ctx('recaptcha', { siteKey: '6Lv2', badge: 'bottomleft' as const }, { invisible: true, loadScript: loader(() => { w().grecaptcha = fake.api }) as never })
    await recaptcha.client.load(c)
    const e = events()
    const handle = await recaptcha.client.render(c, document.createElement('div'), e)
    expect(fake.rendered[0]!.params).toMatchObject({ size: 'invisible', badge: 'bottomleft' })
    await recaptcha.client.execute!(handle, c)
    expect(fake.api.execute).toHaveBeenCalledWith(0)
    expect(e.solve).toHaveBeenCalledWith('03AF_v2')
  })

  it('shows the reCAPTCHA notice when the invisible badge is hidden [@spec:module-contract:AC-18]', async () => {
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const c = ctx('recaptcha', { siteKey: '6Lv2', hideBadge: true }, { invisible: true, loadScript: loader(() => { w().grecaptcha = fake.api }) as never })
    await recaptcha.client.load(c)
    expect(document.getElementById('rvx-captcha-recaptcha-badge')!.textContent).toBe('.grecaptcha-badge { visibility: hidden; }')
    const el = document.createElement('div')
    await recaptcha.client.render(c, el, events())
    expect(el.querySelector('[data-captcha-recaptcha-notice]')!.textContent).toBe('Diese Website ist durch reCAPTCHA geschützt.')
  })
})

describe('the recaptcha v3 client', () => {
  const v3 = { siteKey: '6Lv3', version: 'v3' as const }

  it('loads api.js?render=<siteKey> and executes with the action [@spec:module-contract:AC-16]', async () => {
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const loadScript = loader(() => { w().grecaptcha = fake.api })
    const c = ctx('recaptcha', { ...v3, language: 'de' }, { invisible: true, loadScript: loadScript as never })
    await recaptcha.client.load(c)
    expect(loadScript.mock.calls[0]![0]).toBe('https://www.google.com/recaptcha/api.js?render=6Lv3&hl=de')
    expect(loadScript.mock.calls[0]![1]?.key).toBe('google-recaptcha-v3')
    const handle = await recaptcha.client.render(c, document.createElement('div'), events())
    expect(fake.api.render).not.toHaveBeenCalled()
    await expect(recaptcha.client.execute!(handle, c)).resolves.toBe('03AF_v3_contact_1')
    expect(fake.api.execute).toHaveBeenCalledWith('6Lv3', { action: 'contact' })
  })

  it('renders no box, only the reCAPTCHA notice, and keeps a fresh token on the page [@spec:module-contract:AC-18]', async () => {
    vi.useFakeTimers()
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const c = ctx('recaptcha', v3, { loadScript: loader(() => { w().grecaptcha = fake.api }) as never })
    await recaptcha.client.load(c)
    expect(document.getElementById('rvx-captcha-recaptcha-badge')).toBeNull()
    const el = document.createElement('div')
    const e = events()
    const handle = await recaptcha.client.render(c, el, e)
    expect(el.children).toHaveLength(1)
    expect(el.querySelector('p[data-captcha-recaptcha-notice]')!.textContent).toBe('Diese Website ist durch reCAPTCHA geschützt.')
    await vi.advanceTimersByTimeAsync(0)
    expect(e.solve).toHaveBeenLastCalledWith('03AF_v3_contact_1')
    await vi.advanceTimersByTimeAsync(90_000)
    expect(e.solve).toHaveBeenLastCalledWith('03AF_v3_contact_2')
    recaptcha.client.destroy!(handle)
    await vi.advanceTimersByTimeAsync(200_000)
    expect(e.solve).toHaveBeenCalledTimes(2)
    expect(el.childElementCount).toBe(0)
  })

  it('reports an invisible token as expired after its lifetime, and shows no notice in useCaptcha\'s container [@spec:module-contract:AC-18]', async () => {
    vi.useFakeTimers()
    const recaptcha = await fresh('recaptcha')
    const fake = fakeRecaptcha()
    const c = ctx('recaptcha', v3, { invisible: true, loadScript: loader(() => { w().grecaptcha = fake.api }) as never })
    await recaptcha.client.load(c)
    const headless = document.createElement('div')
    headless.setAttribute('data-captcha-headless', '')
    const e = events()
    const handle = await recaptcha.client.render(c, headless, e)
    expect(headless.childElementCount).toBe(0)
    expect(fake.api.execute).not.toHaveBeenCalled()
    await recaptcha.client.execute!(handle, c)
    await vi.advanceTimersByTimeAsync(110_000)
    expect(e.expire).toHaveBeenCalledOnce()
  })
})
