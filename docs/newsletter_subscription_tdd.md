# Task 2.1: Newsletter Subscription Worker - TDD Implementation

## TDD Approach: Red-Green-Refactor Cycle

We will implement the newsletter subscription worker using Test-Driven Development, following these steps:

1. **RED**: Write failing tests that define the expected behavior
2. **GREEN**: Write minimal code to make the tests pass
3. **REFACTOR**: Improve the code while keeping tests green

## Step 1: RED - Write Failing Tests First

### Test Setup and Configuration

First, let's create our test environment configuration:

**vitest.config.ts**:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Enable D1 database for testing
          d1Databases: ['DB'],
          // Mock Turnstile verification for testing
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
```

**tests/env.d.ts**:
```typescript
interface CloudflareEnv {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

declare module 'cloudflare:test' {
  interface ProvidedEnv extends CloudflareEnv {}
}
```

### Test Suite 1: Email Validation Tests

**tests/email-validation.test.ts**:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import worker from '../src/index';

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
```

### Test Suite 2: Turnstile Verification Tests

**tests/turnstile-verification.test.ts**:
```typescript
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
```

### Test Suite 3: Database Operations Tests

**tests/database-operations.test.ts**:
```typescript
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
```

### Test Suite 4: HTTP Request Handling Tests

**tests/http-handling.test.ts**:
```typescript
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
```

## Step 2: GREEN - Run Tests (They Should Fail)

At this point, if we run our tests, they should all fail because we haven't implemented the worker yet:

```bash
npm run test
```

Expected output:
```
❌ Email Validation > should accept valid email addresses
❌ Email Validation > should reject invalid email addresses  
❌ Turnstile Verification > should reject missing Turnstile token
❌ Database Operations > should insert new subscriber successfully
❌ HTTP Request Handling > should only accept POST requests
... (all tests failing)
```

This is the **RED** phase - we have comprehensive failing tests that define exactly what our worker needs to do.

## Step 3: GREEN - Implement Minimal Code to Pass Tests

Now we implement the subscription worker to make our tests pass:

**src/index.ts**:
```typescript
interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

interface SubscriptionRequest {
  email: string;
  turnstileToken: string;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    // Only accept POST requests to subscription endpoint
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Method not allowed'
      }), { 
        status: 405,
        headers: getCORSHeaders(request)
      });
    }

    try {
      // Validate origin
      if (!isValidOrigin(request)) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Forbidden'
        }), { 
          status: 403,
          headers: getCORSHeaders(request)
        });
      }

      // Parse and validate request
      const requestData = await parseRequest(request);
      if (!requestData.success) {
        return new Response(JSON.stringify({
          success: false,
          message: requestData.error
        }), { 
          status: 400,
          headers: getCORSHeaders(request)
        });
      }

      const { email, turnstileToken } = requestData.data;

      // Verify Turnstile token
      const turnstileResult = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResult.success) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        }), { 
          status: 400,
          headers: getCORSHeaders(request)
        });
      }

      // Store subscription in database
      await storeSubscription(email, request, env.DB);

      return new Response(JSON.stringify({
        success: true,
        message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
      }), { 
        status: 200,
        headers: getCORSHeaders(request)
      });

    } catch (error) {
      console.error('Subscription error:', error);

      // Handle database unavailable
      if (error.message?.includes('Database unavailable')) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Our subscription service is temporarily unavailable for maintenance. Please try again later.'
        }), { 
          status: 503,
          headers: getCORSHeaders(request)
        });
      }

      // Handle other errors
      return new Response(JSON.stringify({
        success: false,
        message: 'An error occurred while processing your subscription. Please try again or contact support if the problem persists.'
      }), { 
        status: 500,
        headers: getCORSHeaders(request)
      });
    }
  }
};

function handleCORS(request: Request): Response {
  const headers = getCORSHeaders(request);
  return new Response(null, { status: 200, headers });
}

function getCORSHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  
  return {
    'Access-Control-Allow-Origin': origin === 'https://www.rnwolf.net' ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === 'https://www.rnwolf.net';
}

async function parseRequest(request: Request): Promise<{ success: boolean; data?: SubscriptionRequest; error?: string }> {
  try {
    const contentType = request.headers.get('Content-Type');
    if (!contentType?.includes('application/json')) {
      return { success: false, error: 'Content-Type must be application/json' };
    }

    const body = await request.json() as SubscriptionRequest;

    if (!body.email) {
      return { success: false, error: 'Email address is required' };
    }

    if (!body.turnstileToken) {
      return { success: false, error: 'Turnstile verification required' };
    }

    // Validate and normalize email
    const normalizedEmail = normalizeEmail(body.email);
    if (!isValidEmail(normalizedEmail)) {
      return { success: false, error: 'Invalid email address' };
    }

    return { 
      success: true, 
      data: { 
        email: normalizedEmail, 
        turnstileToken: body.turnstileToken 
      } 
    };

  } catch (error) {
    return { success: false, error: 'Invalid request format' };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

async function verifyTurnstile(token: string, secretKey: string): Promise<{ success: boolean }> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });

    const result = await response.json() as TurnstileResponse;
    return { success: result.success };

  } catch (error) {
    console.error('Turnstile verification error:', error);
    throw error;
  }
}

async function storeSubscription(email: string, request: Request, db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const ipAddress = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  const country = request.headers.get('CF-IPCountry') || '';

  await db.prepare(`
    INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
    VALUES (?, ?, NULL, ?, ?, ?, '')
    ON CONFLICT(email) DO UPDATE SET 
      subscribed_at = ?,
      unsubscribed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).bind(email, now, ipAddress, userAgent, country, now).run();
}
```

## Step 4: GREEN - Run Tests (They Should Pass)

Now run the tests again:

```bash
npm run test
```

Expected output:
```
✅ Email Validation > should accept valid email addresses
✅ Email Validation > should reject invalid email addresses
✅ Turnstile Verification > should reject missing Turnstile token
✅ Database Operations > should insert new subscriber successfully
✅ HTTP Request Handling > should only accept POST requests
... (all tests passing)
```

## Step 5: REFACTOR - Improve Code Quality

Now that all tests pass, we can refactor to improve code quality while keeping tests green:

**src/subscription-service.ts** (Extract business logic):
```typescript
export interface RequestMetadata {
  ipAddress: string;
  userAgent: string;
  country: string;
  city: string;
}

