// vitest.config.production.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
// This configuration is for production smoke tests
export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup-smoke.ts'], // Different setup for production smoke tests
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
          environment: 'production'
        },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
          vars: {
            ENVIRONMENT: 'production'
          }
        },
      },
    },
  },
});