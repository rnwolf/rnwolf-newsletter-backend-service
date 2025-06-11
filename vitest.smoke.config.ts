import { defineConfig } from 'vitest/config';

// This config is for smoke tests that make real HTTP requests to remote environments
// It doesn't use the Cloudflare Workers pool
export default defineConfig({
  test: {
    testTimeout: 30000, // 30 seconds for network requests
    include: ['tests/smoke-*.test.ts'],
    exclude: ['tests/api.test.ts', 'tests/unsubscribe.test.ts', 'tests/integration.test.ts', 'tests/performance.test.ts'],
  },
});