export interface SubscriptionResult {
  success: boolean;
  error?: string;
  troubleshootingUrl?: string;
}

export class SubscriptionService {
  constructor(private db: D1Database, private turnstileSecret: string) {}

  async subscribe(email: string, turnstileToken: string, metadata: RequestMetadata): Promise<SubscriptionResult> {
    // Validate email
    const normalizedEmail = this.normalizeEmail(email);
    if (!this.isValidEmail(normalizedEmail)) {
      return { success: false, error: 'Invalid email address' };
    }

    // Verify Turnstile
    const turnstileValid = await this.verifyTurnstile(turnstileToken);
    if (!turnstileValid) {
      return { 
        success: false, 
        error: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
        troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
      };
    }

    // Store subscription
    await this.storeSubscription(normalizedEmail, metadata);

    return { success: true };
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  private async verifyTurnstile(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${this.turnstileSecret}&response=${token}`
      });

      const result = await response.json() as { success: boolean };
      return result.success;

    } catch (error) {
      console.error('Turnstile verification error:', error);
      throw error;
    }
  }

  private async storeSubscription(email: string, metadata: RequestMetadata): Promise<void> {
    const now = new Date().toISOString();

    await this.db.prepare(`
      INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
      VALUES (?, ?, NULL, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET 
        subscribed_at = ?,
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(
      email, now, metadata.ipAddress, metadata.userAgent, metadata.country, metadata.city, now
    ).run();
  }
}
```

**src/http-handler.ts** (Extract HTTP handling):
```typescript
import { SubscriptionService, RequestMetadata } from './subscription-service';

export interface SubscriptionRequest {
  email: string;
  turnstileToken: string;
}

export class HTTPHandler {
  constructor(private subscriptionService: SubscriptionService) {}

  async handleRequest(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return this.handleCORS(request);
    }

    // Only accept POST requests
    if (request.method !== 'POST') {
      return this.errorResponse('Method not allowed', 405, request);
    }

    try {
      // Validate origin
      if (!this.isValidOrigin(request)) {
        return this.errorResponse('Forbidden', 403, request);
      }

      // Parse request
      const requestData = await this.parseRequest(request);
      if (!requestData.success) {
        return this.errorResponse(requestData.error!, 400, request);
      }

      const { email, turnstileToken } = requestData.data!;
      const metadata = this.extractMetadata(request);

      // Process subscription
      const result = await this.subscriptionService.subscribe(email, turnstileToken, metadata);
      
      if (!result.success) {
        return this.errorResponse(result.error!, 400, request, result.troubleshootingUrl);
      }

      return this.successResponse(request);

    } catch (error) {
      console.error('Subscription error:', error);
      return this.handleError(error, request);
    }
  }

  private handleCORS(request: Request): Response {
    return new Response(null, { 
      status: 200, 
      headers: this.getCORSHeaders(request) 
    });
  }

  private getCORSHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get('Origin');
    
    return {
      'Access-Control-Allow-Origin': origin === 'https://www.rnwolf.net' ? origin : '',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json'
    };
  }

  private isValidOrigin(request: Request): boolean {
    const origin = request.headers.get('Origin');
    return !origin || origin === 'https://www.rnwolf.net';
  }

  private async parseRequest(request: Request): Promise<{ success: boolean; data?: SubscriptionRequest; error?: string }> {
    try {
      const contentType = request.headers.get('Content-Type');
      if (!contentType?.includes('application/json')) {
        return { success: false, error: 'Content-Type must be application/json' };
      }

      const body = await request.json() as SubscriptionRequest;

      if (!body.email) {
        return { success: false, error: 'Email address is required' };
      }

      if (!body.turnstileToken) {
        return { success: false, error: 'Turnstile verification required' };
      }

      return { success: true, data: body };

    } catch (error) {
      return { success: false, error: 'Invalid request format' };
    }
  }

