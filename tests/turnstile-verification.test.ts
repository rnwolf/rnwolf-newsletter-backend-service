import { describe, it, expect, vi, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

describe('Turnstile Verification', () => {
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

  it('should reject missing Turnstile token', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com'
        // Missing turnstileToken
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Turnstile verification required');
  });

  it('should reject invalid Turnstile token', async () => {
    // Mock fetch to simulate Turnstile API rejection
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        turnstileToken: 'invalid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(400);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Please complete the security verification');
    expect(result.troubleshootingUrl).toBe('https://www.rnwolf.net/troubleshooting');
  });

  it('should accept valid Turnstile token', async () => {
    // Mock fetch to simulate successful Turnstile verification
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );

    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Thank you for subscribing');
  });

  it('should handle Turnstile API timeout', async () => {
    // Mock fetch to simulate timeout
    global.fetch = vi.fn().mockRejectedValue(new Error('Network timeout'));

    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'user@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(500);
    expect(result.success).toBe(false);
    expect(result.message).toContain('An error occurred while processing');
  });
});