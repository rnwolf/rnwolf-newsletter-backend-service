import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

describe('Database Operations', () => {
  beforeEach(async () => {
    // Setup test database
    await env.DB.exec(`
      DROP TABLE IF EXISTS subscribers
    `);
    await env.DB.exec(`
      CREATE TABLE subscribers (
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

    // Mock successful Turnstile verification for these tests
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
  });

  it('should insert new subscriber successfully', async () => {
    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.168.1.1',
        'User-Agent': 'Mozilla/5.0 Test Browser',
        'CF-IPCountry': 'GB'
      },
      body: JSON.stringify({
        email: 'newuser@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);

    // Verify subscriber was inserted
    const subscriber = await env.DB.prepare(
      'SELECT * FROM subscribers WHERE email = ?'
    ).bind('newuser@example.com').first();

    expect(subscriber).toBeTruthy();
    expect(subscriber.email).toBe('newuser@example.com');
    expect(subscriber.subscribed_at).toBeTruthy();
    expect(subscriber.unsubscribed_at).toBeNull();
    expect(subscriber.ip_address).toBe('192.168.1.1');
    expect(subscriber.user_agent).toBe('Mozilla/5.0 Test Browser');
    expect(subscriber.country).toBe('GB');
  });

  it('should update existing subscriber subscription date', async () => {
    // Insert existing subscriber
    const originalDate = '2024-01-01T00:00:00Z';
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, unsubscribed_at)
      VALUES (?, ?, ?)
    `).bind('existing@example.com', originalDate, null).run();

    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Thank you for subscribing');

    // Verify subscription date was updated
    const subscriber = await env.DB.prepare(
      'SELECT subscribed_at FROM subscribers WHERE email = ?'
    ).bind('existing@example.com').first();

    expect(subscriber.subscribed_at).not.toBe(originalDate);
  });

  it('should resubscribe previously unsubscribed user', async () => {
    // Insert unsubscribed user
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, unsubscribed_at)
      VALUES (?, ?, ?)
    `).bind('unsubscribed@example.com', '2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z').run();

    const request = new Request('https://api.yourdomain.com/v1/newsletter/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'unsubscribed@example.com',
        turnstileToken: 'valid-token'
      })
    });

    const response = await worker.fetch(request, env);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);

    // Verify user is resubscribed
    const subscriber = await env.DB.prepare(
      'SELECT * FROM subscribers WHERE email = ?'
    ).bind('unsubscribed@example.com').first();

    expect(subscriber.unsubscribed_at).toBeNull();
    expect(new Date(subscriber.subscribed_at).getTime()).toBeGreaterThan(
      new Date('2024-06-01T00:00:00Z').getTime()
    );
  });

  it('should handle database unavailable gracefully', async () => {
    // Simulate database error by using invalid SQL
    vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
      throw new Error('Database unavailable');
    });

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

    expect(response.status).toBe(503);
    expect(result.success).toBe(false);
    expect(result.message).toContain('temporarily unavailable for maintenance');
  });
});