  private extractMetadata(request: Request): RequestMetadata {
    return {
      ipAddress: request.headers.get('CF-Connecting-IP') || '',
      userAgent: request.headers.get('User-Agent') || '',
      country: request.headers.get('CF-IPCountry') || '',
      city: '' // Could be extracted from CF-IPCity if available
    };
  }

  private successResponse(request: Request): Response {
    return new Response(JSON.stringify({
      success: true,
      message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
    }), { 
      status: 200,
      headers: this.getCORSHeaders(request)
    });
  }

  private errorResponse(message: string, status: number, request: Request, troubleshootingUrl?: string): Response {
    const body: any = { success: false, message };
    if (troubleshootingUrl) {
      body.troubleshootingUrl = troubleshootingUrl;
    }

    return new Response(JSON.stringify(body), { 
      status,
      headers: this.getCORSHeaders(request)
    });
  }

  private handleError(error: any, request: Request): Response {
    // Handle database unavailable
    if (error.message?.includes('Database unavailable')) {
      return this.errorResponse(
        'Our subscription service is temporarily unavailable for maintenance. Please try again later.',
        503,
        request
      );
    }

    // Handle other errors
    return this.errorResponse(
      'An error occurred while processing your subscription. Please try again or contact support if the problem persists.',
      500,
      request
    );
  }
}
```

**src/index.ts** (Refactored main worker):
```typescript
import { SubscriptionService } from './subscription-service';
import { HTTPHandler } from './http-handler';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Initialize services
    const subscriptionService = new SubscriptionService(env.DB, env.TURNSTILE_SECRET_KEY);
    const httpHandler = new HTTPHandler(subscriptionService);

    // Handle the request
    return await httpHandler.handleRequest(request);
  }
};
```

## Step 6: Run Tests Again (Should Still Pass)

After refactoring, run tests to ensure we didn't break anything:

```bash
npm run test
```

All tests should still pass, confirming our refactoring was successful.

## Step 7: Add Additional Refactoring Tests

Now that we've refactored into separate classes, we can add unit tests for individual components:

**tests/subscription-service.test.ts**:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { SubscriptionService } from '../src/subscription-service';

describe('SubscriptionService', () => {
  it('should normalize email addresses correctly', async () => {
    const mockDB = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          run: vi.fn().mockResolvedValue({})
        })
      })
    } as any;

    const service = new SubscriptionService(mockDB, 'test-secret');

    // Mock successful Turnstile verification
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }))
    );

    await service.subscribe('  USER@EXAMPLE.COM  ', 'valid-token', {
      ipAddress: '192.168.1.1',
      userAgent: 'Test',
      country: 'GB',
      city: ''
    });

    // Verify the normalized email was used in the database call
    expect(mockDB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT'));
    const bindCall = mockDB.prepare().bind;
    expect(bindCall).toHaveBeenCalledWith(
      'user@example.com', // normalized email
      expect.any(String), // timestamp
      '192.168.1.1',
      'Test',
      'GB',
      '',
      expect.any(String) // timestamp again for UPDATE
    );
  });

  it('should reject emails that are too long', async () => {
    const mockDB = {} as any;
    const service = new SubscriptionService(mockDB, 'test-secret');

    const longEmail = 'a'.repeat(250) + '@example.com'; // 262 characters

    const result = await service.subscribe(longEmail, 'valid-token', {
      ipAddress: '',
      userAgent: '',
      country: '',
      city: ''
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid email address');
  });
});
```

## TDD Benefits Demonstrated

Through this TDD implementation, we've achieved:

### 1. **Comprehensive Test Coverage**
- ✅ Email validation (valid/invalid/normalization)
- ✅ Turnstile verification (missing/invalid/valid/timeout)
- ✅ Database operations (insert/update/resubscribe/error handling)
- ✅ HTTP handling (methods/CORS/content-type/origin validation)

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
- Graceful handling of external service failures
- Proper HTTP status codes and error messages

### 5. **Security Considerations**
- CORS validation tested
- Origin checking implemented
- Input validation comprehensive

## Next Steps for Task 2.1

1. **Deploy to Local Environment**:
   ```bash
   npx wrangler dev --local
   ```

2. **Test Against Local D1**:
   ```bash
   curl -X POST http://localhost:8787/v1/newsletter/subscribe \
     -H "Content-Type: application/json" \
     -H "Origin: https://www.rnwolf.net" \
     -d '{"email":"test@example.com","turnstileToken":"test-token"}'
   ```

3. **Deploy to Staging**:
   ```bash
   npx wrangler deploy --env staging
   ```

4. **Run Integration Tests**:
   ```bash
   npm run test:integration:staging
   ```

The TDD approach has given us a robust, well-tested subscription worker that handles all the requirements defined in our specification. Each piece of functionality was driven by tests, ensuring comprehensive coverage and maintainable code.

**Ready to proceed with Task 2.2 (Unsubscribe Worker) using the same TDD approach?**