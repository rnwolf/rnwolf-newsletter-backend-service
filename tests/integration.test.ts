import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

interface SubscriptionResponse {
  success: boolean;
  message: string;
  troubleshootingUrl?: string;
  debug?: string;
}


interface HealthResponse {
  success: boolean;
  message: string;
  database: string;
  environment: string;
}

interface DatabaseRow {
  email: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  count?: number;
  [key: string]: unknown;
}

// Configuration based on environment
const TEST_CONFIG = {
  local: {
    baseUrl: 'http://localhost:8787',
    useWorkerFetch: true,
    setupDatabase: true,
    isLocal: true,
    corsOrigin: 'http://localhost:3000' // From wrangler.jsonc local env
  },
  staging: {
    baseUrl: 'https://api-staging.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    isLocal: false,
    corsOrigin: 'https://staging.rnwolf.net' // From wrangler.jsonc staging env
  },
  production: {
    baseUrl: 'https://api.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    isLocal: false,
    corsOrigin: 'https://www.rnwolf.net' // From wrangler.jsonc production env
  }
};

const TEST_ENV = (env.ENVIRONMENT || 'local') as keyof typeof TEST_CONFIG;
const config = TEST_CONFIG[TEST_ENV];

// Helper function to make requests
async function makeRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = `${config.baseUrl}${path}`;

  if (config.useWorkerFetch) {
    const request = new Request(url, options);
    return await worker.fetch(request, env);
  } else {
    return await fetch(url, options);
  }
}

// Helper function to generate valid HMAC token (matching both Python and Node.js)
function generateUnsubscribeToken(email: string, secretKey: string): string {
  const crypto = require('crypto');
  const token = crypto.createHmac('sha256', secretKey).update(email).digest('hex');
  // Use base64url without padding to match Python implementation
  return Buffer.from(token).toString('base64url');
}

