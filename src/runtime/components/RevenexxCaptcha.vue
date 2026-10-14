<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CAPTCHA_RUNTIME, createCaptchaController } from '../controller'

/**
 * One captcha, whichever provider is configured. It renders a hidden input
 * (`name`, default `captcha`) that carries the enveloped token, so a plain
 * form post works, and keeps `v-model` in sync.
 *
 *   <RevenexxCaptcha action="contact" v-model="token" />
 */
const props = withDefaults(defineProps<{
  /** The action the server expects (`verifyCaptcha(event, token, { action })`). */
  action?: string
  /** The token, enveloped (`rvx1.<provider>.<raw>`). */
  modelValue?: string
  /** Use another provider than the configured one. The server has to accept it (`verifyCaptcha(..., { provider })`). */
  provider?: string
  /** Show nothing until needed: the challenge runs on submit of the surrounding form, or through `execute()`. */
  invisible?: boolean
  /** The name of the hidden input. */
  name?: string
}>(), {
  action: undefined,
  modelValue: '',
  provider: undefined,
  invisible: false,
  name: 'captcha',
})

const emit = defineEmits<{
  'update:modelValue': [token: string]
  'solve': [token: string]
  'error': [error: unknown]
  'expire': []
}>()

const runtime = inject(CAPTCHA_RUNTIME, null)
if (!runtime) throw new Error('[captcha] <RevenexxCaptcha> needs the @revenexx/captcha-nuxt module')

const captcha = createCaptchaController(runtime, {
  action: props.action,
  provider: props.provider,
  invisible: props.invisible,
  onSolve: (token) => {
    emit('update:modelValue', token)
    emit('solve', token)
  },
  onError: (error) => {
    emit('update:modelValue', '')
    emit('error', error)
  },
  onExpire: () => {
    emit('update:modelValue', '')
    emit('expire')
  },
  onReset: () => emit('update:modelValue', ''),
})

const { state, token, progress, provider: active, ui, brand, labels, unavailable, selection } = captcha
const root = ref<HTMLElement | null>(null)
const widget = ref<HTMLElement | null>(null)

const verifying = computed(() => state.value === 'verifying')
const done = computed(() => state.value === 'done')
const blocked = computed(() => !active.value)
const label = computed(() => {
  if (state.value === 'verifying') return labels.value.verifying
  if (state.value === 'done') return labels.value.done
  if (state.value === 'error') return labels.value.error
  if (state.value === 'expired') return labels.value.expired
  return labels.value.verify
})
/** Announced through the live region on every state change except idle. */
const status = computed(() => (state.value === 'idle' ? '' : label.value))

function solve() {
  if (verifying.value || done.value) return
  captcha.execute().catch(() => { /* reported through state and the error event */ })
}

// A parent clearing v-model resets the captcha.
watch(() => props.modelValue, (value) => {
  if (!value && token.value) captcha.reset()
})

