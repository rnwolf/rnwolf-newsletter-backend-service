import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

describe('Email Validation', () => {
  beforeEach(async () => {
    await setupTestDatabase(env);
  });

describe('Email Validation', () => {
  beforeEach(async () => {
    // Setup test database schema
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        subscribed_at DATETIME NOT NULL,
        unsubscribed_at DATETIME NULL,
        ip_address TEXT,
        user_agent TEXT,
        country TEXT,
        city TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  it('should accept valid email addresses', async () => {
    const validEmails = [
      'user@example.com',
      'test.email+tag@domain.co.uk',
      'firstname.lastname@company.org'
    ];

    for (const email of validEmails) {
      const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          turnstileToken: 'valid-test-token'
        })
      });

      const response = await worker.fetch(request, env);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toContain('Thank you for subscribing');
    }
  });

  it('should reject invalid email addresses', async () => {
    const invalidEmails = [
      'invalid-email',
      '@domain.com',
      'user@',
      'user space@domain.com',
      '',
      'a'.repeat(255) + '@domain.com' // Too long
    ];

    for (const email of invalidEmails) {
      const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          turnstileToken: 'valid-test-token'
        })
      });

      const response = await worker.fetch(request, env);
      const result = await response.json();

      expect(response.status).toBe(400);
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid email address');
    }
  });

  it('should normalize email addresses', async () => {
    const testCases = [
      { input: 'User@Example.COM', expected: 'user@example.com' },
      { input: '  user@domain.com  ', expected: 'user@domain.com' },
    ];

    for (const testCase of testCases) {
      const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testCase.input,
          turnstileToken: 'valid-test-token'
        })
      });

      await worker.fetch(request, env);

      // Verify normalized email was stored in database
      const subscriber = await env.DB.prepare(
        'SELECT email FROM subscribers WHERE email = ?'
      ).bind(testCase.expected).first();

      expect(subscriber).toBeTruthy();
      expect(subscriber.email).toBe(testCase.expected);
    }
  });
});