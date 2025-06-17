// tests/email-verification-integration.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

interface SubscriptionResponse {
  success: boolean;
  message: string;
  troubleshootingUrl?: string;
}

interface DatabaseRow {
  email: string;
  email_verified: boolean;
  verification_token: string | null;
  verification_sent_at: string | null;
  verified_at: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  [key: string]: unknown;
}

// Configuration for testing
const TEST_CONFIG = {
  local: {
    baseUrl: 'http://localhost:8787',
    useWorkerFetch: true,
    setupDatabase: true
  },
  staging: {
    baseUrl: 'https://api-staging.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false
  },
  production: {
    baseUrl: 'https://api.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false
  }
};

const TEST_ENV = (process.env.TEST_ENV || 'local') as keyof typeof TEST_CONFIG;
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

// Helper to extract verification token from database
async function getVerificationToken(email: string): Promise<string | null> {
  if (!config.setupDatabase) return null;

  const result = await env.DB.prepare(
    'SELECT verification_token FROM subscribers WHERE email = ?'
  ).bind(email).first() as DatabaseRow | null;

  return result?.verification_token || null;
}

// Helper function to generate unique test emails
function generateTestEmail(base: string): string {
  if (config.setupDatabase) {
    return base;
  } else {
    const timestamp = Date.now();
    return base.replace('@', `-${timestamp}@`);
  }
}

