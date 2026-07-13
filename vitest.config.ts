import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'server-only': '/home/runner/work/csulb-biotech-career-hub/csulb-biotech-career-hub/src/__tests__/__mocks__/server-only.ts',
    },
  },
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
  },
});
