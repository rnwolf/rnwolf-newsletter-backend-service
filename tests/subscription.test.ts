import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

describe('Newsletter Subscription', () => {
  beforeEach(async () => {
    await setupTestDatabase(env);
  });

  it('should accept valid email subscription', async () => {
    const request = new Request('http://localhost:8787/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Thank you for subscribing');

    // Verify email was stored in database
    const subscriber = await env.DB.prepare(
      'SELECT email FROM subscribers WHERE email = ?'
    ).bind('test@example.com').first();

    expect(subscriber).toBeTruthy();
    expect(subscriber.email).toBe('test@example.com');
  });

  it('should reject invalid email addresses', async () => {
    const request = new Request('http://localhost:8787/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid email address');
  });

  it('should handle duplicate subscriptions', async () => {
    // First subscription
    const request1 = new Request('http://localhost:8787/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'duplicate@example.com'
      })
    });

    await worker.fetch(request1, env);

    // Second subscription with same email
    const request2 = new Request('http://localhost:8787/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'duplicate@example.com'
      })
    });

    const response = await worker.fetch(request2, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);

    // Verify only one record exists
    const count = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM subscribers WHERE email = ?'
    ).bind('duplicate@example.com').first();

    expect(count.count).toBe(1);
  });

  it('should reject non-POST requests', async () => {
    const request = new Request('http://localhost:8787/v1/newsletter/subscribe', {
      method: 'GET'
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(405);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Method not allowed');
  });
});

describe('Health Check', () => {
  beforeEach(async () => {
    await setupTestDatabase(env);
  });

  it('should return healthy status', async () => {
    const request = new Request('http://localhost:8787/health');
    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.database).toBe('Connected');
  });
});