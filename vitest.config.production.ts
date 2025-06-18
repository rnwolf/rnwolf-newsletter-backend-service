// vitest.config.production.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
// This configuration is for production smoke tests
export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup-smoke.ts'], // Different setup for production smoke tests
    exclude: [
      '**/node_modules/**', // Exclude all files in node_modules
    ],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
          environment: 'production'
        },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
          // Vars are for non-secret configuration
          vars: {
            ENVIRONMENT: 'production',
            CORS_ORIGIN: 'https://www.rnwolf.net' // From wrangler.jsonc production env
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