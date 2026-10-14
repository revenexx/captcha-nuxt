// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import RevenexxCaptcha from '../../src/runtime/components/RevenexxCaptcha.vue'
import { CAPTCHA_RUNTIME, selectProvider } from '../../src/runtime/controller'
import type { CaptchaRuntime } from '../../src/runtime/controller'
import { useCaptcha } from '../../src/runtime/composables/useCaptcha'
import { defineCaptchaProvider } from '../../src/runtime/define'
import test from '../../src/runtime/providers/test'
import none from '../../src/runtime/providers/none'
import type { AnyCaptchaProvider, CaptchaConsentSeam, CaptchaPublicConfig, CaptchaWidgetEvents } from '../../src/runtime/types'

/** An own-UI provider whose solve the test controls. */
function controllable(name = 'own') {
  let finish: ((token: string) => void) | null = null
  let failWith: ((error: unknown) => void) | null = null
  let events: CaptchaWidgetEvents | null = null
  const provider = defineCaptchaProvider<Record<string, unknown>, null>({
    name,
    meta: { consent: 'none', region: 'eu', invisible: true, score: false, action: false, ui: 'own', brand: true },
    client: {
      load() {},
      render(_ctx, _el, e) {
        events = e
        return null
      },
      execute() {
        return new Promise<string>((resolve, reject) => {
          finish = resolve
          failWith = reject
        })
      },
      reset() {},
    },
    server: { verify: async () => ({ success: true, provider: name, errors: [] }) },
  })
  return {
    provider,
    solve: (token: string) => finish?.(token),
    fail: (error: unknown) => failWith?.(error),
    progress: (p: number) => events?.progress(p),
    expire: () => events?.expire(),
  }
}

/** A widget provider that needs consent; `load` can be made to fail. */
function widgetProvider(name: string, options: { fail?: boolean } = {}) {
  const loaded = vi.fn()
  const provider = defineCaptchaProvider<Record<string, unknown>, { el: HTMLElement }>({
    name,
    meta: { consent: 'required', region: 'global', invisible: true, score: false, action: true, ui: 'widget', vendor: `${name}-vendor` },
    client: {
      async load(ctx) {
        loaded(ctx)
        if (options.fail) throw new Error('script blocked')
      },
      render(_ctx, el, events) {
        const frame = document.createElement('div')
        frame.setAttribute('data-third-party', name)
        el.appendChild(frame)
        queueMicrotask(() => events.solve(`${name}-raw`))
        return { el: frame }
      },
      reset() {},
      destroy(handle) {
        handle.el.remove()
      },
    },
    server: { verify: async () => ({ success: true, provider: name, errors: [] }) },
  })
  return { provider, loaded }
}

function runtime(registry: Record<string, AnyCaptchaProvider>, config: Partial<CaptchaPublicConfig>, consent: CaptchaConsentSeam | null = null): CaptchaRuntime {
  const full: CaptchaPublicConfig = { provider: 'own', source: 'config', fallback: false, labels: {}, rider: { url: '', site: '' }, providers: {}, ...config }
  return { registry, config: () => full, consent: () => consent, loadScript: vi.fn(async () => undefined) }
}

function mountCaptcha(rt: CaptchaRuntime, props: Record<string, unknown> = {}) {
  return mount(RevenexxCaptcha, { props: { action: 'contact', ...props }, global: { provide: { [CAPTCHA_RUNTIME as symbol]: rt } }, attachTo: document.body })
}

