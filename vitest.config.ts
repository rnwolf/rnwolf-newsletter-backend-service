import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Enable D1 database for testing
          d1Databases: ['DB'],
          // Mock Turnstile verification for testing
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});