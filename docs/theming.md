# Theming

## CSS variables

Set them on `.rvx-captcha` or any ancestor. Dark-mode values apply under
`prefers-color-scheme: dark`; override both if your theme switches by class.

| Variable | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--rvx-captcha-bg` | `#fff` | `#1d2126` | box and checkbox background |
| `--rvx-captcha-fg` | `#1a1a1a` | `#f2f4f7` | text |
| `--rvx-captcha-muted` | `#5b6370` | `#a4acb9` | brand line, notices |
| `--rvx-captcha-border` | `#d0d5dd` | `#3a414b` | box and checkbox border, progress track |
| `--rvx-captcha-accent` | `#0f2a44` | `#8cb4e8` | progress ring |
| `--rvx-captcha-success` | `#1f7a4d` | `#5ccf91` | check mark |
| `--rvx-captcha-error` | `#b42318` | `#f97066` | error and expired state |
| `--rvx-captcha-radius` | `8px` | | box corners |
| `--rvx-captcha-focus` | `3px solid #3b82f6` | | focus outline |
| `--rvx-captcha-width` | `18rem` | | box width (never wider than its container) |

```css
/* a theme that switches dark mode by class */
.dark .rvx-captcha { --rvx-captcha-bg: #111; --rvx-captcha-fg: #eee; --rvx-captcha-border: #333; }
```

## Classes and data attributes

| Selector | Element |
| --- | --- |
| `.rvx-captcha` | root; also `.rvx-captcha--idle`, `--verifying`, `--done`, `--error`, `--expired`, `--invisible` |
| `[data-captcha-state]` | root, the current state |
| `[data-captcha-provider]` | root, the provider that runs |
| `[data-captcha-fallback]` | root, `consent` or `failed` when the fallback runs |
| `.rvx-captcha__box` | the own box (`role="group"`) |
| `.rvx-captcha__check` | the checkbox button (`role="checkbox"`, `aria-checked`, `aria-busy`) |
| `.rvx-captcha__mark` | the square; holds `.rvx-captcha__ring` (progress) or `.rvx-captcha__icon` (check) |
| `.rvx-captcha__label` | the state text |
| `.rvx-captcha__brand` | the brand line, for a provider with `meta.brand: true` |
| `.rvx-captcha__widget` | the container a widget provider renders into |
| `.rvx-captcha__notice` | consent-required / unavailable notice |
| `.rvx-captcha__recaptcha-notice` | the reCAPTCHA line (`[data-captcha-recaptcha-notice]`), inside `.rvx-captcha__widget` |
| `[data-captcha-status]` | the visually hidden live region |
| `.rvx-captcha-headless` | the container `useCaptcha()` creates for widget providers, at the end of `<body>` |

The progress is also available as `--rvx-captcha-progress` (0 to 100) on the checkbox button.

## The slot

The default slot replaces the box, not the hidden input. It receives
`{ state, token, provider, progress, labels, execute, reset }`.

```vue
<RevenexxCaptcha v-slot="{ state, progress, execute, labels }" v-model="token" action="contact">
  <button type="button" :aria-busy="state === 'verifying'" @click="execute">
    {{ state === 'done' ? labels.done : state === 'verifying' ? `${progress} %` : labels.verify }}
  </button>
</RevenexxCaptcha>
```

Keep what the default box gives assistive technology: a button, a state that is announced
(`aria-live`), and a label that says what the box does.

## Accessibility

- One focusable control: `<button role="checkbox">`, operable with Space and Enter.
- `aria-checked` is `true` once solved; `aria-busy` while verifying; the control is
  `aria-disabled` while verifying and after success.
- Each state change is announced through a polite live region.
- Motion: the progress ring has no transition under `prefers-reduced-motion: reduce`.
- Proof of work needs no puzzle, image or audio challenge: nothing to see or hear.