describe(`Email Verification Integration Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);

      // Add verification fields to table
      try {
        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN email_verified BOOLEAN DEFAULT FALSE
        `).run();

        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN verification_token TEXT
        `).run();

        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN verification_sent_at DATETIME
        `).run();

        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN verified_at DATETIME
        `).run();
      } catch (error) {
        // Columns might already exist, ignore error
      }

      // Set test environment variables
      if (!env.HMAC_SECRET_KEY) {
        (env as any).HMAC_SECRET_KEY = 'test-secret';
      }
      if (!env.EMAIL_VERIFICATION_QUEUE) {
        // Mock the queue for local testing
        (env as any).EMAIL_VERIFICATION_QUEUE = {
          send: vi.fn().mockResolvedValue({}),
        };
      }
    }
  });


  describe('Complete Email Verification Workflow', () => {
    it('should handle full subscribe → verify → confirmed flow', async () => {
      const testEmail = generateTestEmail('full-flow@example.com');

      // Step 1: Subscribe to newsletter (should create unverified subscriber)
      const subscribeResponse = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscribeResult = await subscribeResponse.json() as SubscriptionResponse;
      expect(subscribeResponse.status).toBe(200);
      expect(subscribeResult.success).toBe(true);
      expect(subscribeResult.message).toContain('Please check your email and click the verification link');

      // For local tests, continue with verification flow
      if (config.setupDatabase) {
        // Step 2: Verify subscriber is in database as unverified
        const subscriber1 = await env.DB.prepare(
          'SELECT * FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(subscriber1).toBeTruthy();
        expect(Boolean(subscriber1?.email_verified)).toBe(false);
        expect(subscriber1?.verification_token).toBeTruthy();
        expect(subscriber1?.verified_at).toBeNull();

        // Step 3: Verify email using token from database
        const verificationToken = subscriber1?.verification_token;
        expect(verificationToken).toBeTruthy();

        const verifyResponse = await makeRequest(
          `/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(testEmail)}`
        );

        expect(verifyResponse.status).toBe(200);
        expect(verifyResponse.headers.get('content-type')).toContain('text/html');

        const verifyHtml = await verifyResponse.text();
        expect(verifyHtml).toContain('Email Confirmed!');
        expect(verifyHtml).toContain('Your email address has been confirmed');

        // Step 4: Verify subscriber is now confirmed in database
        const subscriber2 = await env.DB.prepare(
          'SELECT * FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(Boolean(subscriber2?.email_verified)).toBe(true);
        expect(subscriber2?.verified_at).toBeTruthy();
        expect(subscriber2?.verification_token).toBeNull(); // Should be cleared
        expect(subscriber2?.unsubscribed_at).toBeNull(); // Still subscribed
      }
    });

    it('should handle subscribe → verify → unsubscribe → resubscribe flow', async () => {
      if (!config.setupDatabase) return; // Local only

      const testEmail = generateTestEmail('resubscribe-flow@example.com');

      // Step 1: Initial subscription
      const subscribeResponse1 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(subscribeResponse1.status).toBe(200);

      // Step 2: Verify email
      const token1 = await getVerificationToken(testEmail);
      expect(token1).toBeTruthy();

      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${token1}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse.status).toBe(200);

      // Verify user is confirmed
      const subscriber1 = await env.DB.prepare(
        'SELECT email_verified, verified_at FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber1?.email_verified)).toBe(true);
      expect(subscriber1?.verified_at).toBeTruthy();

      // Step 3: Unsubscribe
      const crypto = require('crypto');
      const unsubToken = crypto.createHmac('sha256', env.HMAC_SECRET_KEY).update(testEmail).digest('hex');
      const unsubscribeToken = Buffer.from(unsubToken).toString('base64url');

      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(200);

      // Step 4: Resubscribe (should create new unverified subscription)
      const subscribeResponse2 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(subscribeResponse2.status).toBe(200);

      // Verify user is unverified again (requires new verification)
      const subscriber2 = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber2?.email_verified)).toBe(false); // Reset to unverified
      expect(subscriber2?.verification_token).toBeTruthy(); // New token
      expect(subscriber2?.unsubscribed_at).toBeNull(); // Resubscribed

      // Step 5: Verify again with new token
      const token2 = subscriber2?.verification_token;
      const verifyResponse2 = await makeRequest(
        `/v1/newsletter/verify?token=${token2}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse2.status).toBe(200);

      // Final verification
      const subscriber3 = await env.DB.prepare(
        'SELECT email_verified FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber3?.email_verified)).toBe(true);
    });

    it('should prevent access to newsletters for unverified subscribers', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('unverified-access@example.com');

      // Step 1: Subscribe but don't verify
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      // Step 2: Check subscriber status
      const subscriber = await env.DB.prepare(
        'SELECT email_verified, verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber?.email_verified)).toBe(false);
      expect(subscriber?.verification_token).toBeTruthy();

      // Note: In a real implementation, you would:
      // - Filter out unverified subscribers from newsletter sending scripts
      // - Only send newsletters to subscribers where email_verified = TRUE
      // This test documents the expected behavior
    });

    it('should handle duplicate verification attempts gracefully', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('duplicate-verify@example.com');

      // Step 1: Subscribe
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const token = await getVerificationToken(testEmail);

      // Step 2: First verification
      const verifyResponse1 = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse1.status).toBe(200);

      // Step 3: Second verification with same token
      const verifyResponse2 = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse2.status).toBe(200); // Should still succeed

      const html = await verifyResponse2.text();
      expect(html).toContain('Already Confirmed');
      expect(html).toContain('Your email address was already confirmed');
    });

    it('should handle verification with expired tokens', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('expired-token@example.com');

      // Create an expired token (25 hours old)
      const crypto = require('crypto');
      const oldTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString(); // 25 hours ago
      const message = `${testEmail}:${oldTimestamp}`;
      const tokenHash = crypto.createHmac('sha256', env.HMAC_SECRET_KEY).update(message).digest('hex');
      const expiredToken = Buffer.from(`${tokenHash}:${oldTimestamp}`).toString('base64url');

      // Insert subscriber with expired token
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), expiredToken).run();

      // Try to verify with expired token
      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${expiredToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse.status).toBe(400);

      const html = await verifyResponse.text();
      expect(html).toContain('Invalid or Expired Link');
      expect(html).toContain('This verification link is invalid or has expired');

      // Subscriber should remain unverified
      const subscriber = await env.DB.prepare(
        'SELECT email_verified FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber?.email_verified)).toBe(false);
    });
  });

  describe('Security and Edge Cases', () => {
    it('should prevent verification token reuse across different emails', async () => {
      if (!config.setupDatabase) return;

      const email1 = generateTestEmail('security1@example.com');
      const email2 = generateTestEmail('security2@example.com');

      // Subscribe both emails
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email1 })
      });

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email2 })
      });

      // Get token for email1
      const token1 = await getVerificationToken(email1);

      // Try to use email1's token to verify email2
      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${token1}&email=${encodeURIComponent(email2)}`
      );

      expect(verifyResponse.status).toBe(400);

      const html = await verifyResponse.text();
      expect(html).toContain('Invalid or Expired Link');
      //expect(html).toContain('This verification token does not match our records');

      // Neither email should be verified
      const subscriber1 = await env.DB.prepare(
        'SELECT email_verified FROM subscribers WHERE email = ?'
      ).bind(email1).first() as DatabaseRow | null;

      const subscriber2 = await env.DB.prepare(
        'SELECT email_verified FROM subscribers WHERE email = ?'
      ).bind(email2).first() as DatabaseRow | null;

      expect(Boolean(subscriber1?.email_verified)).toBe(false);
      expect(Boolean(subscriber2?.email_verified)).toBe(false);
    });

    it('should handle verification attempts for deleted/modified subscribers', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('deleted-subscriber@example.com');

      // Subscribe user
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const token = await getVerificationToken(testEmail);

      // Simulate subscriber being deleted (edge case)
      await env.DB.prepare('DELETE FROM subscribers WHERE email = ?').bind(testEmail).run();

      // Try to verify deleted subscriber
      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse.status).toBe(404);

      const html = await verifyResponse.text();
      expect(html).toContain('Subscription Not Found');
      expect(html).toContain('This email address was not found in our subscription list');
    });

    it('should handle malformed verification tokens gracefully', async () => {
      const testEmail = 'malformed-test@example.com';

      // Insert a subscriber to ensure the email exists
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), 'some-valid-token').run();

      // Test malformed tokens that should return "Invalid or Expired"
      const malformedTokens = [
        'invalid-token-format',      // Plain text, not base64
        'not-a-token',              // Another plain text
        'MTIz',                     // Valid base64 but wrong structure
        Buffer.from('malformed:data').toString('base64url'), // Valid base64, wrong format
      ];

      for (const malformedToken of malformedTokens) {
        const verifyResponse = await worker.fetch(
          new Request(`http://localhost:8787/v1/newsletter/verify?token=${malformedToken}&email=${encodeURIComponent(testEmail)}`),
          env
        );

        expect(verifyResponse.status).toBe(400);
        const html = await verifyResponse.text();

        // Malformed tokens should return "Invalid or Expired" because the token parameter exists but is invalid
        expect(html).toContain('Invalid or Expired Link');
      }
    });

    it('should handle missing verification parameters gracefully', async () => {
      const testEmail = 'missing-param-test@example.com';

      // Test cases that should return "Missing Parameters"
      const missingParamCases = [
        {
          name: 'Missing both parameters',
          url: '/v1/newsletter/verify'
        },
        {
          name: 'Missing token parameter',
          url: `/v1/newsletter/verify?email=${encodeURIComponent(testEmail)}`
        },
        {
          name: 'Missing email parameter',
          url: '/v1/newsletter/verify?token=some-token'
        },
        {
          name: 'Empty token parameter',
          url: `/v1/newsletter/verify?token=&email=${encodeURIComponent(testEmail)}`
        },
        {
          name: 'Empty email parameter',
          url: '/v1/newsletter/verify?token=some-token&email='
        }
      ];

      for (const testCase of missingParamCases) {
        const verifyResponse = await worker.fetch(
          new Request(`http://localhost:8787${testCase.url}`),
          env
        );

        expect(verifyResponse.status).toBe(400);
        const html = await verifyResponse.text();

        // Missing parameters should return "Missing Parameters"
        expect(html).toContain('Missing Parameters');
      }
    });


    it('should handle special characters in email addresses', async () => {
      if (!config.setupDatabase) return;

      const specialEmails = [
        'user+tag@domain.com',
        'user.name@domain.co.uk',
        'user_name@domain-name.org'
      ];

      for (const email of specialEmails) {
        const testEmail = generateTestEmail(email);

        // Subscribe
        const subscribeResponse = await makeRequest('/v1/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: testEmail })
        });

        expect(subscribeResponse.status).toBe(200);

        // Get token and verify
        const token = await getVerificationToken(testEmail);
        expect(token).toBeTruthy();

        const verifyResponse = await makeRequest(
          `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
        );

        expect(verifyResponse.status).toBe(200);

        const subscriber = await env.DB.prepare(
          'SELECT email_verified FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(Boolean(subscriber?.email_verified)).toBe(true);
      }
    });
  });

  describe('CORS and HTTP Method Handling', () => {
    it('should handle CORS correctly for verification endpoint', async () => {
      const testEmail = generateTestEmail('cors-test@example.com');

      // Test with email client origin
      const response = await makeRequest(
        `/v1/newsletter/verify?token=test-token&email=${encodeURIComponent(testEmail)}`,
        {
          headers: { 'Origin': 'https://mail.google.com' }
        }
      );

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should reject non-GET requests to verification endpoint', async () => {
      const testEmail = generateTestEmail('method-test@example.com');
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const response = await makeRequest(
          `/v1/newsletter/verify?token=test-token&email=${encodeURIComponent(testEmail)}`,
          { method }
        );

        expect(response.status).toBe(405);

        const html = await response.text();
        expect(html).toContain('Method Not Allowed');
      }
    });
  });

  describe('Database State Management', () => {
    it('should maintain data consistency during verification', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('consistency@example.com');

      // Subscribe
      const subscribeTime = new Date().toISOString();
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      // Get initial state
      const subscriber1 = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber1?.subscribed_at).toBeTruthy();
      expect(Boolean(subscriber1?.email_verified)).toBe(false);
      expect(subscriber1?.verification_token).toBeTruthy();
      expect(subscriber1?.verified_at).toBeNull();

      // Verify
      const token = subscriber1?.verification_token;
      await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      // Check final state
      const subscriber2 = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber2?.email).toBe(testEmail);
      expect(subscriber2?.subscribed_at).toBe(subscriber1?.subscribed_at); // Unchanged
      expect(Boolean(subscriber2?.email_verified)).toBe(true); // Changed
      expect(subscriber2?.verification_token).toBeNull(); // Cleared
      expect(subscriber2?.verified_at).toBeTruthy(); // Set
      expect(subscriber2?.unsubscribed_at).toBeNull(); // Unchanged
    });

    it('should handle concurrent verification attempts', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('concurrent@example.com');

      // Subscribe
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const token = await getVerificationToken(testEmail);

      // Simulate concurrent verification requests
      const verifyPromises = Array.from({ length: 3 }, () =>
        makeRequest(`/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`)
      );

      const responses = await Promise.all(verifyPromises);

      // All should succeed (first one verifies, others show "already confirmed")
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Final state should be verified
      const subscriber = await env.DB.prepare(
        'SELECT email_verified, verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber?.email_verified)).toBe(true);
      expect(subscriber?.verification_token).toBeNull();
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle database errors during verification gracefully', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('db-error@example.com');

      // Generate a valid token manually
      const crypto = require('crypto');
      const timestamp = Date.now().toString();
      const message = `${testEmail}:${timestamp}`;
      const tokenHash = crypto.createHmac('sha256', env.HMAC_SECRET_KEY).update(message).digest('hex');
      const validToken = Buffer.from(`${tokenHash}:${timestamp}`).toString('base64url');

      // Mock database error
      const dbSpy = vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${validToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse.status).toBe(503);

      const html = await verifyResponse.text();
      expect(html).toContain('Service Temporarily Unavailable');
      expect(html).toContain('Our verification service is temporarily unavailable');

      dbSpy.mockRestore();
    });

    it('should provide helpful error messages for common issues', async () => {
      const testEmail = generateTestEmail('helpful-errors@example.com');

      // Test missing parameters
      const scenarios = [
        {
          url: '/v1/newsletter/verify',
          expectedError: 'Missing Parameters'
        },
        {
          url: `/v1/newsletter/verify?token=test-token`,
          expectedError: 'Missing Parameters'
        },
        {
          url: `/v1/newsletter/verify?email=${encodeURIComponent(testEmail)}`,
          expectedError: 'Missing Parameters'
        },
        {
          url: `/v1/newsletter/verify?token=invalid&email=${encodeURIComponent(testEmail)}`,
          expectedError: 'Invalid or Expired Link'
        }
      ];

      for (const scenario of scenarios) {
        const response = await makeRequest(scenario.url);
        const html = await response.text();
        expect(html).toContain(scenario.expectedError);
        expect(html).toContain('Return to main site'); // Should have recovery option
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle verification requests efficiently', async () => {
      if (!config.setupDatabase) return;

      const testEmails = Array.from({ length: 10 }, (_, i) =>
        generateTestEmail(`perf-test-${i}@example.com`)
      );

      // Subscribe all users
      for (const email of testEmails) {
        await makeRequest('/v1/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
      }

      // Verify all users concurrently
      const startTime = Date.now();
      const verifyPromises = testEmails.map(async (email) => {
        const token = await getVerificationToken(email);
        return makeRequest(`/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(email)}`);
      });

      const responses = await Promise.all(verifyPromises);
      const duration = Date.now() - startTime;

      // Performance assertions
      expect(duration).toBeLessThan(3000); // Should complete within 3 seconds
      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Verify all users are confirmed
      for (const email of testEmails) {
        const subscriber = await env.DB.prepare(
          'SELECT email_verified FROM subscribers WHERE email = ?'
        ).bind(email).first() as DatabaseRow | null;

        expect(Boolean(subscriber?.email_verified)).toBe(true);
      }
    });
  });

  describe('Integration with Existing Newsletter Infrastructure', () => {
    it('should maintain compatibility with existing unsubscribe flow', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('unsubscribe-compat@example.com');

      // Subscribe and verify
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const token = await getVerificationToken(testEmail);
      await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      // Verify user is confirmed
      const subscriber1 = await env.DB.prepare(
        'SELECT email_verified FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber1?.email_verified)).toBe(true);

      // Test unsubscribe still works
      const crypto = require('crypto');
      const unsubToken = crypto.createHmac('sha256', env.HMAC_SECRET_KEY).update(testEmail).digest('hex');
      const unsubscribeToken = Buffer.from(unsubToken).toString('base64url');

      const unsubscribeResponse = await makeRequest(
        `/v1/newsletter/unsubscribe?token=${unsubscribeToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(unsubscribeResponse.status).toBe(200);

      // Verify user is unsubscribed but verification status preserved
      const subscriber2 = await env.DB.prepare(
        'SELECT email_verified, unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber2?.email_verified)).toBe(true); // Verification status preserved
      expect(subscriber2?.unsubscribed_at).toBeTruthy(); // But user is unsubscribed
    });

    it('should work with newsletter sender script filtering', async () => {
      if (!config.setupDatabase) return;

      // Create test scenario with mixed verification statuses
      const verifiedEmail = generateTestEmail('verified@example.com');
      const unverifiedEmail = generateTestEmail('unverified@example.com');

      // Insert both users directly
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, TRUE, NULL)
      `).bind(verifiedEmail, new Date().toISOString()).run();

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, 'unverified-token')
      `).bind(unverifiedEmail, new Date().toISOString()).run();

      // Query for verified subscribers only (what newsletter script should do)
      const verifiedSubscribers = await env.DB.prepare(`
        SELECT email FROM subscribers
        WHERE email_verified = TRUE
        AND unsubscribed_at IS NULL
      `).all();

      expect(verifiedSubscribers.results).toHaveLength(1);
      expect((verifiedSubscribers.results[0] as any).email).toBe(verifiedEmail);

      // Query for all subscribers (what we DON'T want to send to)
      const allSubscribers = await env.DB.prepare(`
        SELECT email FROM subscribers
        WHERE unsubscribed_at IS NULL
      `).all();

      expect(allSubscribers.results).toHaveLength(2);

      // This test documents that the newsletter script should filter by email_verified = TRUE
    });
  });

});