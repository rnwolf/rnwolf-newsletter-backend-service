// tests/subscription-with-verification.test.ts
// TDD Red Phase: Tests for updated subscription flow with email verification
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

interface SubscriptionResponse {
  success: boolean;
  message: string;
  troubleshootingUrl?: string;
  debug?: string;
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

interface QueueMessage {
  email: string;
  verificationToken: string;
  subscribedAt: string;
  metadata: {
    ipAddress: string;
    userAgent: string;
    country: string;
  };
}

// Configuration based on environment
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

// Helper function to generate unique test emails
function generateTestEmail(base: string): string {
  if (config.setupDatabase) {
    return base;
  } else {
    const timestamp = Date.now();
    return base.replace('@', `-${timestamp}@`);
  }
}

describe(`Updated Subscription Flow with Email Verification (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Mock for consistent token generation
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = 42; // Deterministic value
      }
      return array;
    });

    if (config.setupDatabase) {
      await setupTestDatabase(env);

      // Add verification fields to table (matching C4 model schema)
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

  describe('Subscription Creates Unverified Users (C4 Model Phase 1)', () => {

    it('debug environment variables', () => {
      console.log('env.HMAC_SECRET_KEY:', env.HMAC_SECRET_KEY);
      console.log('env.ENVIRONMENT:', env.ENVIRONMENT);
      console.log('All env vars:', Object.keys(env));
    });

    it('should create unverified subscriber on subscription', async () => {
      const testEmail = generateTestEmail('unverified-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // NEW BEHAVIOR: Should mention email verification
      expect(result.message).toContain('Please check your email');
      expect(result.message).toContain('verification link');
      expect(result.message).toContain('complete your subscription');

      // OLD BEHAVIOR: Should NOT say "Thank you for subscribing"
      expect(result.message).not.toContain('You\'ll receive our monthly newsletter');

      // For local tests, verify database state
      if (config.setupDatabase) {
        const subscriber = await env.DB.prepare(
          'SELECT * FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(subscriber).toBeTruthy();
        if (subscriber) {
          // CRITICAL: Should be unverified initially
          expect(Boolean(subscriber.email_verified)).toBe(false);
          expect(subscriber.verification_token).toBeTruthy();
          expect(subscriber.verification_sent_at).toBeTruthy();
          expect(subscriber.verified_at).toBeNull();

          // Should still record subscription attempt
          expect(subscriber.subscribed_at).toBeTruthy();
          expect(subscriber.unsubscribed_at).toBeNull();
        }
      }
    });

    it('should generate valid verification token on subscription', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('token-test@example.com');

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscriber = await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber?.verification_token).toBeTruthy();

      // Verify token format (should be base64url encoded)
      const token = subscriber?.verification_token;
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // base64url pattern
      expect(token?.length).toBeGreaterThan(20); // Reasonable length

      // Verify token can be decoded (basic format check)
      expect(() => {
        Buffer.from(token!, 'base64url');
      }).not.toThrow();
    });

    it('should set verification_sent_at timestamp on subscription', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('timestamp-test@example.com');
      const beforeSubscription = Date.now();

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const afterSubscription = Date.now();

      const subscriber = await env.DB.prepare(
        'SELECT verification_sent_at FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber?.verification_sent_at).toBeTruthy();

      const sentAt = new Date(subscriber?.verification_sent_at!).getTime();
      expect(sentAt).toBeGreaterThan(beforeSubscription - 1000); // Allow 1s margin
      expect(sentAt).toBeLessThan(afterSubscription + 1000);
    });

    it('should update existing unverified subscriber with new token', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('existing-unverified@example.com');
      const oldToken = 'old-verification-token';

      // Insert existing unverified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token, verification_sent_at)
        VALUES (?, ?, FALSE, ?, ?)
      `).bind(testEmail, '2024-01-01T00:00:00Z', oldToken, '2024-01-01T00:00:00Z').run();

      // Subscribe again
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      // Should have new token and timestamps
      expect(subscriber?.verification_token).not.toBe(oldToken);
      expect(subscriber?.verification_token).toBeTruthy();
      expect(new Date(subscriber?.verification_sent_at!).getTime()).toBeGreaterThan(
        new Date('2024-01-01T00:00:00Z').getTime()
      );
      expect(new Date(subscriber?.subscribed_at!).getTime()).toBeGreaterThan(
        new Date('2024-01-01T00:00:00Z').getTime()
      );

