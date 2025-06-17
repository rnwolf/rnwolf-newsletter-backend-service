// tests/email-verification.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

interface VerificationResponse {
  success?: boolean;
  message?: string;
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

// Helper function to generate test verification token
function generateTestVerificationToken(email: string, secretKey: string = 'test-secret'): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const message = `${email}:${timestamp}`;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(`${token}:${timestamp}`).toString('base64url');
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

describe(`Email Verification Tests (${TEST_ENV} environment)`, () => {
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

  describe('Subscription with Email Verification', () => {
    it('should create unverified subscriber and queue verification email', async () => {
      const testEmail = generateTestEmail('verification-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as VerificationResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Please check your email and click the verification link');

      // For local tests, verify database state
      if (config.setupDatabase) {
        const subscriber = await env.DB.prepare(
          'SELECT * FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(subscriber).toBeTruthy();
        if (subscriber) {
          expect(subscriber.email).toBe(testEmail);
          expect(Boolean(subscriber.email_verified)).toBe(false);
          expect(subscriber.verification_token).toBeTruthy();
          expect(subscriber.verification_sent_at).toBeTruthy();
          expect(subscriber.verified_at).toBeNull();
        }

        // Verify queue was called
        expect(env.EMAIL_VERIFICATION_QUEUE.send).toHaveBeenCalledWith(
          expect.objectContaining({
            email: testEmail,
            verificationToken: expect.any(String)
          })
        );
      }
    });

    it('should update existing unverified subscriber', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('existing-unverified@example.com');
      const oldToken = 'old-token';

      // Insert existing unverified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, '2024-01-01T00:00:00Z', oldToken).run();

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(response.status).toBe(200);

      // Verify subscriber was updated with new token and timestamp
      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber?.verification_token).not.toBe(oldToken);
      expect(new Date(subscriber?.subscribed_at || '').getTime()).toBeGreaterThan(
        new Date('2024-01-01T00:00:00Z').getTime()
      );
    });

    it('should reactivate previously unsubscribed user as unverified', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('reactivate-test@example.com');

      // Insert unsubscribed user
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, email_verified)
        VALUES (?, ?, ?, TRUE)
      `).bind(testEmail, '2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z').run();

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      expect(response.status).toBe(200);

      // Verify user is resubscribed but unverified
      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber?.unsubscribed_at).toBeNull();
      expect(Boolean(subscriber?.email_verified)).toBe(false);
      expect(subscriber?.verification_token).toBeTruthy();
    });
  });

  describe('Email Verification Confirmation', () => {
    it('should verify email with valid token', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('verify-valid@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY);

      // Insert unverified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), token).run();

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('Email Confirmed!');
      expect(html).toContain('Your email address has been confirmed');
      expect(html).toContain(testEmail);

      // Verify database was updated
      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(Boolean(subscriber?.email_verified)).toBe(true);
      expect(subscriber?.verified_at).toBeTruthy();
      expect(subscriber?.verification_token).toBeNull();
    });

    it('should reject invalid verification tokens', async () => {
      const testEmail = generateTestEmail('verify-invalid@example.com');
      const invalidToken = 'invalid-token-123';

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${invalidToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Invalid or Expired Link');
      expect(html).toContain('This verification link is invalid or has expired');
    });

    it('should reject expired verification tokens', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('verify-expired@example.com');

      // Generate token with old timestamp (25 hours ago)
      const oldTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString();
      const crypto = require('crypto');
      const message = `${testEmail}:${oldTimestamp}`;
      const tokenHash = crypto.createHmac('sha256', env.HMAC_SECRET_KEY).update(message).digest('hex');
      const expiredToken = Buffer.from(`${tokenHash}:${oldTimestamp}`).toString('base64url');

      // Insert subscriber with expired token
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), expiredToken).run();

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${expiredToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Invalid or Expired Link');
    });

    it('should handle verification of non-existent email', async () => {
      const testEmail = generateTestEmail('nonexistent@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(404);

      const html = await response.text();
      expect(html).toContain('Subscription Not Found');
      expect(html).toContain('This email address was not found in our subscription list');
    });

    it('should handle verification of already verified email', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('already-verified@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY);

      // Insert already verified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token, verified_at)
        VALUES (?, ?, TRUE, ?, ?)
      `).bind(testEmail, new Date().toISOString(), token, new Date().toISOString()).run();

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('Already Confirmed');
      expect(html).toContain('Your email address was already confirmed');
    });

    it('should reject tokens that don\'t match database record', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('token-mismatch@example.com');
      const validToken = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY);
      const differentToken = generateTestVerificationToken('other@example.com', env.HMAC_SECRET_KEY);

