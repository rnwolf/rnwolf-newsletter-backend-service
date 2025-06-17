// tests/email-verification-endpoint.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

// Helper function to generate verification token (same as in worker)
function generateVerificationToken(email: string, secretKey: string): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const message = `${email}:${timestamp}`;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(`${token}:${timestamp}`).toString('base64url');
}

describe('Email Verification Endpoint Tests', () => {
  beforeEach(async () => {
    // Set test environment variables
    if (!env.HMAC_SECRET_KEY) {
      // Set a test secret key if not already set
      env.HMAC_SECRET_KEY = 'test-secret';
    }

    // Setup test database - execute each statement separately
    try {
      // Drop table if exists
      await env.DB.exec('DROP TABLE IF EXISTS subscribers');
    } catch (error) {
      // Table might not exist, which is fine
      console.log('Table subscribers does not exist, continuing...');
    }

    // Create table - use single line to avoid multiline template literal issues
    const createTableSQL = 'CREATE TABLE subscribers (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, subscribed_at DATETIME NOT NULL, unsubscribed_at DATETIME NULL, email_verified BOOLEAN DEFAULT FALSE, verification_token TEXT DEFAULT NULL, verification_sent_at DATETIME DEFAULT NULL, verified_at DATETIME DEFAULT NULL, ip_address TEXT, user_agent TEXT, country TEXT, city TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)';

    await env.DB.exec(createTableSQL);

    // Create indexes separately
    await env.DB.exec('CREATE INDEX idx_verification_token ON subscribers(verification_token)');
    await env.DB.exec('CREATE INDEX idx_email_verified ON subscribers(email_verified)');
  });

  it('should verify valid email verification token', async () => {
    const testEmail = 'verify-test@example.com';
    const verificationToken = generateVerificationToken(testEmail, 'test-secret');

    // Insert unverified subscriber
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
      VALUES (?, ?, FALSE, ?)
    `).bind(testEmail, new Date().toISOString(), verificationToken).run();

    // Test verification
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    // Debug: Log the response details if it's not 200
    if (response.status !== 200) {
      const responseText = await response.clone().text();
      console.log('Response status:', response.status);
      console.log('Response body:', responseText);
      console.log('Generated token:', verificationToken);
      console.log('Test email:', testEmail);
    }

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');

    const html = await response.text();
    expect(html).toContain('Email Confirmed!');
    expect(html).toContain(testEmail);

    // Verify database was updated
    const subscriber = await env.DB.prepare(
      'SELECT email_verified, verified_at, verification_token FROM subscribers WHERE email = ?'
    ).bind(testEmail).first();

    expect(subscriber.email_verified).toBe(1); // SQLite returns 1 for TRUE
    expect(subscriber.verified_at).toBeTruthy();
    expect(subscriber.verification_token).toBeNull();
  });

  it('should reject invalid verification token', async () => {
    const testEmail = 'invalid-test@example.com';
    const invalidToken = 'invalid-token-123';

    // Insert unverified subscriber
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
      VALUES (?, ?, FALSE, ?)
    `).bind(testEmail, new Date().toISOString(), 'some-valid-token').run();

    // Test with invalid token
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${invalidToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    expect(response.status).toBe(400);

    const html = await response.text();
    expect(html).toContain('Invalid or Expired Link');
  });

  it('should handle expired verification token', async () => {
    const testEmail = 'expired-test@example.com';

    // Generate an expired token (25 hours ago)
    const expiredTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString();
    const crypto = require('crypto');
    const message = `${testEmail}:${expiredTimestamp}`;
    const tokenHash = crypto.createHmac('sha256', 'test-secret').update(message).digest('hex');
    const expiredToken = Buffer.from(`${tokenHash}:${expiredTimestamp}`).toString('base64url');

    // Insert unverified subscriber
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
      VALUES (?, ?, FALSE, ?)
    `).bind(testEmail, new Date().toISOString(), expiredToken).run();

    // Test with expired token
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${expiredToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    expect(response.status).toBe(400);

    const html = await response.text();
    expect(html).toContain('Invalid or Expired Link');
  });

  it('should handle already verified email', async () => {
    const testEmail = 'already-verified@example.com';
    const verificationToken = generateVerificationToken(testEmail, 'test-secret');

    // Insert already verified subscriber
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token, verified_at)
      VALUES (?, ?, TRUE, ?, ?)
    `).bind(testEmail, new Date().toISOString(), verificationToken, new Date().toISOString()).run();

    // Test verification of already verified email
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain('Already Confirmed');
    expect(html).toContain(testEmail);
  });

  it('should handle non-existent email', async () => {
    const testEmail = 'nonexistent@example.com';
    const verificationToken = generateVerificationToken(testEmail, 'test-secret');

    // Test verification without inserting subscriber
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    expect(response.status).toBe(404);

    const html = await response.text();
    expect(html).toContain('Subscription Not Found');
  });

  it('should handle missing parameters', async () => {
    // Test missing token
    const response1 = await worker.fetch(
      new Request('http://localhost:8787/v1/newsletter/verify?email=test@example.com'),
      env
    );

    expect(response1.status).toBe(400);
    const html1 = await response1.text();
    expect(html1).toContain('Missing Parameters');

    // Test missing email
    const response2 = await worker.fetch(
      new Request('http://localhost:8787/v1/newsletter/verify?token=some-token'),
      env
    );

    expect(response2.status).toBe(400);
    const html2 = await response2.text();
    expect(html2).toContain('Missing Parameters');
  });

  it('should only accept GET requests', async () => {
    const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

    for (const method of methods) {
      const response = await worker.fetch(
        new Request('http://localhost:8787/v1/newsletter/verify?token=test&email=test@example.com', {
          method
        }),
        env
      );

      expect(response.status).toBe(405);
      const html = await response.text();
      expect(html).toContain('Method Not Allowed');
    }
  });
});