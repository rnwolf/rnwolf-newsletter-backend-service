import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';

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

// This file is for remote environment smoke tests (staging and production)
// It doesn't use the workers pool and makes real HTTP requests
const PRODUCTION_API_URL = 'https://api.rnwolf.net';
const STAGING_API_URL = 'https://api-staging.rnwolf.net';

// Get environment from TEST_ENV, default to production for this file
const TEST_ENV = env.ENVIRONMENT || 'production';
const API_URL = TEST_ENV === 'staging' ? STAGING_API_URL : PRODUCTION_API_URL;

// Validate environment
if (!['staging', 'production'].includes(TEST_ENV)) {
  throw new Error(`Invalid TEST_ENV: ${TEST_ENV}. This test file only supports 'staging' and 'production'.`);
}

// Helper function to generate unique test emails for remote environments
function generateSmokeTestEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const prefix = TEST_ENV === 'staging' ? 'staging-smoke-test' : 'smoke-test';
  return `${prefix}-${timestamp}-${random}@smoke-test.example.com`;
}

describe(`Remote Environment Smoke Tests (${TEST_ENV})`, () => {
  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await fetch(`${API_URL}/health`);
      const result = await response.json() as HealthResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.database).toBe('Connected');
      expect(result.message).toContain('Newsletter API is running');
      expect(result.environment).toBe(TEST_ENV);
    });
  });

  describe('CORS Headers', () => {
    it('should include proper CORS headers', async () => {
      const response = await fetch(`${API_URL}/health`, {
        headers: {
          'Origin': 'https://www.rnwolf.net'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.rnwolf.net');
    });

    it('should handle OPTIONS preflight requests', async () => {
      const response = await fetch(`${API_URL}/v1/newsletter/subscribe`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://www.rnwolf.net',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.rnwolf.net');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Newsletter Subscription', () => {
    it('should accept valid email subscription', async () => {
      const testEmail = generateSmokeTestEmail();
      console.log(`Testing with email: ${testEmail}`);

      const response = await fetch(`${API_URL}/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.rnwolf.net'
        },
        body: JSON.stringify({ email: testEmail })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Thank you for subscribing');

      // Output email for cleanup script
      console.log(`SMOKE_TEST_EMAIL: ${testEmail}`);
    });

    it('should reject invalid email addresses', async () => {
      const response = await fetch(`${API_URL}/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.rnwolf.net'
        },
        body: JSON.stringify({ email: 'invalid-email' })
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email address');
    });

    it('should require email field', async () => {
      const response = await fetch(`${API_URL}/v1/newsletter/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://www.rnwolf.net'
        },
        body: JSON.stringify({}) // No email field
      });

      const result = await response.json() as SubscriptionResponse;

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Email address is required');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const response = await fetch(`${API_URL}/nonexistent`);
      expect(response.status).toBe(404);
    });

    it('should reject non-POST requests to subscription endpoint', async () => {
      const response = await fetch(`${API_URL}/v1/newsletter/subscribe`, {
        method: 'GET',
        headers: {
          'Origin': 'https://www.rnwolf.net'
        }
      });

      expect(response.status).toBe(405);
    });
  });

  describe('Performance', () => {
    it('should respond quickly to health checks', async () => {
      const start = Date.now();
      const response = await fetch(`${API_URL}/health`);
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000); // Should respond within 2 seconds
    });

    it('should handle multiple concurrent requests', async () => {
      const promises = Array.from({ length: 5 }, () =>
        fetch(`${API_URL}/health`)
      );

      const results = await Promise.all(promises);

      results.forEach(response => {
        expect(response.status).toBe(200);
      });
    });
  });
});