import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup.ts'], // Add this line
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
                    // Set environment variables for testing
          vars: {
            ENVIRONMENT: 'local',
            HMAC_SECRET_KEY: 'test-secret',
            TURNSTILE_SECRET_KEY: 'test-turnstile-secret'
          }
        },
      },
    },
  },
});