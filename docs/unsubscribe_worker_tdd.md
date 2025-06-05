# Task 2.2: Newsletter Unsubscribe Worker - TDD Implementation

## TDD Approach: Red-Green-Refactor Cycle

We will implement the newsletter unsubscribe worker using Test-Driven Development, following these steps:

1. **RED**: Write failing tests that define the expected behavior
2. **GREEN**: Write minimal code to make the tests pass
3. **REFACTOR**: Improve the code while keeping tests green

## Overview

The unsubscribe worker handles secure one-click unsubscribe functionality for newsletter subscribers. Based on the design specification, it must:

- Accept GET requests with token and email parameters
- Verify HMAC-SHA256 unsubscribe tokens
- Update database to mark users as unsubscribed
- Return HTML confirmation page
- Handle various error scenarios gracefully
- Allow CORS from any origin (for email client compatibility)

## Step 1: RED - Write Failing Tests First

### Test Setup and Configuration

We'll extend the existing test configuration to support unsubscribe endpoint testing.

**tests/unsubscribe.test.ts**:
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

const TEST_ENV = (process.env.TEST_ENV || 'local') as keyof typeof TEST_CONFIG;
const config = TEST_CONFIG[TEST_ENV];

// Helper function to make requests
async function makeRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = `${config.baseUrl}${path}`;

  if (config.useWorkerFetch) {
    const request = new Request(url, options);
    return await worker.fetch(request, env);
  } else {
    return await fetch(url, options);
  }
}

// Helper function to generate valid HMAC token for testing
function generateTestUnsubscribeToken(email: string, secretKey: string = 'test-secret'): string {
  const crypto = require('crypto');
  const message = email;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(token).toString('base64url');
}

describe(`Unsubscribe Worker Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);
      
      // Insert test subscribers
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
        VALUES (?, ?, NULL, '192.168.1.1', 'GB')
      `).bind('subscribed@example.com', new Date().toISOString()).run();

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
        VALUES (?, ?, ?, '192.168.1.2', 'US')
      `).bind('already-unsubscribed@example.com', '2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z').run();
    }
  });
```

### Test Suite 1: Token Validation Tests

```typescript
  describe('Token Validation', () => {
    it('should accept valid HMAC tokens', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');

      // For local tests, verify database was updated
      if (TEST_ENV === 'local') {
        const subscriber = await env.DB.prepare(
          'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
        ).bind(email).first();

        expect(subscriber.unsubscribed_at).toBeTruthy();
      }
    });

    it('should reject invalid HMAC tokens', async () => {
      const email = 'subscribed@example.com';
      const invalidToken = 'invalid-token-123';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${invalidToken}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
      expect(html).toContain('This unsubscribe link is invalid or has expired');
    });

    it('should reject tokens generated with wrong secret', async () => {
      const email = 'subscribed@example.com';
      const wrongSecretToken = generateTestUnsubscribeToken(email, 'wrong-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${wrongSecretToken}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);
      
      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should reject tokens for different email addresses', async () => {
      const originalEmail = 'subscribed@example.com';
      const differentEmail = 'different@example.com';
      const token = generateTestUnsubscribeToken(originalEmail, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(differentEmail)}`);

      expect(response.status).toBe(400);
      
      const html = await response.text();
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should handle missing token parameter', async () => {
      const email = 'subscribed@example.com';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(400);
      
      const html = await response.text();
      expect(html).toContain('Missing Parameters');
      expect(html).toContain('Both token and email parameters are required');
    });

    it('should handle missing email parameter', async () => {
      const token = 'some-token';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}`);

      expect(response.status).toBe(400);
      
      const html = await response.text();
      expect(html).toContain('Missing Parameters');
      expect(html).toContain('Both token and email parameters are required');
    });
  });
```

### Test Suite 2: Database Operations Tests

```typescript
  describe('Database Operations', () => {
    it('should mark subscribed user as unsubscribed', async () => {
      if (TEST_ENV !== 'local') return; // Skip for remote tests

      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // Verify user is initially subscribed
      const beforeSub = await env.DB.prepare(
        'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(email).first();
      expect(beforeSub.unsubscribed_at).toBeNull();

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);

      // Verify user is now unsubscribed
      const afterSub = await env.DB.prepare(
        'SELECT unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(email).first();
      
      expect(afterSub.unsubscribed_at).toBeTruthy();
      expect(new Date(afterSub.unsubscribed_at).getTime()).toBeGreaterThan(Date.now() - 5000); // Within last 5 seconds
    });

    it('should handle already unsubscribed users gracefully', async () => {
      const email = 'already-unsubscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      
      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');
    });

    it('should handle non-existent email addresses', async () => {
      const email = 'nonexistent@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(404);
      
      const html = await response.text();
      expect(html).toContain('Email Not Found');
      expect(html).toContain('This email address was not found in our newsletter subscription list');
    });

    it('should handle database errors gracefully', async () => {
      if (TEST_ENV !== 'local') return; // Skip for remote tests

      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // Mock database error
      vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(503);
      
      const html = await response.text();
      expect(html).toContain('Service Temporarily Unavailable');
      expect(html).toContain('Our unsubscribe service is temporarily unavailable');
    });
  });
```

### Test Suite 3: HTTP Request Handling Tests

```typescript
  describe('HTTP Request Handling', () => {
    it('should only accept GET requests', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');
      const methods = ['POST', 'PUT', 'DELETE', 'PATCH'];

      for (const method of methods) {
        const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
          method
        });

        expect(response.status).toBe(405);
        
        const html = await response.text();
        expect(html).toContain('Method Not Allowed');
      }
    });

    it('should handle URL encoded email addresses', async () => {
      const email = 'user+test@example.com';
      const encodedEmail = encodeURIComponent(email);
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      // First subscribe the user
      if (TEST_ENV === 'local') {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
          VALUES (?, ?, NULL, '192.168.1.1', 'GB')
        `).bind(email, new Date().toISOString()).run();
      }

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodedEmail}`);

      expect(response.status).toBe(200);
      
      const html = await response.text();
      expect(html).toContain('Successfully Unsubscribed');
    });

    it('should return proper CORS headers for any origin', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
        headers: {
          'Origin': 'https://mail.google.com'
        }
      });

      // Should allow any origin for email client compatibility
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('should handle malformed query parameters', async () => {
      const response = await makeRequest('/v1/newsletter/unsubscribe?token=&email=');

      expect(response.status).toBe(400);
      
      const html = await response.text();
      expect(html).toContain('Missing Parameters');
    });
  });
```

