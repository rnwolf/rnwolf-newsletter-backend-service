import { describe, it, expect, beforeEach } from 'vitest';
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

// Get environment from ENV variable, default to local
const TEST_ENV = (process.env.TEST_ENV || 'local') as keyof typeof TEST_CONFIG;
const config = TEST_CONFIG[TEST_ENV];

// Helper function to make requests (either via worker.fetch or real HTTP)
async function makeRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = `${config.baseUrl}${path}`;

  if (config.useWorkerFetch) {
    // Local testing via worker.fetch
    const request = new Request(url, options);
    return await worker.fetch(request, env);
  } else {
    // Remote testing via real HTTP
    return await fetch(url, options);
  }
}

describe(`API Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);
    }
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const response = await makeRequest('/health');
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.database).toBe('Connected');
      expect(result.message).toContain('Newsletter API is running');

      if (TEST_ENV !== 'local') {
        expect(result.environment).toBe(TEST_ENV);
      }
    });
  });

  describe('Newsletter Subscription', () => {
    it('should accept valid email subscription', async () => {
      // Use timestamp for remote tests to ensure uniqueness
      const baseEmail = TEST_ENV === 'local' ? 'test@example.com' : `test-${Date.now()}@example.com`;

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: baseEmail })
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Thank you for subscribing');

      // For local tests, verify database storage
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT email FROM subscribers WHERE email = ?'
        ).bind(baseEmail).first();

        expect(subscriber).toBeTruthy();
        expect(subscriber.email).toBe(baseEmail);
      }
    });

    it('should reject invalid email addresses', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'invalid-email' })
      });

      const result = await response.json();

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

      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Email address is required');
    });

    it('should normalize email addresses', async () => {
      const inputEmail = TEST_ENV === 'local' ? 'User@Example.COM' : `User-${Date.now()}@Example.COM`;
      const expectedEmail = inputEmail.toLowerCase();

      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inputEmail })
      });

      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // For local tests, verify normalization in database
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT email FROM subscribers WHERE email = ?'
        ).bind(expectedEmail).first();

        expect(subscriber).toBeTruthy();
        expect(subscriber.email).toBe(expectedEmail);
      }
    });

    it('should handle duplicate subscriptions', async () => {
      const testEmail = TEST_ENV === 'local' ? 'duplicate@example.com' : `duplicate-${Date.now()}@example.com`;

      // First subscription
      const response1 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result1 = await response1.json();
      expect(response1.status).toBe(200);
      expect(result1.success).toBe(true);

      // Second subscription with same email
      const response2 = await makeRequest('/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail })
      });

      const result2 = await response2.json();
      expect(response2.status).toBe(200);
      expect(result2.success).toBe(true);

      // For local tests, verify only one record exists
      if (TEST_ENV === 'local') {
        const count = await env.DB.prepare(
          'SELECT COUNT(*) as count FROM subscribers WHERE email = ?'
        ).bind(testEmail).first();

        expect(count.count).toBe(1);
      }
    });

    it('should reject non-POST requests', async () => {
      const response = await makeRequest('/v1/newsletter/subscribe', {
        method: 'GET'
      });

      const result = await response.json();

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

      const result = await response.json();
      expect(response.status).toBe(500);
      expect(result.success).toBe(false);
    });
  });
});