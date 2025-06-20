// vitest.config.local.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
// This configuration is for local development and testing
export default defineWorkersConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      '**/node_modules/**', // Exclude all files in node_modules
      '**/smoke-remote.test.ts', // Exclude remote smoke tests from local runs
    ],
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
            CORS_ORIGIN: 'http://localhost:3000', // From wrangler.jsonc local env
            MAILCHANNEL_API_KEY: process.env.MAILCHANNEL_API_KEY || 'local-mailchannel-dummy-key',
            SENDER_EMAIL: process.env.SENDER_EMAIL || 'noreply@local.dev',
            SENDER_NAME: process.env.SENDER_NAME || 'Local Test Newsletter',
            MAILCHANNEL_AUTH_ID: process.env.MAILCHANNEL_AUTH_ID || '', // Optional
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