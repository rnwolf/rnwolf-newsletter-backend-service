// vitest.config.local.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
// This configuration is for local development and testing
export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
          vars: {
            ENVIRONMENT: 'local',
            HMAC_SECRET_KEY: 'local-test-secret',
            // Use environment variables with fallbacks for local testing
            TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || 'local-test-turnstile'
          },
          queues: [
            {
              name: 'email-verification-queue',
              binding: 'EMAIL_VERIFICATION_QUEUE'
            }
          ],
          bindings: {
            EMAIL_VERIFICATION_QUEUE_CONSUMER: {
              type: 'queue',
              queueName: 'email-verification-queue'
            }
          }
        },
      },
    },
  },
});