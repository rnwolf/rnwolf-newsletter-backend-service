import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

describe('HTTP Request Handling', () => {
  beforeEach(async () => {
    // Setup test database
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

  it('should only accept POST requests', async () => {
    const methods = ['GET', 'PUT', 'DELETE', 'PATCH'];

    for (const method of methods) {
      const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
        method
      });

      const response = await worker.fetch(request, env);
      expect(response.status).toBe(405); // Method Not Allowed
    }
  });

  it('should require Content-Type: application/json', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'invalid body'
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(400);
  });

  it('should return proper CORS headers', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'OPTIONS',
      headers: { 'Origin': 'https://www.rnwolf.net' }
    });

    const response = await worker.fetch(request, env);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://www.rnwolf.net');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
  });

  it('should reject requests from unauthorized origins', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'https://malicious-site.com'
      },
      body: JSON.stringify({
        email: 'user@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    expect(response.status).toBe(403); // Forbidden
  });

  it('should handle malformed JSON gracefully', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }'
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid request format');
  });

  it('should handle requests with missing email field', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        turnstileToken: 'valid-token'
        // Missing email field
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Email address is required');
  });
});