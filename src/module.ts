import {
  addComponent, addImports, addPlugin, addServerHandler, addServerImports, addTemplate, createResolver,
  defineNuxtModule, hasNuxtModule, installModule, resolvePath, useLogger,
} from '@nuxt/kit'
import { defu } from 'defu'
import type { BuiltinProviderName, CaptchaLabels } from './runtime/types'
import { PROVIDER_NAME } from './runtime/envelope'

export type * from './runtime/types'
export { defineCaptchaProvider } from './runtime/define'

/** Options of one provider. `provider` points at a custom provider file. */
export interface ProviderOptions {
  /** A custom provider file, e.g. `'~/captcha/my-provider'`, whose default export is `defineCaptchaProvider(...)`. */
  provider?: string
  /** The consent vendor code this provider is gated on (default: the provider's own). */
  consentVendor?: string
  /** The consent purpose this provider is gated on (default: any purpose of the vendor). */
  consentPurpose?: string
  [option: string]: unknown
}

export interface ModuleOptions {
  /** The provider: `'revenexx'`, `'cap'`, `'friendly'`, `'turnstile'`, `'none'`, `'test'` or the name of a custom one. */
  provider: BuiltinProviderName | (string & {})
  /** `'config'`: provider and site keys from this configuration. `'rider'`: from the revenexx platform at runtime. */
  source: 'config' | 'rider'
  /** Used when the provider lacks consent or its script fails. `false` disables the fallback. */
  fallback: BuiltinProviderName | (string & {}) | false
  /** Overrides for the German default texts. */
  labels: Partial<CaptchaLabels>
  /** Rider, the revenexx platform service that configures captchas per tenant (used with `source: 'rider'`). */
  rider: {
    url: string
    /** The public site id, e.g. `rcs_…`. */
    site: string
  }
  /** Public provider options. Secrets never go here, see the README. */
  providers: {
    revenexx?: { endpoint?: string, siteKey?: string } & ProviderOptions
    cap?: { endpoint?: string, siteKey?: string } & ProviderOptions
    friendly?: { siteKey?: string, region?: 'eu' | 'global', language?: string, startMode?: 'focus' | 'auto' | 'none', theme?: 'light' | 'dark' | 'auto' } & ProviderOptions
    turnstile?: { siteKey?: string, theme?: 'auto' | 'light' | 'dark', size?: 'normal' | 'flexible' | 'compact', language?: string } & ProviderOptions
    test?: { token?: string, delay?: number } & ProviderOptions
    [name: string]: ProviderOptions | undefined
  }
  /** Send the visitor's address to the provider (Turnstile `remoteip`, Rider `remoteip`). Default true. */
  forwardIp: boolean
}

