<script setup lang="ts">
const name = ref('')
const message = ref('')
const token = ref('')
const answer = ref<unknown>(null)

async function send() {
  answer.value = await $fetch('/api/contact', {
    method: 'POST',
    body: { name: name.value, message: message.value, captcha: token.value },
  }).catch((error: { data?: unknown }) => error.data)
}

// Invisible: no box; the challenge runs when the button is pressed.
const newsletter = useCaptcha({ action: 'newsletter' })
const email = ref('')
const newsletterAnswer = ref<unknown>(null)
async function subscribe() {
  const captcha = await newsletter.execute()
  newsletterAnswer.value = await $fetch('/api/contact', {
    method: 'POST',
    body: { name: email.value, message: 'newsletter', captcha, action: 'newsletter' },
  }).catch((error: { data?: unknown }) => error.data)
  newsletter.reset()
}
</script>

<template>
  <main style="max-width: 40rem; margin: 2rem auto; font-family: system-ui, sans-serif; display: grid; gap: 2rem">
    <form
      data-form="contact"
      style="display: grid; gap: 0.75rem"
      @submit.prevent="send"
    >
      <h1>Kontakt</h1>
      <label>Name <input v-model="name" name="name" required></label>
      <label>Nachricht <textarea v-model="message" name="message" required /></label>
      <RevenexxCaptcha v-model="token" action="contact" />
      <button type="submit" :disabled="!token">Senden</button>
      <pre data-answer="contact">{{ answer }}</pre>
    </form>

    <form
      data-form="newsletter"
      style="display: grid; gap: 0.75rem"
      @submit.prevent="subscribe"
    >
      <h2>Newsletter (unsichtbar)</h2>
      <label>E-Mail <input v-model="email" type="email" name="email" required></label>
      <button type="submit">Anmelden</button>
      <p>Status: {{ newsletter.state }} · Provider: {{ newsletter.provider }}</p>
      <pre data-answer="newsletter">{{ newsletterAnswer }}</pre>
    </form>
  </main>
</template>
