import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // @vitejs/plugin-vue is typed against the Vite that Nuxt brings, vitest
  // against its own; the plugin is the same object at runtime.
  plugins: [vue() as never],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'ssr', include: ['test/e2e/**/*.test.ts'], environment: 'node', testTimeout: 300_000, hookTimeout: 300_000 } },
    ],
  },
})
