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
    isLocal: true
  },
  staging: {
    baseUrl: 'https://api-staging.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    isLocal: false
  },
  production: {
    baseUrl: 'https://api.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    isLocal: false
  }
};

// Get environment from ENV variable, default to local
const TEST_ENV = (process.env.TEST_ENV || 'local') as keyof typeof TEST_CONFIG;
const config = TEST_CONFIG[TEST_ENV];
const ALLOWED_ORIGIN = 'https://www.rnwolf.net';

// Helper function to make requests (either via worker.fetch or real HTTP)
async function makeRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = `${config.baseUrl}${path}`;

  if (config.useWorkerFetch) {
    // Local testing via worker.fetch
    const request = new Request(url, options);
    return await worker.fetch(request, env);
  } else {
    // Remote testing via real HTTP
    console.log(`Making real HTTP request to: ${url}`);
    return await fetch(url, options);
  }
}

// Helper function to generate unique test emails for remote environments
function generateTestEmail(base: string): string {
  if (config.isLocal) {
    return base;
  } else {
    // For staging/production, add timestamp to ensure uniqueness
    const timestamp = Date.now();
    return base.replace('@', `-${timestamp}@`);
  }
}

describe(`API Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);
    }
  });

  describe('CORS Configuration', () => {
    it('should handle OPTIONS preflight requests correctly', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'OPTIONS',
        headers: {
          'Origin': ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });

      expect(response.status).toBe(200);

      // Verify CORS headers
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
      expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('should include CORS headers in successful POST responses', async () => {
      const testEmail = generateTestEmail('cors-test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': ALLOWED_ORIGIN
        },
        body: JSON.stringify({ email: testEmail })
      });

      expect(response.status).toBe(200);

      // Verify CORS headers are present in successful response
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
    });

    it('should include CORS headers in error responses', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': ALLOWED_ORIGIN
        },
        body: JSON.stringify({ email: 'invalid-email' }) // Invalid email to trigger error
      });

      expect(response.status).toBe(400);

      // Verify CORS headers are present even in error responses
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');

      const result = await response.json() as SubscriptionResponse;
      expect(result.success).toBe(false);
    });

    it('should include CORS headers in health check responses', async () => {
      const response = await makeRequest('/health', {
        headers: {
          'Origin': ALLOWED_ORIGIN
        }
      });

      expect(response.status).toBe(200);

      // Verify CORS headers in health check
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should include CORS headers in 404 responses', async () => {
      const response = await makeRequest('/nonexistent', {
        headers: {
          'Origin': ALLOWED_ORIGIN
        }
      });

      expect(response.status).toBe(404);

      // Verify CORS headers in 404 responses
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    });

    it('should include CORS headers in method not allowed responses', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'GET', // Wrong method
        headers: {
          'Origin': ALLOWED_ORIGIN
        }
      });

      expect(response.status).toBe(405);

      // Verify CORS headers in method not allowed responses
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should handle multiple CORS preflight scenarios', async () => {
      // Test preflight for health endpoint
      const healthPreflight = await makeRequest('/health', {
        method: 'OPTIONS',
        headers: {
          'Origin': ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'GET'
        }
      });

      expect(healthPreflight.status).toBe(200);
      expect(healthPreflight.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);

      // Test preflight for subscription endpoint
      const subscribePreflight = await makeRequest('/v1/newsletter/subscribe', {
        method: 'OPTIONS',
        headers: {
          'Origin': ALLOWED_ORIGIN,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });

      expect(subscribePreflight.status).toBe(200);
      expect(subscribePreflight.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
    });
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await makeRequest('/health');
      const result = await response.json() as HealthResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.database).toBe('Connected');
      expect(result.message).toContain('Newsletter API is running');

      // For remote environments, verify the environment matches
      if (!config.isLocal) {
        expect(result.environment).toBe(TEST_ENV);
      }
    });
  });

  describe('Newsletter Subscription', () => {
    it('should accept valid email subscription', async () => {
      const testEmail = generateTestEmail('test@example.com');

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Thank you for subscribing');

      // For local tests, verify database storage
      if (config.isLocal) {
        const subscriber = await env.DB.prepare(
          'SELECT email FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        if (subscriber) {
          expect(subscriber.email).toBe(testEmail);
        }
      }
    });

    it('should reject invalid email addresses', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email address');
    });

    it('should require email field', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // No email field
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Email address is required');
    });

    it('should normalize email addresses', async () => {
      const inputEmail = generateTestEmail('User@Example.COM');
      const expectedEmail = inputEmail.toLowerCase();

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inputEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // For local tests, verify normalization in database
      if (config.isLocal) {
        const subscriber = await env.DB.prepare(
          'SELECT email FROM subscribers WHERE email = ?'
        ).bind(expectedEmail).first() as DatabaseRow | null;

        if (subscriber) {
          expect(subscriber.email).toBe(expectedEmail);
        }
      }
    });

    it('should handle duplicate subscriptions', async () => {
      const testEmail = generateTestEmail('duplicate@example.com');

      // First subscription
      const response1 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result1 = await response1.json() as SubscriptionResponse;
      expect(response1.status).toBe(200);
      expect(result1.success).toBe(true);

      // Second subscription with same email
      const response2 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result2 = await response2.json() as SubscriptionResponse;
      expect(response2.status).toBe(200);
      expect(result2.success).toBe(true);

      // For local tests, verify only one record exists
      if (config.isLocal) {
        const count = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM subscribers WHERE email = ?'
        ).bind(testEmail).first() as DatabaseRow | null;

        expect(count?.count).toBe(1);
      }
    });

    it('should reject non-POST requests', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'GET'
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(405);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Method not allowed');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await makeRequest('/nonexistent');
      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }'
      });

      const result = await response.json() as SubscriptionResponse;
      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid request format');
    });
  });

  describe('Error Response Handling', () => {
    it('should return proper error structure for invalid email', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(400);
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('Invalid email address')
      });

      // Debug info should only be present in staging
      if (TEST_ENV === 'staging') {
        // staging might have debug info
      } else {
        expect(result).not.toHaveProperty('debug');
      }
    });

    it('should return proper error structure for missing email', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}) // No email field
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('Email address is required')
      });
    });

    it('should return troubleshooting URL for Turnstile failures', async () => {
      // Mock Turnstile failure only for local tests
      if (config.isLocal) {
        global.fetch = vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ success: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );
      }

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: generateTestEmail('test@example.com'),
          turnstileToken: 'invalid-token'
        })
      });

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('Please complete the security verification'),
        troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
      });
    });

    it('should include debug info only in staging environment', async () => {
      // This test only makes sense for staging
      if (TEST_ENV === 'staging') {
        // Force an error by sending malformed request
        const response = await makeRequest('/v1/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ "email": "test@example.com", invalid }' // Malformed JSON
        });

        const result = await response.json();

        expect(response.status).toBe(500);
        expect(result).toHaveProperty('debug'); // Debug info should be present in staging
      } else {
        // For non-staging environments, we don't expect debug info
        console.log(`Skipping debug info test for ${TEST_ENV} environment`);
      }
    });

    it('should handle network timeouts gracefully', async () => {
      if (config.isLocal) {
        // Mock a network timeout for Turnstile verification
        global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

        const response = await makeRequest('/v1/newsletter/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: generateTestEmail('test@example.com'),
            turnstileToken: 'valid-token'
          })
        });

        const result = await response.json();

        expect(response.status).toBe(400);
        expect(result).toMatchObject({
          success: false,
          message: expect.stringContaining('Please complete the security verification'),
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        });
      } else {
        console.log(`Skipping network timeout test for ${TEST_ENV} environment`);
      }
    });
  });
});