const BUILTIN: BuiltinProviderName[] = ['revenexx', 'cap', 'friendly', 'turnstile', 'none', 'test']
const NOT_FOR_PRODUCTION = ['none', 'test']

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@revenexx/captcha-nuxt',
    configKey: 'captcha',
    compatibility: { nuxt: '>=4.0.0' },
  },
  defaults: {
    provider: 'revenexx',
    source: 'config',
    fallback: 'revenexx',
    labels: {},
    rider: { url: 'https://rider.revenexx.com', site: '' },
    providers: {
      revenexx: { endpoint: 'https://captcha.revenexx.com', siteKey: '' },
      cap: { endpoint: '', siteKey: '' },
      friendly: { siteKey: '', region: 'eu' },
      turnstile: { siteKey: '' },
    },
    forwardIp: true,
  },
  async setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const logger = useLogger('captcha')

    // The script loader Turnstile and custom providers load through.
    if (!hasNuxtModule('@nuxt/scripts')) await installModule('@nuxt/scripts')

    // Every provider the browser or the server may need: the built-ins and the custom files.
    const files: Record<string, string> = {}
    for (const name of BUILTIN) files[name] = await resolvePath(resolve(`./runtime/providers/${name}`))
    const publicProviders: Record<string, Record<string, unknown>> = {}
    for (const [name, raw] of Object.entries(options.providers ?? {})) {
      if (!raw) continue
      if (!PROVIDER_NAME.test(name)) throw new Error(`[captcha] invalid provider name "${name}": letters, digits, - and _ only`)
      const { provider: file, ...rest } = raw
      if (typeof file === 'string' && file) files[name] = await resolvePath(file, { alias: nuxt.options.alias })
      publicProviders[name] = rest
    }
    for (const name of [options.provider, options.fallback].filter((n): n is string => typeof n === 'string' && !!n)) {
      if (!files[name]) logger.warn(`Provider "${name}" is neither built in nor configured with a \`provider\` file.`)
    }
    if (!nuxt.options.dev) {
      nuxt.hook('build:before', () => {
        for (const name of [options.provider, options.fallback]) {
          if (typeof name === 'string' && NOT_FOR_PRODUCTION.includes(name)) {
            logger.warn(`The "${name}" captcha provider is for development and tests. Its server refuses every token when NODE_ENV=production.`)
          }
        }
      })
    }

    // Never read from process.env here: whatever the module sets up is
    // serialized into the build. Secrets are server-only runtime config,
    // empty here and filled per process from NUXT_CAPTCHA_* at runtime.
    const serverConfig = nuxt.options.runtimeConfig as Record<string, unknown>
    serverConfig.captcha = defu(serverConfig.captcha as object, {
      riderToken: '',
      capSecret: '',
      capVerifyEndpoint: '',
      friendlyApiKey: '',
      turnstileSecret: '',
      forwardIp: options.forwardIp,
      secrets: {},
    })
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    publicConfig.captcha = defu(publicConfig.captcha as object, {
      provider: options.provider,
      source: options.source,
      fallback: options.fallback,
      labels: options.labels,
      rider: options.rider,
      providers: publicProviders,
      consentModule: false,
    })
    // Known only once every module is installed.
    nuxt.hook('modules:done', () => {
      (publicConfig.captcha as { consentModule: boolean }).consentModule = hasNuxtModule('@revenexx/consent-manager-nuxt')
    })

    const registry = addTemplate({
      filename: 'captcha/providers.mjs',
      write: true,
      getContents: () => {
        const entries = Object.entries(files)
        return [
          ...entries.map(([, file], i) => `import provider${i} from ${JSON.stringify(file)}`),
          `export const providers = {`,
          ...entries.map(([name], i) => `  ${JSON.stringify(name)}: provider${i},`),
          `}`,
          '',
        ].join('\n')
      },
    })
    nuxt.options.alias['#captcha-providers'] = registry.dst
    // Next to the registry, so the `#captcha-providers` path alias resolves to types.
    addTemplate({
      filename: 'captcha/providers.d.ts',
      write: true,
      getContents: () => [
        `import type { AnyCaptchaProvider } from ${JSON.stringify(resolve('./runtime/types'))}`,
        `export declare const providers: Record<string, AnyCaptchaProvider>`,
        '',
      ].join('\n'),
    })

    const runtimeDir = resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir)
    nuxt.hook('nitro:config', (nitro) => {
      nitro.alias = { ...nitro.alias, '#captcha-providers': registry.dst }
      nitro.externals = defu(nitro.externals, { inline: [runtimeDir] })
    })

    addPlugin({ src: resolve('./runtime/plugin'), mode: 'all' })
    addComponent({ name: 'RevenexxCaptcha', filePath: resolve('./runtime/components/RevenexxCaptcha.vue') })
    addImports([
      { name: 'useCaptcha', from: resolve('./runtime/composables/useCaptcha') },
      { name: 'defineCaptchaProvider', from: resolve('./runtime/define') },
    ])
    addServerImports([
      { name: 'verifyCaptcha', from: resolve('./runtime/server/utils/verify') },
      { name: 'defineCaptchaProvider', from: resolve('./runtime/define') },
    ])
    addServerHandler({ route: '/_captcha/config', method: 'get', handler: resolve('./runtime/server/routes/config.get') })
  },
})
