<script setup lang="ts">
const token = ref('')
</script>

<template>
  <form method="post" action="/api/contact">
    <h1>Fixture</h1>
    <RevenexxCaptcha v-model="token" action="contact" />
    <button type="submit">Senden</button>
  </form>
</template>
