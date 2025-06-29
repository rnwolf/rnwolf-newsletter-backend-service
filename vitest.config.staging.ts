// vitest.config.staging.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Ensure environment is set for staging
process.env.ENVIRONMENT = 'staging';

export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup-staging.ts'],
    exclude: [
      '**/node_modules/**', // Exclude all files in node_modules
    ],
    poolOptions: {
      workers: {
        wrangler: {
          configPath: './wrangler.jsonc',
          environment: 'staging'  // Use staging environment from wrangler.jsonc
        },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
          // Explicitly set environment variables to ensure they override any defaults
          vars: {
            ENVIRONMENT: 'staging',
            API_BASE_URL: 'https://api-staging.rnwolf.net',
            CORS_ORIGIN: 'https://staging.rnwolf.net',
            API_VERSION: 'v1'
          },
          // Bindings are for secrets, KV, D1, etc.
          bindings: {
            HMAC_SECRET_KEY: process.env.HMAC_SECRET_KEY, // Value comes from dotenv
            GRAFANA_API_KEY: process.env.GRAFANA_API_KEY, // Value comes from dotenv
            TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
            MAILCHANNEL_API_KEY: process.env.MAILCHANNEL_API_KEY,
            SENDER_EMAIL: process.env.SENDER_EMAIL,
            SENDER_NAME: process.env.SENDER_NAME,
            MAILCHANNEL_AUTH_ID: process.env.MAILCHANNEL_AUTH_ID
          }
        },
      },
    },
  },
});