// Invisible: run the challenge when the surrounding form is submitted, then submit again.
let form: HTMLFormElement | null = null
async function onSubmit(event: Event) {
  if (token.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  try {
    await captcha.execute()
  }
  catch {
    return
  }
  if (form?.requestSubmit) form.requestSubmit()
  else form?.submit()
}

onMounted(() => {
  // Own-UI providers ignore the container; widget providers render into it.
  captcha.mount(widget.value)
  if (props.invisible) {
    form = root.value?.closest('form') ?? null
    form?.addEventListener('submit', onSubmit, { capture: true })
  }
})

onBeforeUnmount(() => {
  form?.removeEventListener('submit', onSubmit, { capture: true })
  captcha.destroy()
})

defineExpose({ execute: captcha.execute, reset: captcha.reset, state, token, provider: active })
</script>

<template>
  <div
    ref="root"
    class="rvx-captcha"
    :class="[`rvx-captcha--${state}`, { 'rvx-captcha--invisible': invisible }]"
    :data-captcha-provider="active || undefined"
    :data-captcha-state="state"
    :data-captcha-fallback="selection.reason !== 'configured' && active ? selection.reason : undefined"
  >
    <slot
      :state="state"
      :token="token"
      :provider="active"
      :progress="progress"
      :labels="labels"
      :execute="captcha.execute"
      :reset="captcha.reset"
    >
      <p
        v-if="blocked || unavailable"
        class="rvx-captcha__notice"
        role="status"
      >
        {{ blocked && selection.reason === 'consent' ? labels.consentRequired : labels.unavailable }}
      </p>
      <div
        v-else-if="ui === 'own' && !invisible"
        class="rvx-captcha__box"
        role="group"
        :aria-label="labels.group"
      >
        <button
          type="button"
          role="checkbox"
          class="rvx-captcha__check"
          :aria-checked="done ? 'true' : 'false'"
          :aria-busy="verifying ? 'true' : 'false'"
          :aria-disabled="verifying || done ? 'true' : undefined"
          :style="{ '--rvx-captcha-progress': `${progress}` }"
          data-captcha-action="verify"
          @click="solve"
        >
          <span
            class="rvx-captcha__mark"
            aria-hidden="true"
          >
            <svg
              v-if="done"
              viewBox="0 0 24 24"
              class="rvx-captcha__icon"
            ><path
              d="M5 12.5l4.5 4.5L19 7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            /></svg>
            <svg
              v-else-if="verifying"
              viewBox="0 0 32 32"
              class="rvx-captcha__ring"
            ><circle
              cx="16"
              cy="16"
              r="13"
              class="rvx-captcha__ring-track"
            /><circle
              cx="16"
              cy="16"
              r="13"
              class="rvx-captcha__ring-value"
              pathLength="100"
              :stroke-dasharray="`${progress} 100`"
            /></svg>
          </span>
          <span class="rvx-captcha__label">{{ label }}</span>
        </button>
        <span
          v-if="brand"
          class="rvx-captcha__brand"
        >{{ labels.brand }}</span>
      </div>
      <div
        v-show="ui === 'widget'"
        ref="widget"
        class="rvx-captcha__widget"
      />
    </slot>
    <span
      class="rvx-captcha__status"
      role="status"
      aria-live="polite"
      data-captcha-status
    >{{ status }}</span>
    <input
      type="hidden"
      :name="name"
      :value="token"
    >
  </div>
</template>

<style>
.rvx-captcha {
  --rvx-captcha-bg: #fff;
  --rvx-captcha-fg: #1a1a1a;
  --rvx-captcha-muted: #5b6370;
  --rvx-captcha-border: #d0d5dd;
  --rvx-captcha-accent: #0f2a44;
  --rvx-captcha-success: #1f7a4d;
  --rvx-captcha-error: #b42318;
  --rvx-captcha-radius: 8px;
  --rvx-captcha-focus: 3px solid #3b82f6;
  --rvx-captcha-width: 18rem;
  display: inline-block;
  max-width: 100%;
  color: var(--rvx-captcha-fg);
  font: inherit;
}
@media (prefers-color-scheme: dark) {
  .rvx-captcha {
    --rvx-captcha-bg: #1d2126;
    --rvx-captcha-fg: #f2f4f7;
    --rvx-captcha-muted: #a4acb9;
    --rvx-captcha-border: #3a414b;
    --rvx-captcha-accent: #8cb4e8;
    --rvx-captcha-success: #5ccf91;
    --rvx-captcha-error: #f97066;
  }
}
.rvx-captcha--invisible .rvx-captcha__widget:empty { display: none; }
.rvx-captcha__box {
  display: flex; flex-direction: column; gap: 0.375rem;
  width: var(--rvx-captcha-width); max-width: 100%; box-sizing: border-box;
  padding: 0.75rem 0.875rem; background: var(--rvx-captcha-bg);
  border: 1px solid var(--rvx-captcha-border); border-radius: var(--rvx-captcha-radius);
}
.rvx-captcha__check {
  display: flex; align-items: center; gap: 0.75rem; width: 100%;
  padding: 0; margin: 0; border: 0; background: none; color: inherit;
  font: inherit; text-align: start; cursor: pointer;
}
.rvx-captcha__check[aria-disabled="true"] { cursor: default; }
.rvx-captcha__check:focus-visible { outline: var(--rvx-captcha-focus); outline-offset: 4px; border-radius: 4px; }
.rvx-captcha__mark {
  flex: none; display: inline-grid; place-items: center; width: 1.75rem; height: 1.75rem;
  box-sizing: border-box; border: 2px solid var(--rvx-captcha-border); border-radius: 6px;
  background: var(--rvx-captcha-bg); color: var(--rvx-captcha-success);
}
.rvx-captcha--verifying .rvx-captcha__mark { border-color: transparent; }
.rvx-captcha--done .rvx-captcha__mark { border-color: var(--rvx-captcha-success); }
.rvx-captcha--error .rvx-captcha__mark, .rvx-captcha--expired .rvx-captcha__mark { border-color: var(--rvx-captcha-error); }
.rvx-captcha__icon { width: 1.25rem; height: 1.25rem; }
.rvx-captcha__ring { width: 1.75rem; height: 1.75rem; transform: rotate(-90deg); }
.rvx-captcha__ring circle { fill: none; stroke-width: 3; }
.rvx-captcha__ring-track { stroke: var(--rvx-captcha-border); }
.rvx-captcha__ring-value { stroke: var(--rvx-captcha-accent); stroke-linecap: round; transition: stroke-dasharray 0.2s ease; }
.rvx-captcha__label { line-height: 1.3; }
.rvx-captcha--error .rvx-captcha__label, .rvx-captcha--expired .rvx-captcha__label { color: var(--rvx-captcha-error); }
.rvx-captcha__brand { align-self: flex-end; font-size: 0.75rem; letter-spacing: 0.01em; color: var(--rvx-captcha-muted); }
.rvx-captcha__notice { margin: 0; color: var(--rvx-captcha-muted); font-size: 0.875rem; }
.rvx-captcha__status {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
@media (prefers-reduced-motion: reduce) {
  .rvx-captcha__ring-value { transition: none; }
}
</style>
