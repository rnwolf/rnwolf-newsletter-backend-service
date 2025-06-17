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

// Helper function that uses the environment variable approach
function generateTestVerificationToken(email: string): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const message = `${email}:${timestamp}`;
  // Use env.HMAC_SECRET_KEY which is actually set by the setup file
  const secretKey = env.HMAC_SECRET_KEY || 'local-test-secret';
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


  it('should handle expired verification token', async () => {
    const testEmail = 'expired-test@example.com';

    // Generate an expired token (25 hours ago)
    const expiredTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString();
    const crypto = require('crypto');
    const message = `${testEmail}:${expiredTimestamp}`;

    // Use environment variable approach for secret
    const secretKey = process.env.HMAC_SECRET_KEY || 'local-test-secret';
    const tokenHash = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
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

  // // Add this debug test to understand the token format issue
  // it('DEBUG: Token format and secret verification', async () => {
  //   const testEmail = 'debug@example.com';

  //   console.log('=== TOKEN FORMAT DEBUG ===');

  //   // Test different secret keys
  //   const secrets = ['test-secret', 'local-test-secret', env.HMAC_SECRET_KEY];

  //   for (const secret of secrets) {
  //     console.log(`\nTesting with secret: "${secret}"`);

  //     if (!secret) {
  //       console.log('Secret is undefined/null, skipping...');
  //       continue;
  //     }

  //     // Generate token with this secret
  //     const token = generateVerificationToken(testEmail, secret);
  //     console.log(`Generated token: ${token}`);

  //     // Try to decode the token to see its structure
  //     try {
  //       const decoded = Buffer.from(token, 'base64url').toString();
  //       console.log(`Decoded token structure: ${decoded}`);

  //       // Check if it has the expected format (hash:timestamp)
  //       const parts = decoded.split(':');
  //       console.log(`Token parts: ${parts.length} parts`);
  //       if (parts.length === 2) {
  //         console.log(`Hash: ${parts[0].substring(0, 20)}...`);
  //         console.log(`Timestamp: ${parts[1]}`);

  //         // Verify timestamp is recent
  //         const timestamp = parseInt(parts[1]);
  //         const age = Date.now() - timestamp;
  //         console.log(`Token age: ${age}ms`);
  //       }
  //     } catch (e) {
  //       console.log(`Failed to decode token: ${e.message}`);
  //     }
  //   }

  //   console.log('\n=== ENVIRONMENT DEBUG ===');
  //   console.log(`env.HMAC_SECRET_KEY: "${env.HMAC_SECRET_KEY}"`);
  //   console.log(`env.ENVIRONMENT: "${env.ENVIRONMENT}"`);

  //   console.log('\n=== WORKER TOKEN VALIDATION TEST ===');

  //   // Test with the exact secret that should be in the environment
  //   const testToken = generateVerificationToken(testEmail, env.HMAC_SECRET_KEY || 'test-secret');
  //   console.log(`Using final test token: ${testToken}`);

  //   // Insert subscriber
  //   await env.DB.prepare(`
  //     INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
  //     VALUES (?, ?, FALSE, ?)
  //   `).bind(testEmail, new Date().toISOString(), testToken).run();

  //   // Test the worker
  //   const response = await worker.fetch(
  //     new Request(`http://localhost:8787/v1/newsletter/verify?token=${testToken}&email=${encodeURIComponent(testEmail)}`),
  //     env
  //   );

  //   console.log(`Final test response status: ${response.status}`);

  //   if (response.status !== 200) {
  //     const text = await response.text();
  //     console.log(`Error response preview: ${text.substring(0, 200)}`);
  //   }
  // });
  // // Alternative: Test token generation that exactly matches your worker
  // it('DEBUG: Test with worker-compatible token generation', async () => {
  //   const testEmail = 'worker-compat@example.com';

  //   console.log('\n=== WORKER-COMPATIBLE TOKEN TEST ===');

  //   // Create token using the EXACT same method your worker uses
  //   // This should match whatever is in your worker's generateVerificationToken function
  //   const crypto = require('crypto');
  //   const timestamp = Date.now().toString();
  //   const message = `${testEmail}:${timestamp}`;
  //   const secretKey = env.HMAC_SECRET_KEY || 'test-secret';

  //   console.log(`Secret key being used: "${secretKey}"`);
  //   console.log(`Message being hashed: "${message}"`);

  //   const hash = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  //   const token = Buffer.from(`${hash}:${timestamp}`).toString('base64url');

  //   console.log(`Generated hash: ${hash}`);
  //   console.log(`Final token: ${token}`);

  //   // Insert subscriber
  //   await env.DB.prepare(`
  //     INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
  //     VALUES (?, ?, FALSE, ?)
  //   `).bind(testEmail, new Date().toISOString(), token).run();

  //   console.log('Inserted subscriber with worker-compatible token');

  //   // Test verification
  //   const response = await worker.fetch(
  //     new Request(`http://localhost:8787/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`),
  //     env
  //   );

  //   console.log(`Worker-compatible token response: ${response.status}`);

  //   if (response.status === 200) {
  //     console.log('✅ SUCCESS! Worker-compatible token worked');
  //     const html = await response.text();
  //     console.log(`Success response contains "Email Confirmed": ${html.includes('Email Confirmed!')}`);
  //   } else {
  //     console.log('❌ FAILED! Even worker-compatible token failed');
  //     const text = await response.text();
  //     console.log(`Error: ${text.substring(0, 200)}`);
  //   }
  // });
  // // Add this debug test to see what's happening with environment variables
  // it('DEBUG: Environment variable investigation', async () => {
  //   console.log('=== ENVIRONMENT INVESTIGATION ===');

  //   console.log('process.env.HMAC_SECRET_KEY:', process.env.HMAC_SECRET_KEY);
  //   console.log('env.HMAC_SECRET_KEY:', env.HMAC_SECRET_KEY);

  //   console.log('Fallback calculation:');
  //   const configSecret = process.env.HMAC_SECRET_KEY || 'local-test-secret';
  //   console.log('process.env.HMAC_SECRET_KEY || "local-test-secret":', configSecret);

  //   console.log('env.HMAC_SECRET_KEY || "test-secret":', env.HMAC_SECRET_KEY || 'test-secret');

  //   console.log('\n=== TOKEN GENERATION COMPARISON ===');

  //   const testEmail = 'comparison@example.com';

  //   // Method 1: Using process.env (vitest config approach)
  //   const token1 = generateTokenWithSecret(testEmail, configSecret);
  //   console.log('Token with config secret:', token1.substring(0, 40) + '...');

  //   // Method 2: Using env object (current test approach)
  //   const token2 = generateTokenWithSecret(testEmail, env.HMAC_SECRET_KEY || 'test-secret');
  //   console.log('Token with env secret:', token2.substring(0, 40) + '...');

  //   // Method 3: Direct hardcoded (failing tests)
  //   const token3 = generateTokenWithSecret(testEmail, 'test-secret');
  //   console.log('Token with hardcoded secret:', token3.substring(0, 40) + '...');

  //   console.log('\nTokens match (config vs env):', token1 === token2);
  //   console.log('Tokens match (config vs hardcoded):', token1 === token3);
  //   console.log('Tokens match (env vs hardcoded):', token2 === token3);

  //   // Test which one actually works with the worker
  //   for (const [name, token] of [
  //     ['config', token1],
  //     ['env', token2],
  //     ['hardcoded', token3]
  //   ]) {
  //     console.log(`\nTesting ${name} token...`);

  //     await env.DB.prepare(`DELETE FROM subscribers WHERE email = ?`).bind(testEmail).run();
  //     await env.DB.prepare(`
  //       INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
  //       VALUES (?, ?, FALSE, ?)
  //     `).bind(testEmail, new Date().toISOString(), token).run();

  //     const response = await worker.fetch(
  //       new Request(`http://localhost:8787/v1/newsletter/verify?token=${token}&email=${encodeURIComponent(testEmail)}`),
  //       env
  //     );

  //     console.log(`${name} token result: ${response.status === 200 ? '✅ SUCCESS' : '❌ FAILED'} (${response.status})`);
  //   }
  // });

  it('should handle already verified email', async () => {
    const testEmail = 'already-verified@example.com';
    const verificationToken = generateTestVerificationToken(testEmail);

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
    const verificationToken = generateTestVerificationToken(testEmail);

    // Test verification without inserting subscriber
    const response = await worker.fetch(
      new Request(`http://localhost:8787/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(testEmail)}`),
      env
    );

    expect(response.status).toBe(404);

    const html = await response.text();
    expect(html).toContain('Subscription Not Found');
  });

  it('should handle expired verification token', async () => {
    const testEmail = 'expired-test@example.com';

    // Generate an expired token (25 hours ago)
    const expiredTimestamp = (Date.now() - 25 * 60 * 60 * 1000).toString();
    const crypto = require('crypto');
    const message = `${testEmail}:${expiredTimestamp}`;

    // Use env.HMAC_SECRET_KEY to match the worker
    const secretKey = env.HMAC_SECRET_KEY || 'test-secret';
    const tokenHash = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
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

  it('should verify valid email verification token', async () => {
    const testEmail = 'verify-test@example.com';
    const verificationToken = generateTestVerificationToken(testEmail); //, 'local-test-secret');

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

});