describe(`Newsletter Integration Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);

      // Ensure HMAC_SECRET_KEY is set for testing
      if (!env.HMAC_SECRET_KEY) {
        (env as any).HMAC_SECRET_KEY = 'test-secret';
      }
    }
  });

  describe('Complete Newsletter Flow', () => {
    it('should handle full subscribe -> unsubscribe flow', async () => {
      const testEmail = TEST_ENV === 'local' ? 'integration-test@example.com' : `integration-${Date.now()}@example.com`;

      // Step 1: Subscribe to newsletter
      const subscribeResponse = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscribeResult = await subscribeResponse.json() as SubscriptionResponse;
      expect(subscribeResponse.status).toBe(200);
      expect(subscribeResult.success).toBe(true);
      expect(subscribeResult.message).toContain('Thank you for subscribing');

      // Step 2: Verify subscription in database (local only)
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        if (subscriber) {
          expect(subscriber.email).toBe(testEmail);
          expect(subscriber.subscribed_at).toBeTruthy();
          expect(subscriber.unsubscribed_at).toBeNull();
        }
      }

      // Step 3: Generate unsubscribe token
      const secretKey = env.HMAC_SECRET_KEY || 'test-secret';
      const unsubscribeToken = generateUnsubscribeToken(testEmail, secretKey);

      // Step 4: Unsubscribe using generated token
      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(200);
      expect(unsubscribeResponse.headers.get('content-type')).toContain('text/html');

      const unsubscribeHtml = await unsubscribeResponse.text();
      expect(unsubscribeHtml).toContain('Successfully Unsubscribed');
      expect(unsubscribeHtml).toContain('You have been unsubscribed from our newsletter');
      expect(unsubscribeHtml).toContain(testEmail);

      // Step 5: Verify unsubscription in database (local only)
      if (TEST_ENV === 'local') {
        const unsubscribedUser = await env.DB.prepare(
          'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(unsubscribedUser).toBeTruthy();
        if (unsubscribedUser) {
          expect(unsubscribedUser.email).toBe(testEmail);
          expect(unsubscribedUser.subscribed_at).toBeTruthy();
          expect(unsubscribedUser.unsubscribed_at).toBeTruthy();

          // Verify unsubscribe timestamp is recent
          if (unsubscribedUser.unsubscribed_at) {
            const unsubscribeTime = new Date(unsubscribedUser.unsubscribed_at).getTime();
            const now = Date.now();
            expect(unsubscribeTime).toBeGreaterThan(now - 10000); // Within last 10 seconds
          }
        }
      }
    });

    it('should handle resubscription after unsubscribe', async () => {
      const testEmail = TEST_ENV === 'local' ? 'resubscribe-test@example.com' : `resubscribe-${Date.now()}@example.com`;

      // Step 1: Initial subscription
      const subscribeResponse1 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(subscribeResponse1.status).toBe(200);

      // Step 2: Unsubscribe
      const secretKey = env.HMAC_SECRET_KEY || 'test-secret';
      const unsubscribeToken = generateUnsubscribeToken(testEmail, secretKey);

      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(200);

      // Step 3: Resubscribe
      const subscribeResponse2 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const resubscribeResult = await subscribeResponse2.json() as SubscriptionResponse;
      expect(subscribeResponse2.status).toBe(200);
      expect(resubscribeResult.success).toBe(true);

      // Step 4: Verify resubscription (local only)
      if (TEST_ENV === 'local') {
        const resubscribedUser = await env.DB.prepare(
          'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(resubscribedUser).toBeTruthy();
        if (resubscribedUser) {
          expect(resubscribedUser.email).toBe(testEmail);
          expect(resubscribedUser.subscribed_at).toBeTruthy();
          expect(resubscribedUser.unsubscribed_at).toBeNull(); // Should be null after resubscribing
        }
      }
    });

    it('should prevent unsubscribe with invalid token', async () => {
      const testEmail = TEST_ENV === 'local' ? 'invalid-token-test@example.com' : `invalid-${Date.now()}@example.com`;

      // Step 1: Subscribe first
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      // Step 2: Try to unsubscribe with invalid token
      const invalidToken = 'invalid-token-123';
      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${invalidToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(400);

      const html = await unsubscribeResponse.text();
      expect(html).toContain('Invalid Unsubscribe Link');
      expect(html).toContain('This unsubscribe link is invalid or has expired');

      // Step 3: Verify user is still subscribed (local only)
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(subscriber).toBeTruthy();
        if (subscriber) {
          expect(subscriber.unsubscribed_at).toBeNull(); // Should still be subscribed
        }
      }
    });

    it('should prevent unsubscribe with token for different email', async () => {
      const testEmail1 = TEST_ENV === 'local' ? 'email1@example.com' : `email1-${Date.now()}@example.com`;
      const testEmail2 = TEST_ENV === 'local' ? 'email2@example.com' : `email2-${Date.now()}@example.com`;

      // Step 1: Subscribe both emails
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail1 })
      });

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail2 })
      });

      // Step 2: Generate token for email1 but try to use it for email2
      const secretKey = env.HMAC_SECRET_KEY || 'test-secret';
      const tokenForEmail1 = generateUnsubscribeToken(testEmail1, secretKey);

      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${tokenForEmail1}&email=${encodeURIComponent(testEmail2)}`
      );

      expect(unsubscribeResponse.status).toBe(400);

      const html = await unsubscribeResponse.text();
      expect(html).toContain('Invalid Unsubscribe Link');

      // Step 3: Verify both users are still subscribed (local only)
      if (TEST_ENV === 'local') {
        const subscriber1 = await env.DB.prepare(
          'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail1).first() as DatabaseRow | null;

        const subscriber2 = await env.DB.prepare(
          'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(testEmail2).first() as DatabaseRow | null;

        expect(subscriber1?.unsubscribed_at).toBeNull();
        expect(subscriber2?.unsubscribed_at).toBeNull();
      }
    });
  });

  describe('Error Handling Integration', () => {
    it('should handle complete error scenarios gracefully', async () => {
      // Test missing parameters
      const missingParamsResponse = await makeRequest('/v1/newsletter/unsubscribe');
      expect(missingParamsResponse.status).toBe(400);

      const html = await missingParamsResponse.text();
      expect(html).toContain('Missing Parameters');
      expect(html).toContain('Both token and email parameters are required');

      // Test malformed email
      const malformedResponse = await makeRequest('/v1/newsletter/unsubscribe?token=test&email=');
      expect(malformedResponse.status).toBe(400);

      // Test non-existent email with valid token format
      const secretKey = env.HMAC_SECRET_KEY || 'test-secret';
      const nonExistentEmail = 'nonexistent@example.com';
      const validToken = generateUnsubscribeToken(nonExistentEmail, secretKey);

      const nonExistentResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${validToken}&email=${encodeURIComponent(nonExistentEmail)}`
      );

      expect(nonExistentResponse.status).toBe(404);

      const nonExistentHtml = await nonExistentResponse.text();
      expect(nonExistentHtml).toContain('Email Not Found');
    });
  });

  describe('CORS Integration', () => {
    it('should handle CORS correctly for subscription vs unsubscribe', async () => {
      // Test subscription CORS (restricted)
      const subscriptionOptions = await makeRequest('/v1/newsletter/subscribe', {
        method: 'OPTIONS',
        headers: { 'Origin': config.corsOrigin } // Use the dynamic origin for the current environment
      });

      expect(subscriptionOptions.status).toBe(200);
      expect(subscriptionOptions.headers.get('Access-Control-Allow-Origin')).toBe(config.corsOrigin); // Expect the dynamic origin

      // Test unsubscribe CORS (open)
      const unsubscribeOptions = await makeRequest('/v1/newsletter/unsubscribe', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://mail.google.com' }
      });

      expect(unsubscribeOptions.status).toBe(200);
      expect(unsubscribeOptions.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });
  });

  describe('Token Generation Compatibility', () => {
    it('should generate tokens compatible with Python newsletter script', async () => {
      const testEmail = 'python-compat@example.com';
      const secretKey = 'test-secret';

      // Generate token using the same logic as the worker
      const nodeToken = generateUnsubscribeToken(testEmail, secretKey);

      // This should match the Python implementation (without padding)
      expect(nodeToken).not.toContain('='); // No padding
      expect(nodeToken.length).toBeGreaterThan(0);

      // Token should be base64url encoded hex
      const tokenBuffer = Buffer.from(nodeToken, 'base64url');
      const decodedHex = tokenBuffer.toString();
      expect(decodedHex).toMatch(/^[0-9a-f]{64}$/); // 64 character hex string (SHA256)
    });

    it('should verify tokens generated by Python logic', async () => {
      if (TEST_ENV !== 'local') return;

      const testEmail = 'python-generated@example.com';

      // Subscribe first
      const subscribeResponse = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(subscribeResponse.status).toBe(200);

      // Use the same secret key as the environment (IMPORTANT!)
      const secretKey = env.HMAC_SECRET_KEY;

      // Simulate Python token generation (without padding)
      const crypto = require('crypto');
      const hmacHex = crypto.createHmac('sha256', secretKey).update(testEmail).digest('hex');
      const pythonStyleToken = Buffer.from(hmacHex).toString('base64url');

      // This token should work for unsubscribing
      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${pythonStyleToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(200);

      const html = await unsubscribeResponse.text();
      expect(html).toContain('Successfully Unsubscribed');
    });

  });

});