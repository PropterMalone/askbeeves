import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/content.ts'],
      thresholds: {
        lines: 95,
        functions: 89,
        branches: 85,
        statements: 95,
      },
    },
  },
});
