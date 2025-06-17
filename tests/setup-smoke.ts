// tests/setup-smoke.ts - Only run minimal smoke tests in production
import { env } from 'cloudflare:test';

// We only validate they exist, don't set fallbacks
console.log('Setting up PRODUCTION smoke test environment...');

// Secrets must be properly configured in production environment
if (!env.HMAC_SECRET_KEY || !env.TURNSTILE_SECRET_KEY) {
  throw new Error('Production secrets not configured. Production smoke tests require proper secret configuration.');
}

if (!env.ENVIRONMENT) {
  env.ENVIRONMENT = 'production';
}

console.log('✓ Production smoke test environment validated');


// Minimal database setup for smoke tests (don't modify production data)
export async function setupSmokeTestEnvironment(): Promise<void> {
  console.log('Production smoke tests use existing database - no setup needed');
}