### Test Suite 4: HTML Response Tests

```typescript
  describe('HTML Response Generation', () => {
    it('should return proper HTML structure for success', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      
      // Check HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html>');
      expect(html).toContain('<head>');
      expect(html).toContain('<body>');
      expect(html).toContain('<title>Unsubscribed - Newsletter</title>');
      expect(html).toContain('<meta name="viewport"');
      
      // Check content
      expect(html).toContain('Successfully Unsubscribed');
      expect(html).toContain('You have been unsubscribed from our newsletter');
      expect(html).toContain('https://www.rnwolf.net/');
    });

    it('should return proper HTML structure for errors', async () => {
      const response = await makeRequest('/v1/newsletter/unsubscribe?token=invalid&email=test@example.com');

      expect(response.status).toBe(400);
      expect(response.headers.get('content-type')).toContain('text/html');
      
      const html = await response.text();
      
      // Check HTML structure
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Error - Newsletter Unsubscribe</title>');
      expect(html).toContain('Invalid Unsubscribe Link');
    });

    it('should include proper styling and responsive design', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      const html = await response.text();
      
      // Check for responsive meta tag
      expect(html).toContain('width=device-width, initial-scale=1.0');
      
      // Check for CSS styling
      expect(html).toContain('<style>');
      expect(html).toContain('font-family');
      expect(html).toContain('max-width');
      expect(html).toContain('margin: 0 auto');
    });
  });

  describe('Integration with Main Worker', () => {
    it('should be accessible via main worker routing', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`);

      expect(response.status).toBeLessThan(500); // Should not be 500 or "not implemented"
    });

    it('should work with existing CORS configuration', async () => {
      const email = 'subscribed@example.com';
      const token = generateTestUnsubscribeToken(email, env.HMAC_SECRET_KEY || 'test-secret');

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`, {
        method: 'OPTIONS'
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });
  });

  describe('Error Response Edge Cases', () => {
    it('should handle extremely long URLs gracefully', async () => {
      const longEmail = 'a'.repeat(1000) + '@example.com';
      const token = 'some-token';

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(longEmail)}`);

      expect(response.status).toBeLessThan(500);
      expect(response.headers.get('content-type')).toContain('text/html');
    });

    it('should handle special characters in email', async () => {
      const specialEmail = 'user+tag@ex-ample.co.uk';
      const token = generateTestUnsubscribeToken(specialEmail, env.HMAC_SECRET_KEY || 'test-secret');

      if (TEST_ENV === 'local') {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
          VALUES (?, ?, NULL, '192.168.1.1', 'GB')
        `).bind(specialEmail, new Date().toISOString()).run();
      }

      const response = await makeRequest(`/v1/newsletter/unsubscribe?token=${token}&email=${encodeURIComponent(specialEmail)}`);

      expect(response.status).toBeLessThan(500);
    });
  });
});
```

## Step 2: GREEN - Run Tests (They Should Fail)

At this point, if we run our tests, they should all fail because we haven't implemented the unsubscribe functionality yet:

```bash
npm run test:watch tests/unsubscribe.test.ts
```

Expected output:
```
❌ Token Validation > should accept valid HMAC tokens
❌ Token Validation > should reject invalid HMAC tokens
❌ Database Operations > should mark subscribed user as unsubscribed
❌ HTTP Request Handling > should only accept GET requests
❌ HTML Response Generation > should return proper HTML structure for success
... (all tests failing)
```

This is the **RED** phase - we have comprehensive failing tests that define exactly what our unsubscribe worker needs to do.

## Step 3: GREEN - Implement Minimal Code to Pass Tests

Now we implement the unsubscribe functionality to make our tests pass.

### Update Main Worker (src/index.ts)

Add the unsubscribe endpoint to the main worker:

```typescript
// Add after existing imports
import { handleUnsubscribe } from './unsubscribe-handler';

// Update the main fetch handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Access-Control-Allow-Origin': '*' // Allow any origin for unsubscribe
        }
      });
    }

    // Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      // ... existing health check code
    }

    // Newsletter subscription endpoint
    if (url.pathname === '/v1/newsletter/subscribe') {
      return handleSubscription(request, env);
    }

    // Newsletter unsubscribe endpoint
    if (url.pathname === '/v1/newsletter/unsubscribe') {
      return handleUnsubscribe(request, env);
    }

    return createCORSResponse('Not Found', 404);
  }
};
```

### Create Unsubscribe Handler (src/unsubscribe-handler.ts)

```typescript
interface Env {
  DB: D1Database;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

// HMAC token verification
function verifyUnsubscribeToken(email: string, token: string, secretKey: string): boolean {
  try {
    const crypto = require('crypto');
    const expectedToken = crypto.createHmac('sha256', secretKey).update(email).digest('hex');
    const expectedBase64 = Buffer.from(expectedToken).toString('base64url');
    
    return token === expectedBase64;
  } catch (error) {
    console.error('Token verification error:', error);
    return false;
  }
}

// HTML response generators
function generateSuccessHTML(email: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Unsubscribed - Newsletter</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .success-icon {
            color: #28a745;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #28a745;
            margin-bottom: 20px;
        }
        .email {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            margin: 20px 0;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Successfully Unsubscribed</h1>
        <p>You have been unsubscribed from our newsletter.</p>
        <div class="email">${email}</div>
        <p>We're sorry to see you go! If you change your mind, you can always resubscribe from our website.</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
        </div>
    </div>
</body>
</html>`;
}

function generateErrorHTML(title: string, message: string, statusCode: number = 400): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Error - Newsletter Unsubscribe</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            color: #dc3545;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #dc3545;
            margin-bottom: 20px;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>If you need help, please contact our support team.</p>
        </div>
    </div>
</body>
</html>`;
}

// Main unsubscribe handler
export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  console.log('handleUnsubscribe called', { method: request.method, url: request.url });

  // Only accept GET requests
  if (request.method !== 'GET') {
    const html = generateErrorHTML(
      'Method Not Allowed',
      'This unsubscribe link only accepts GET requests.',
      405
    );
    
    return new Response(html, {
      status: 405,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });
  }

  try {
    // Parse URL parameters
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const email = url.searchParams.get('email');

    console.log('Unsubscribe request:', { hasToken: !!token, email, hasEmail: !!email });

    // Validate parameters
    if (!token || !email || token.trim() === '' || email.trim() === '') {
      const html = generateErrorHTML(
        'Missing Parameters',
        'Both token and email parameters are required for unsubscribing.',
        400
      );
      
      return new Response(html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Verify HMAC token
    const isValidToken = verifyUnsubscribeToken(email, token, env.HMAC_SECRET_KEY);
    console.log('Token verification result:', isValidToken);

    if (!isValidToken) {
      const html = generateErrorHTML(
        'Invalid Unsubscribe Link',
        'This unsubscribe link is invalid or has expired. Please use the unsubscribe link from a recent newsletter email.',
        400
      );
      
      return new Response(html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Check if email exists in database
    console.log('Checking email in database...');
    const subscriber = await env.DB.prepare(
      'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
    ).bind(email).first();

    if (!subscriber) {
      console.log('Email not found in database');
      const html = generateErrorHTML(
        'Email Not Found',
        'This email address was not found in our newsletter subscription list.',
        404
      );
      
      return new Response(html, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Update database to mark as unsubscribed
    const now = new Date().toISOString();
    console.log('Updating database to mark as unsubscribed...');

    await env.DB.prepare(`
      UPDATE subscribers 
      SET unsubscribed_at = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE email = ?
    `).bind(now, email).run();

    console.log('Database updated successfully');

    // Return success HTML
    const html = generateSuccessHTML(email);
    
    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });

  } catch (error) {
    console.error('Unsubscribe error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Check for database-specific errors
    if (error.message?.includes('Database unavailable') ||
        error.message?.includes('D1_ERROR') ||
        error.message?.includes('database') ||
        error.name === 'DatabaseError') {
      
      const html = generateErrorHTML(
        'Service Temporarily Unavailable',
        'Our unsubscribe service is temporarily unavailable. Please try again later.',
        503
      );
      
      return new Response(html, {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Generic error for all other cases
    const html = generateErrorHTML(
      'An Error Occurred',
      'An unexpected error occurred while processing your unsubscribe request. Please try again.',
      500
    );
    
    return new Response(html, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
```

## Step 4: GREEN - Run Tests (They Should Pass)

Now run the tests again:

```bash
npm run test tests/unsubscribe.test.ts
```

Expected output:
```
✅ Token Validation > should accept valid HMAC tokens
✅ Token Validation > should reject invalid HMAC tokens
✅ Database Operations > should mark subscribed user as unsubscribed
✅ HTTP Request Handling > should only accept GET requests
✅ HTML Response Generation > should return proper HTML structure for success
... (all tests passing)
```

## Step 5: REFACTOR - Improve Code Quality

Now that all tests pass, we can refactor to improve code quality while keeping tests green:

### Create Unsubscribe Service (src/unsubscribe-service.ts)

Extract business logic into a dedicated service:

```typescript
export interface UnsubscribeResult {
  success: boolean;
  statusCode: number;
  html: string;
  error?: string;
}

export class UnsubscribeService {
  constructor(private db: D1Database, private hmacSecret: string) {}

  async processUnsubscribe(email: string, token: string): Promise<UnsubscribeResult> {
    try {
      // Verify token
      if (!this.verifyToken(email, token)) {
        return {
          success: false,
          statusCode: 400,
          html: this.generateErrorHTML(
            'Invalid Unsubscribe Link',
            'This unsubscribe link is invalid or has expired. Please use the unsubscribe link from a recent newsletter email.'
          ),
          error: 'Invalid token'
        };
      }

      // Check if email exists
      const subscriber = await this.findSubscriber(email);
      if (!subscriber) {
        return {
          success: false,
          statusCode: 404,
          html: this.generateErrorHTML(
            'Email Not Found',
            'This email address was not found in our newsletter subscription list.'
          ),
          error: 'Email not found'
        };
      }

      // Update database
      await this.markAsUnsubscribed(email);

      return {
        success: true,
        statusCode: 200,
        html: this.generateSuccessHTML(email)
      };

    } catch (error) {
      console.error('UnsubscribeService error:', error);
      
      if (this.isDatabaseError(error)) {
        return {
          success: false,
          statusCode: 503,
          html: this.generateErrorHTML(
            'Service Temporarily Unavailable',
            'Our unsubscribe service is temporarily unavailable. Please try again later.'
          ),
          error: 'Database error'
        };
      }

      return {
        success: false,
        statusCode: 500,
        html: this.generateErrorHTML(
          'An Error Occurred',
          'An unexpected error occurred while processing your unsubscribe request. Please try again.'
        ),
        error: 'Internal server error'
      };
    }
  }

  private verifyToken(email: string, token: string): boolean {
    try {
      const crypto = require('crypto');
      const expectedToken = crypto.createHmac('sha256', this.hmacSecret).update(email).digest('hex');
      const expectedBase64 = Buffer.from(expectedToken).toString('base64url');
      
      return token === expectedBase64;
    } catch (error) {
      console.error('Token verification error:', error);
      return false;
    }
  }

  private async findSubscriber(email: string): Promise<any> {
    return await this.db.prepare(
      'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
    ).bind(email).first();
  }

  private async markAsUnsubscribed(email: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE subscribers 
      SET unsubscribed_at = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE email = ?
    `).bind(now, email).run();
  }

  private isDatabaseError(error: any): boolean {
    return error.message?.includes('Database unavailable') ||
           error.message?.includes('D1_ERROR') ||
           error.message?.includes('database') ||
           error.name === 'DatabaseError';
  }

  private generateSuccessHTML(email: string): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Unsubscribed - Newsletter</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .success-icon {
            color: #28a745;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #28a745;
            margin-bottom: 20px;
        }
        .email {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            margin: 20px 0;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Successfully Unsubscribed</h1>
        <p>You have been unsubscribed from our newsletter.</p>
        <div class="email">${email}</div>
        <p>We're sorry to see you go! If you change your mind, you can always resubscribe from our website.</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
        </div>
    </div>
</body>
</html>`;
  }

  private generateErrorHTML(title: string, message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Error - Newsletter Unsubscribe</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            color: #dc3545;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #dc3545;
            margin-bottom: 20px;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>If you need help, please contact our support team.</p>
        </div>
    </div>
</body>
</html>`;
  }
}
```

### Create HTTP Handler (src/unsubscribe-http-handler.ts)

Extract HTTP handling logic:

```typescript
import { UnsubscribeService } from './unsubscribe-service';

