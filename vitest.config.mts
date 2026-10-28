import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{mjs,ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}', 'packages/*/src/**/*.test.ts'],
    exclude: ['tests/e2e/**', '**/node_modules/**', '**/dist/**', '**/generated/**'],
    restoreMocks: true,
    clearMocks: true,
  },
});
