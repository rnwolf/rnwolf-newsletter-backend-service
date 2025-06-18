// vitest.config.staging.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup-staging.ts'],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
          environment: 'staging'  // Use staging environment from wrangler.jsonc
        },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
          // For staging, secrets should come from actual environment
          vars: {
            ENVIRONMENT: 'staging'
          },
          // Bindings are for secrets, KV, D1, etc.
          bindings: {
            HMAC_SECRET_KEY: process.env.HMAC_SECRET_KEY,
            TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY
          }
        },
      },
    },
  },
});