describe('<RevenexxCaptcha> with the own box', () => {
  it('is an accessible checkbox that goes idle → verifying → done [@spec:module-contract:AC-11]', async () => {
    const own = controllable()
    const wrapper = mountCaptcha(runtime({ own: own.provider }, { provider: 'own' }))
    await flushPromises()
    const box = wrapper.get('[role="group"]')
    expect(box.attributes('aria-label')).toBe('Schutz vor automatisierten Anfragen')
    const check = wrapper.get('button[role="checkbox"]')
    expect(check.attributes('type')).toBe('button')
    expect(check.attributes('aria-checked')).toBe('false')
    expect(check.text()).toBe('Ich bin kein Roboter')
    expect(wrapper.get('[data-captcha-status]').attributes('aria-live')).toBe('polite')
    expect(wrapper.get('.rvx-captcha__brand').text()).toBe('RevenexxCaptcha')
    expect(wrapper.find('a').exists()).toBe(false)

    await check.trigger('click')
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-state')).toBe('verifying')
    expect(check.attributes('aria-busy')).toBe('true')
    expect(wrapper.get('[data-captcha-status]').text()).toBe('Wird geprüft …')
    own.progress(40)
    await flushPromises()
    expect(wrapper.get('.rvx-captcha__ring-value').attributes('stroke-dasharray')).toBe('40 100')

    own.solve('raw.token:1')
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-state')).toBe('done')
    expect(check.attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[data-captcha-status]').text()).toBe('Erfolgreich geprüft')
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.own.raw.token:1')
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual(['rvx1.own.raw.token:1'])
    expect(wrapper.emitted('solve')!.at(-1)).toEqual(['rvx1.own.raw.token:1'])
    wrapper.unmount()
  })

  it('shows the error state and can be retried [@spec:module-contract:AC-11]', async () => {
    const own = controllable()
    const wrapper = mountCaptcha(runtime({ own: own.provider }, { provider: 'own' }))
    await flushPromises()
    await wrapper.get('button[role="checkbox"]').trigger('click')
    own.fail(new Error('network'))
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-state')).toBe('error')
    expect(wrapper.get('[data-captcha-status]').text()).toBe('Prüfung fehlgeschlagen. Bitte erneut versuchen.')
    expect(wrapper.emitted('error')).toHaveLength(1)
    await wrapper.get('button[role="checkbox"]').trigger('click')
    own.solve('again')
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-state')).toBe('done')
    wrapper.unmount()
  })

  it('clears the token when it expires [@spec:module-contract:AC-11]', async () => {
    const own = controllable()
    const wrapper = mountCaptcha(runtime({ own: own.provider }, { provider: 'own' }))
    await flushPromises()
    await wrapper.get('button[role="checkbox"]').trigger('click')
    own.solve('t')
    await flushPromises()
    own.expire()
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-state')).toBe('expired')
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper.emitted('expire')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')!.at(-1)).toEqual([''])
    wrapper.unmount()
  })

  it('takes label overrides and a custom input name', async () => {
    const own = controllable()
    const wrapper = mountCaptcha(runtime({ own: own.provider }, { provider: 'own', labels: { verify: 'I am human', brand: 'Acme' } }), { name: 'cf' })
    expect(wrapper.get('button[role="checkbox"]').text()).toBe('I am human')
    expect(wrapper.get('.rvx-captcha__brand').text()).toBe('Acme')
    expect(wrapper.get('input[type="hidden"]').attributes('name')).toBe('cf')
    wrapper.unmount()
  })

  it('renders the test provider with the box and solves to rvx1.test.pass', async () => {
    const wrapper = mountCaptcha(runtime({ test }, { provider: 'test' }))
    await flushPromises()
    expect(wrapper.find('.rvx-captcha__brand').exists()).toBe(false)
    await wrapper.get('button[role="checkbox"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.test.pass')
    wrapper.unmount()
  })

  it('solves at once with the none provider and shows nothing', async () => {
    const wrapper = mountCaptcha(runtime({ none }, { provider: 'none' }))
    await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.none.none')
    wrapper.unmount()
  })

  it('offers a slot for a headless box', async () => {
    const own = controllable()
    const wrapper = mount(RevenexxCaptcha, {
      props: { action: 'contact' },
      slots: { default: (p: { state: string, execute: () => Promise<string> }) => h('button', { 'class': 'mine', 'data-state': p.state, 'onClick': () => p.execute() }, 'go') },
      global: { provide: { [CAPTCHA_RUNTIME as symbol]: runtime({ own: own.provider }, { provider: 'own' }) } },
    })
    await flushPromises()
    expect(wrapper.find('.rvx-captcha__box').exists()).toBe(false)
    await wrapper.get('button.mine').trigger('click')
    own.solve('slot')
    await flushPromises()
    expect(wrapper.get('button.mine').attributes('data-state')).toBe('done')
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.own.slot')
    wrapper.unmount()
  })
})

describe('consent and fallback', () => {
  const consent = (allowed: string[]): CaptchaConsentSeam & { fire: () => void } => {
    const listeners: Array<() => void> = []
    return {
      allows: vendor => allowed.includes(vendor),
      onChange: (cb) => {
        listeners.push(cb)
        return () => {}
      },
      fire: () => listeners.forEach(cb => cb()),
    }
  }

  it('renders the fallback while the provider lacks consent, and the envelope names the fallback [@spec:module-contract:AC-10]', async () => {
    const own = controllable('revenexx')
    const turnstile = widgetProvider('turnstile')
    const rt = runtime({ revenexx: own.provider, turnstile: turnstile.provider }, { provider: 'turnstile', fallback: 'revenexx' }, consent([]))
    const wrapper = mountCaptcha(rt)
    await flushPromises()
    expect(turnstile.loaded).not.toHaveBeenCalled()
    expect(wrapper.find('[data-third-party]').exists()).toBe(false)
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-provider')).toBe('revenexx')
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-fallback')).toBe('consent')
    await wrapper.get('button[role="checkbox"]').trigger('click')
    own.solve('k1:a:b')
    await flushPromises()
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.revenexx.k1:a:b')
    wrapper.unmount()
  })

  it('loads the provider directly once its vendor is allowed [@spec:module-contract:AC-10]', async () => {
    const own = controllable('revenexx')
    const turnstile = widgetProvider('turnstile')
    const rt = runtime({ revenexx: own.provider, turnstile: turnstile.provider }, { provider: 'turnstile', fallback: 'revenexx' }, consent(['turnstile-vendor']))
    const wrapper = mountCaptcha(rt)
    await flushPromises()
    expect(turnstile.loaded).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-third-party="turnstile"]').exists()).toBe(true)
    expect((wrapper.get('input[type="hidden"]').element as HTMLInputElement).value).toBe('rvx1.turnstile.turnstile-raw')
    wrapper.unmount()
  })

  it('switches to the provider when consent is granted later', async () => {
    const own = controllable('revenexx')
    const turnstile = widgetProvider('turnstile')
    const allowed: string[] = []
    const seam = consent(allowed)
    const wrapper = mountCaptcha(runtime({ revenexx: own.provider, turnstile: turnstile.provider }, { provider: 'turnstile', fallback: 'revenexx' }, seam))
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-provider')).toBe('revenexx')
    allowed.push('turnstile-vendor')
    seam.fire()
    await flushPromises()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-provider')).toBe('turnstile')
    expect(turnstile.loaded).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('loads a consent provider directly when the consent module is not installed', () => {
    const turnstile = widgetProvider('turnstile')
    const own = controllable('revenexx')
    expect(selectProvider('turnstile', { provider: 'turnstile', source: 'config', fallback: 'revenexx', labels: {}, rider: { url: '', site: '' }, providers: {} }, { turnstile: turnstile.provider, revenexx: own.provider }, null))
      .toEqual({ name: 'turnstile', reason: 'configured' })
  })

  it('shows a notice when consent is missing and no fallback is configured', async () => {
    const turnstile = widgetProvider('turnstile')
    const wrapper = mountCaptcha(runtime({ turnstile: turnstile.provider }, { provider: 'turnstile', fallback: false }, consent([])))
    await flushPromises()
    expect(wrapper.get('.rvx-captcha__notice').text()).toBe('Diese Prüfung wird erst nach Ihrer Einwilligung geladen.')
    expect(turnstile.loaded).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('falls back when the provider\'s script fails to load [@spec:module-contract:AC-14]', async () => {
    const own = controllable('revenexx')
    const turnstile = widgetProvider('turnstile', { fail: true })
    const wrapper = mountCaptcha(runtime({ revenexx: own.provider, turnstile: turnstile.provider }, { provider: 'turnstile', fallback: 'revenexx' }))
    await flushPromises()
    expect(turnstile.loaded).toHaveBeenCalledOnce()
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-provider')).toBe('revenexx')
    expect(wrapper.get('.rvx-captcha').attributes('data-captcha-fallback')).toBe('failed')
    expect(wrapper.find('button[role="checkbox"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('reports unavailable when the script fails and there is no fallback [@spec:module-contract:AC-14]', async () => {
    const turnstile = widgetProvider('turnstile', { fail: true })
    const wrapper = mountCaptcha(runtime({ turnstile: turnstile.provider }, { provider: 'turnstile', fallback: false }))
    await flushPromises()
    expect(wrapper.get('.rvx-captcha__notice').text()).toBe('Die Prüfung ist gerade nicht verfügbar.')
    expect(wrapper.emitted('error')).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('useCaptcha()', () => {
  it('runs the challenge invisibly and resolves with the enveloped token', async () => {
    const own = controllable()
    let api!: ReturnType<typeof useCaptcha>
    const Host = defineComponent({
      setup() {
        api = useCaptcha({ action: 'newsletter' })
        return () => h('div')
      },
    })
    const wrapper = mount(Host, { global: { provide: { [CAPTCHA_RUNTIME as symbol]: runtime({ own: own.provider }, { provider: 'own' }) } } })
    expect(api.state.value).toBe('idle')
    const pending = api.execute()
    await flushPromises()
    expect(api.state.value).toBe('verifying')
    own.solve('inv')
    await expect(pending).resolves.toBe('rvx1.own.inv')
    expect(api.token.value).toBe('rvx1.own.inv')
    expect(api.provider.value).toBe('own')
    await expect(api.execute()).resolves.toBe('rvx1.own.inv')
    api.reset()
    expect(api.token.value).toBe('')
    expect(api.state.value).toBe('idle')
    wrapper.unmount()
  })

  it('needs the module', () => {
    const Host = defineComponent({
      setup() {
        useCaptcha()
      },
      render: () => h('div'),
    })
    expect(() => mount(Host)).toThrow(/needs the @revenexx\/captcha-nuxt module/)
  })
})