export class UnsubscribeHTTPHandler {
  constructor(private unsubscribeService: UnsubscribeService) {}

  async handleRequest(request: Request): Promise<Response> {
    // Only accept GET requests
    if (request.method !== 'GET') {
      return this.methodNotAllowedResponse();
    }

    try {
      // Parse and validate parameters
      const { email, token, error } = this.parseParameters(request);
      
      if (error) {
        return this.missingParametersResponse();
      }

      // Process unsubscribe
      const result = await this.unsubscribeService.processUnsubscribe(email!, token!);
      
      return new Response(result.html, {
        status: result.statusCode,
        headers: this.getCORSHeaders()
      });

    } catch (error) {
      console.error('Unsubscribe HTTP handler error:', error);
      return this.internalErrorResponse();
    }
  }

  private parseParameters(request: Request): { email?: string; token?: string; error?: string } {
    try {
      const url = new URL(request.url);
      const token = url.searchParams.get('token');
      const email = url.searchParams.get('email');

      if (!token || !email || token.trim() === '' || email.trim() === '') {
        return { error: 'Missing parameters' };
      }

      return { email: email.trim(), token: token.trim() };
    } catch (error) {
      return { error: 'Invalid URL' };
    }
  }

  private getCORSHeaders(): Record<string, string> {
    return {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS'
    };
  }

