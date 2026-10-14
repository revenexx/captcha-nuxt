import type { CaptchaLabels } from './types'

/** German defaults. Override any of them through `captcha.labels`. */
export const DEFAULT_LABELS: CaptchaLabels = {
  verify: 'Ich bin kein Roboter',
  verifying: 'Wird geprüft …',
  done: 'Erfolgreich geprüft',
  error: 'Prüfung fehlgeschlagen. Bitte erneut versuchen.',
  expired: 'Prüfung abgelaufen. Bitte erneut bestätigen.',
  group: 'Schutz vor automatisierten Anfragen',
  consentRequired: 'Diese Prüfung wird erst nach Ihrer Einwilligung geladen.',
  unavailable: 'Die Prüfung ist gerade nicht verfügbar.',
  brand: 'RevenexxCaptcha',
}

export function resolveLabels(overrides?: Partial<CaptchaLabels> | null): CaptchaLabels {
  const out = { ...DEFAULT_LABELS }
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (typeof value === 'string' && value && key in out) out[key as keyof CaptchaLabels] = value
  }
  return out
}