      // Should still be unverified
      expect(Boolean(subscriber?.email_verified)).toBe(false);
      expect(subscriber?.verified_at).toBeNull();
    });

    it('should reset previously verified subscriber to unverified on resubscription', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('reset-verified@example.com');

      // Insert verified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verified_at, unsubscribed_at)
        VALUES (?, ?, TRUE, ?, ?)
      `).bind(testEmail, '2024-01-01T00:00:00Z', '2024-01-01T01:00:00Z', '2024-06-01T00:00:00Z').run();

      // Resubscribe
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      // Should be reset to unverified state
      expect(Boolean(subscriber?.email_verified)).toBe(false);
      expect(subscriber?.verification_token).toBeTruthy();
      expect(subscriber?.verification_sent_at).toBeTruthy();
      expect(subscriber?.verified_at).toBeNull(); // TODO: Fix subscription logic to reset verified_at
      //expect(subscriber?.verified_at).toBeTruthy(); // Currently not being reset
      expect(subscriber?.unsubscribed_at).toBeNull(); // Resubscribed

      // Should have updated subscription timestamp
      expect(new Date(subscriber?.subscribed_at!).getTime()).toBeGreaterThan(
        new Date('2024-01-01T00:00:00Z').getTime()
      );
    });
  });

  describe('Queue Integration (C4 Model Phase 1)', () => {
    it('should queue verification email on subscription', async () => {
      const testEmail = generateTestEmail('queue-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.168.1.100',
          'User-Agent': 'Mozilla/5.0 Test Browser',
          'CF-IPCountry': 'US'
        },
        body: JSON.stringify({ email: testEmail })
      });

      expect(response.status).toBe(200);

      // For local tests, verify queue was called
      if (config.setupDatabase) {
        expect(env.EMAIL_VERIFICATION_QUEUE.send).toHaveBeenCalledWith(
          expect.objectContaining({
            email: testEmail,
            verificationToken: expect.any(String),
            subscribedAt: expect.any(String),
            metadata: expect.objectContaining({
              ipAddress: '192.168.1.100',
              userAgent: 'Mozilla/5.0 Test Browser',
              country: 'US'
            })
          })
        );

        // Verify token in queue message matches database
        const queueCall = (env.EMAIL_VERIFICATION_QUEUE.send as any).mock.calls[0][0] as QueueMessage;
        const subscriber = await env.DB.prepare(
          'SELECT verification_token FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(queueCall.verificationToken).toBe(subscriber?.verification_token);
      }
    });

    it('should include all required metadata in queue message', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('metadata-test@example.com');

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '203.0.113.42',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'CF-IPCountry': 'AU'
        },
        body: JSON.stringify({ email: testEmail })
      });

      const queueCall = (env.EMAIL_VERIFICATION_QUEUE.send as any).mock.calls[0][0] as QueueMessage;

      expect(queueCall).toMatchObject({
        email: testEmail,
        verificationToken: expect.any(String),
        subscribedAt: expect.any(String),
        metadata: {
          ipAddress: '203.0.113.42',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          country: 'AU'
        }
      });

      // Verify subscribedAt is valid ISO timestamp
      expect(() => new Date(queueCall.subscribedAt)).not.toThrow();
      expect(new Date(queueCall.subscribedAt).getTime()).toBeGreaterThan(Date.now() - 5000);
    });

    it('should handle queue failures gracefully', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('queue-failure@example.com');

      // Mock queue failure
      (env.EMAIL_VERIFICATION_QUEUE.send as any).mockRejectedValueOnce(
        new Error('Queue service unavailable')
      );

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      // Should still return success (graceful degradation)
      expect(response.status).toBe(200);

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(true);

      // But should indicate verification email issue
      expect(result.message).toMatch(/verification|check.*email/);
      expect(result.message).toMatch(/verification email|check.*email|try.*again|contact.*support/i);

      // Subscriber should still be created in database
      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber).toBeTruthy();
      expect(Boolean(subscriber?.email_verified)).toBe(false);
      expect(subscriber?.verification_token).toBeTruthy();
    });

    it('should not queue email if database operation fails', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('db-failure@example.com');

      // Mock database failure
      const dbSpy = vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      // Should return error
      expect(response.status).toBe(500);

      // Should not have called queue
      expect(env.EMAIL_VERIFICATION_QUEUE.send).not.toHaveBeenCalled();

      dbSpy.mockRestore();
    });
  });

  describe('Response Messages (C4 Model Compliance)', () => {
    it('should return verification instruction message', async () => {
      const testEmail = generateTestEmail('message-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Should contain verification instructions
      expect(result.message).toContain('Please check your email');
      expect(result.message).toContain('verification link');
      expect(result.message).toContain('complete your subscription');

      // Should not contain old subscription confirmation
      expect(result.message).not.toContain('monthly newsletter');
      expect(result.message).not.toContain('interesting content and links');
    });

    it('should provide helpful message for queue failures', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('queue-message-test@example.com');

      // Mock queue failure
      (env.EMAIL_VERIFICATION_QUEUE.send as any).mockRejectedValueOnce(
        new Error('Queue unavailable')
      );

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Should explain the issue and provide next steps
      expect(result.message).toMatch(/verification|check.*email/);
      expect(result.message).toMatch(/verification email|check.*email|try.*again|contact.*support/i);
    });

    it('should maintain CORS headers with new response', async () => {
      const testEmail = generateTestEmail('cors-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.rnwolf.net'
        },
        body: JSON.stringify({ email: testEmail })
      });

      expect(response.status).toBe(200);

      // CORS headers should still be present
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.rnwolf.net');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');

      const result = await response.json() as SubscriptionResponse;
      expect(result.message).toContain('verification link');
    });
  });

  describe('Backward Compatibility and Edge Cases', () => {
    it('should handle subscription without Turnstile token (if applicable)', async () => {
      const testEmail = generateTestEmail('no-turnstile@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail
          // No turnstileToken
        })
      });

      expect(response.status).toBe(200);

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(true);
      expect(result.message).toContain('verification link');

      if (config.setupDatabase) {
        const subscriber = await env.DB.prepare(
          'SELECT email_verified FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(Boolean(subscriber?.email_verified)).toBe(false);
      }
    });

    it('should handle subscription with Turnstile token', async () => {
      const testEmail = generateTestEmail('with-turnstile@example.com');

      // Mock successful Turnstile verification for local tests
      if (config.setupDatabase) {
        global.fetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );
      }

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          turnstileToken: 'valid-token-123'
        })
      });

      expect(response.status).toBe(200);

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(true);
      expect(result.message).toContain('verification link');

      if (config.setupDatabase) {
        const subscriber = await env.DB.prepare(
          'SELECT email_verified FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(Boolean(subscriber?.email_verified)).toBe(false);
      }
    });

    it('should maintain existing error handling for invalid emails', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      });

      expect(response.status).toBe(400);

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email address');

      // Should not have attempted to queue email
      if (config.setupDatabase) {
        expect(env.EMAIL_VERIFICATION_QUEUE.send).not.toHaveBeenCalled();
      }
    });

    it('should handle missing email field correctly', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // No email field
      });

      expect(response.status).toBe(400);

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(false);
      expect(result.message).toContain('Email address is required');

      // Should not have attempted to queue email
      if (config.setupDatabase) {
        expect(env.EMAIL_VERIFICATION_QUEUE.send).not.toHaveBeenCalled();
      }
    });
  });

  describe('Security and Token Generation', () => {
    it('should generate unique tokens for different emails', async () => {
      if (!config.setupDatabase) return;

      const email1 = generateTestEmail('unique1@example.com');
      const email2 = generateTestEmail('unique2@example.com');

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

      const subscriber1 = await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(email1).first() as DatabaseRow | null;

      const subscriber2 = await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(email2).first() as DatabaseRow | null;

      expect(subscriber1?.verification_token).toBeTruthy();
      expect(subscriber2?.verification_token).toBeTruthy();
      expect(subscriber1?.verification_token).not.toBe(subscriber2?.verification_token);
    });

    it('should generate different tokens for same email on multiple subscriptions', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('multiple-tokens@example.com');

      // First subscription
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const firstToken = (await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null)?.verification_token;

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      // Second subscription
      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const secondToken = (await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null)?.verification_token;

      expect(firstToken).toBeTruthy();
      expect(secondToken).toBeTruthy();
      expect(firstToken).not.toBe(secondToken);
    });

    it('should generate tokens that pass verification endpoint validation', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('validation-test@example.com');

      await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const subscriber = await env.DB.prepare(
        'SELECT verification_token FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      const token = subscriber?.verification_token;
      expect(token).toBeTruthy();

      // Test that the generated token works with verification endpoint
      const verifyResponse = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(verifyResponse.status).toBe(200);

      const verifyHtml = await verifyResponse.text();
      expect(verifyHtml).toContain('Email Confirmed!');
    });
  });
});