  private methodNotAllowedResponse(): Response {
    const html = this.generateErrorHTML(
      'Method Not Allowed',
      'This unsubscribe link only accepts GET requests.'
    );
    
    return new Response(html, {
      status: 405,
      headers: this.getCORSHeaders()
    });
  }

  private missingParametersResponse(): Response {
    const html = this.generateErrorHTML(
      'Missing Parameters',
      'Both token and email parameters are required for unsubscribing.'
    );
    
    return new Response(html, {
      status: 400,
      headers: this.getCORSHeaders()
    });
  }

  private internalErrorResponse(): Response {
    const html = this.generateErrorHTML(
      'An Error Occurred',
      'An unexpected error occurred. Please try again later.'
    );
    
    return new Response(html, {
      status: 500,
      headers: this.getCORSHeaders()
    });
  }

  private generateErrorHTML(title: string, message: string): string {
    return `<!DOCTYPE html>
<html>
<head>
    <title>Error - Newsletter Unsubscribe</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            color: #dc3545;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #dc3545;
            margin-bottom: 20px;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>If you need help, please contact our support team.</p>
        </div>
    </div>
</body>
</html>`;
  }
}
```

### Refactored Main Handler (src/unsubscribe-handler.ts)

```typescript
import { UnsubscribeService } from './unsubscribe-service';
import { UnsubscribeHTTPHandler } from './unsubscribe-http-handler';

