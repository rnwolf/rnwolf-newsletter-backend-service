import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

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

// Helper function to generate valid HMAC token for testing
function generateTestUnsubscribeToken(email: string, secretKey: string = 'test-secret'): string {
  const crypto = require('crypto');
  const message = email;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(token).toString('base64url');
}

describe(`Unsubscribe Worker Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);

      // Insert test subscribers
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
        VALUES (?, ?, NULL, '192.168.1.1', 'GB')
      `).bind('subscribed@example.com', new Date().toISOString()).run();

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
        VALUES (?, ?, ?, '192.168.1.2', 'US')
      `).bind('already-unsubscribed@example.com', '2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z').run();
    }
  });


  describe('Token Validation', () => {
    it('should accept valid HMAC tokens', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');

      // For local tests, verify database was updated
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(email).first();

        expect(subscriber.unsubscribed_at).toBeTruthy();
      }
    });

    it('should reject invalid HMAC tokens', async () => {
      const email = 'subscribed@example.com';
      const invalidToken = 'invalid-token-123';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${invalidToken}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
      expect(html).toContain('This unsubscribe link is invalid or has expired');
    });

    it('should reject tokens generated with wrong secret', async () => {
      const email = 'subscribed@example.com';
      const wrongSecretToken = generateTestUnsubscribeToken(email, 'wrong-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${wrongSecretToken}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should reject tokens for different email addresses', async () => {
      const originalEmail = 'subscribed@example.com';
      const differentEmail = 'different@example.com';
      const token = generateTestUnsubscribeToken(originalEmail, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(differentEmail)}`);

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should handle missing token parameter', async () => {
      const email = 'subscribed@example.com';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Missing Parameters');
      expect(html).toContain('Both token and email parameters are required');
    });

    it('should handle missing email parameter', async () => {
      const token = 'some-token';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}`);

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Missing Parameters');
      expect(html).toContain('Both token and email parameters are required');
    });
  });

  describe('Database Operations', () => {
    it('should mark subscribed user as unsubscribed', async () => {
      if (TEST_ENV !== 'local') return; // Skip for remote tests

      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // Verify user is initially subscribed
      const beforeSub = await env.DB.prepare(
        'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(email).first();
      expect(beforeSub.unsubscribed_at).toBeNull();

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);

      // Verify user is now unsubscribed
      const afterSub = await env.DB.prepare(
        'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(email).first();

      expect(afterSub.unsubscribed_at).toBeTruthy();
      expect(new Date(afterSub.unsubscribed_at).getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
    });

    it('should handle already unsubscribed users gracefully', async () => {
      const email = 'already-unsubscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');
    });

    it('should handle non-existent email addresses', async () => {
      const email = 'nonexistent@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(404);

      const html = await response.text();
      expect(html).toContain('Email Not Found');
      expect(html).toContain('This email address was not found in our newsletter subscription list');
    });

    it('should handle database errors gracefully', async () => {
      if (TEST_ENV !== 'local') return; // Skip for remote tests

      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // Mock database error
      vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(503);

      const html = await response.text();
      expect(html).toContain('Service Temporarily Unavailable');
      expect(html).toContain('Our unsubscribe service is temporarily unavailable');
    });
  });


  describe('HTTP Request Handling', () => {
    it('should only accept GET requests', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
          method
        });

        expect(response.status).toBe(405);

        const html = await response.text();
        expect(html).toContain('Method Not Allowed');
      }
    });

    it('should handle URL encoded email addresses', async () => {
      const email = 'user+test@example.com';
      const encodedEmail = encodeURIComponent(email);
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // First subscribe the user
      if (TEST_ENV === 'local') {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
          VALUES (?, ?, NULL, '192.168.1.1', 'GB')
        `).bind(email, new Date().toISOString()).run();
      }

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodedEmail}`);

      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
    });

    it('should return proper CORS headers for any origin', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
        headers: {
          'Origin': 'https://mail.google.com'
        }
      });

      // Should allow any origin for email client compatibility
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should handle malformed query parameters', async () => {
      const response = await makeRequest('/v1/newsletter/unsubscribe?token=&email=');

      expect(response.status).toBe(400);

      const html = await response.text();
      expect(html).toContain('Missing Parameters');
    });
  });

  describe('HTML Response Generation', () => {
    it('should return proper HTML structure for success', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();

      // Check HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('<title>Unsubscribed - Newsletter</title>');
      expect(html).toContain('<meta name="viewport"');

      // Check content
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');
      expect(html).toContain('https://www.rnwolf.net/');
    });

    it('should return proper HTML structure for errors', async () => {
      const response = await makeRequest('/v1/newsletter/unsubscribe?token=invalid&email=test@example.com');

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();

      // Check HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Error - Newsletter Unsubscribe</title>');
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should include proper styling and responsive design', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      const html = await response.text();

      // Check for responsive meta tag
      expect(html).toContain('width=device-width, initial-scale=1.0');

      // Check for CSS styling
      expect(html).toContain('<style>');
      expect(html).toContain('font-family');
      expect(html).toContain('max-width');
      expect(html).toContain('margin: 0 auto');
    });
  });

  describe('Integration with Main Worker', () => {
    it('should be accessible via main worker routing', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBeLessThan(500); // Should not be 500 or "not implemented"
    });

    it('should work with existing CORS configuration', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
        method: 'OPTIONS'
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });
  });

  describe('Error Response Edge Cases', () => {
    it('should handle extremely long URLs gracefully', async () => {
      const longEmail = 'a'.repeat(1000) + '@example.com';
      const token = 'some-token';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(longEmail)}`);

      expect(response.status).toBeLessThan(500);
      expect(response.headers.get('content-type')).toContain('text/html');
    });

    it('should handle special characters in email', async () => {
      const specialEmail = 'user+tag@ex-ample.co.uk';
      const token = generateTestUnsubscribeToken(specialEmail, env.HMAC_SECRET_KEY || 'test-secret');

      if (TEST_ENV === 'local') {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
          VALUES (?, ?, NULL, '192.168.1.1', 'GB')
        `).bind(specialEmail, new Date().toISOString()).run();
      }

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(specialEmail)}`);

      expect(response.status).toBeLessThan(500);
    });
  });
});