      // Insert subscriber with different token
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), differentToken).run();

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${validToken}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Invalid Token');
      expect(html).toContain('This verification token does not match our records');
    });

    it('should handle missing verification parameters', async () => {
      // Missing both token and email
      const response1 = await makeRequest('/v1/newsletter/verify');
      expect(response1.status).toBe(400);

      // Missing email
      const response2 = await makeRequest('/v1/newsletter/verify?token=some-token');
      expect(response2.status).toBe(400);

      // Missing token
      const response3 = await makeRequest('/v1/newsletter/verify?email=test@example.com');
      expect(response3.status).toBe(400);

      // All should show missing parameters error
      for (const response of [response1, response2, response3]) {
        const html = await response.text();
        expect(html).toContain('Missing Parameters');
        expect(html).toContain('Both verification token and email are required');
      }
    });

    it('should only accept GET requests', async () => {
      const testEmail = generateTestEmail('get-only@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY || 'test-secret');
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const response = await makeRequest(
          `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`,
          { method }
        );

        expect(response.status).toBe(405);

        const html = await response.text();
        expect(html).toContain('Method Not Allowed');
      }
    });
  });

  describe('Token Generation and Security', () => {
    it('should generate unique tokens for different emails', async () => {
      const email1 = 'user1@example.com';
      const email2 = 'user2@example.com';
      const secret = 'test-secret';

      const token1 = generateTestVerificationToken(email1, secret);
      const token2 = generateTestVerificationToken(email2, secret);

      expect(token1).not.toBe(token2);
      expect(token1.length).toBeGreaterThan(0);
      expect(token2.length).toBeGreaterThan(0);
    });

    it('should generate different tokens for same email at different times', async () => {
      const email = 'test@example.com';
      const secret = 'test-secret';

      const token1 = generateTestVerificationToken(email, secret);

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 30));

      const token2 = generateTestVerificationToken(email, secret);

      expect(token1).not.toBe(token2);
    });

    it('should be URL-safe base64 encoded', async () => {
      const email = 'test@example.com';
      const token = generateTestVerificationToken(email, 'test-secret');

      // Should not contain URL-unsafe characters
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
      expect(token).not.toContain('=');

      // Should be valid base64url
      expect(() => {
        Buffer.from(token, 'base64url');
      }).not.toThrow();
    });
  });

  describe('HTML Response Quality', () => {
    it('should return well-formed HTML with proper structure', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('html-test@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY);

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testEmail, new Date().toISOString(), token).run();

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      const html = await response.text();

      // Check HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('</html>');

      // Check meta tags
      expect(html).toContain('<meta name="viewport"');
      expect(html).toContain('width=device-width, initial-scale=1.0');

      // Check styling
      expect(html).toContain('<style>');
      expect(html).toContain('font-family');
      expect(html).toContain('max-width');

      // Check content structure
      expect(html).toContain('Email Confirmed!');
      expect(html).toContain('What happens next?');
      expect(html).toContain('Return to main site');
    });

    it('should include proper error page structure', async () => {
      const response = await makeRequest('/v1/newsletter/verify?token=invalid&email=test@example.com');

      const html = await response.text();

      // Check error page structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Error - Newsletter Verification</title>');
      expect(html).toContain('Invalid or Expired Link');
      expect(html).toContain('Want to try again?');
      expect(html).toContain('Return to main site');
    });
  });

  describe('CORS Headers', () => {
    it('should allow any origin for verification endpoint', async () => {
      const response = await makeRequest('/v1/newsletter/verify?token=test&email=test@example.com', {
        headers: { 'Origin': 'https://mail.google.com' }
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle OPTIONS requests for verification endpoint', async () => {
      const response = await makeRequest('/v1/newsletter/verify', {
        method: 'OPTIONS',
        headers: { 'Origin': 'https://mail.client.com' }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      if (!config.setupDatabase) return;

      const testEmail = generateTestEmail('db-error@example.com');
      const token = generateTestVerificationToken(testEmail, env.HMAC_SECRET_KEY);

      // Mock database error
      const dbSpy = vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database unavailable');
      });

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`
      );

      expect(response.status).toBe(503);

      const html = await response.text();
      expect(html).toContain('Service Temporarily Unavailable');
      expect(html).toContain('Our verification service is temporarily unavailable');

      dbSpy.mockRestore();
    });

    it('should handle URL encoding edge cases', async () => {
      const specialEmail = 'user+test@domain.co.uk';
      const token = generateTestVerificationToken(specialEmail, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(
        `/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(specialEmail)}`
      );

      // Should not crash - either 404 (email not found) or proper verification
      expect(response.status).toBeLessThan(500);
    });
  });
});