interface Env {
  DB: D1Database;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  console.log('handleUnsubscribe called', { method: request.method, url: request.url });

  // Initialize services
  const unsubscribeService = new UnsubscribeService(env.DB, env.HMAC_SECRET_KEY);
  const httpHandler = new UnsubscribeHTTPHandler(unsubscribeService);

  // Handle the request
  return await httpHandler.handleRequest(request);
}
```

## Step 6: Run Tests Again (Should Still Pass)

After refactoring, run tests to ensure we didn't break anything:

```bash
npm run test tests/unsubscribe.test.ts
```

All tests should still pass, confirming our refactoring was successful.

## Step 7: Add Additional Refactoring Tests

Now that we've refactored into separate classes, we can add unit tests for individual components:

**tests/unsubscribe-service.test.ts**:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { UnsubscribeService } from '../src/unsubscribe-service';

describe('UnsubscribeService', () => {
  it('should verify valid HMAC tokens correctly', async () => {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ email: 'test@example.com' }),
          run: vi.fn().mockResolvedValue({})
        })
      })
    } as any;

    const service = new UnsubscribeService(mockDB, 'test-secret');
    
    // Generate a valid token for testing
    const crypto = require('crypto');
    const email = 'test@example.com';
    const expectedToken = crypto.createHmac('sha256', 'test-secret').update(email).digest('hex');
    const validToken = Buffer.from(expectedToken).toString('base64url');

    const result = await service.processUnsubscribe(email, validToken);

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.html).toContain('Successfully Unsubscribed');
  });

  it('should reject invalid HMAC tokens', async () => {
    const mockDB = {} as any;
    const service = new UnsubscribeService(mockDB, 'test-secret');

    const result = await service.processUnsubscribe('test@example.com', 'invalid-token');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.html).toContain('Invalid Unsubscribe Link');
    expect(result.error).toBe('Invalid token');
  });

  it('should handle non-existent email addresses', async () => {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null)
        })
      })
    } as any;

    const service = new UnsubscribeService(mockDB, 'test-secret');
    
    // Generate valid token for non-existent email
    const crypto = require('crypto');
    const email = 'nonexistent@example.com';
    const expectedToken = crypto.createHmac('sha256', 'test-secret').update(email).digest('hex');
    const validToken = Buffer.from(expectedToken).toString('base64url');

    const result = await service.processUnsubscribe(email, validToken);

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.html).toContain('Email Not Found');
    expect(result.error).toBe('Email not found');
  });
});
```

## TDD Benefits Demonstrated

Through this TDD implementation, we've achieved:

### 1. **Comprehensive Test Coverage**
- ✅ Token validation (valid/invalid/wrong secret/different email)
- ✅ Database operations (mark unsubscribed/handle already unsubscribed/non-existent email)
- ✅ HTTP handling (GET only/CORS/URL encoding/parameter validation)
- ✅ HTML response generation (success/error pages/proper structure)

### 2. **Clear Requirements Definition**
- Tests serve as executable documentation
- Each test clearly defines expected behavior
- Edge cases are explicitly covered

### 3. **Refactor-Safe Code**
- Comprehensive test suite enables confident refactoring
- Separation of concerns improves maintainability
- Classes can be unit tested independently

### 4. **Error Handling**
- All error scenarios are tested first
- Graceful handling of database failures
- Proper HTTP status codes and HTML error pages

### 5. **Security Considerations**
- HMAC token validation tested thoroughly
- Input validation comprehensive
- CORS handling for email client compatibility

## Next Steps for Task 2.2

1. **Deploy to Local Environment**:
   ```bash
   npx wrangler dev --env local
   ```

2. **Test Against Local D1**:
   ```bash
   # Generate test token (you'll need a helper script)
   curl "http://localhost:8787/v1/newsletter/unsubscribe?token=TEST_TOKEN&email=test@example.com"
   ```

3. **Deploy to Staging**:
   ```bash
   npx wrangler deploy --env staging
   ```

4. **Run Integration Tests**:
   ```bash
   npm run test:staging tests/unsubscribe.test.ts
   ```

## Integration with Newsletter Scripts

The unsubscribe functionality integrates with the existing newsletter sender script:

- `newsletter_sender_script.py` generates unsubscribe tokens using the same HMAC-SHA256 algorithm
- Tokens are embedded in newsletter emails as one-click unsubscribe links
- Users clicking the link are processed by this unsubscribe worker
- Database is updated to mark users as unsubscribed

The TDD approach has given us a robust, well-tested unsubscribe worker that handles all the requirements defined in our specification. Each piece of functionality was driven by tests, ensuring comprehensive coverage and maintainable code.

**Ready to proceed with implementation using this TDD plan?**
      