# TDD Implementation Guide: Email Verification Phase 1

## Overview

This guide walks you through implementing email verification using Test-Driven Development (TDD), starting with **Phase 1: Fix Subscription Flow Tests**. 

The tests are designed to **fail initially** (RED phase) and define the correct behavior according to the C4 model.

## Files Created

### 1. Test Files (RED Phase)
- `tests/subscription-with-verification.test.ts` - Tests for updated subscription flow
- `tests/email-verification-migration.test.ts` - Tests for database migration

### 2. Migration File
- `migrations/002_add_email_verification.sql` - Database schema changes

### 3. Helper Scripts
- `scripts/run-email-verification-tdd.sh` - TDD test runner

## TDD Implementation Process

### Step 1: Run RED Tests (They Should Fail)

```bash
# Make the script executable
chmod +x scripts/run-email-verification-tdd.sh

# Run the TDD test suite (these should fail)
./scripts/run-email-verification-tdd.sh
```

**Expected Result:** Most tests should fail because the implementation doesn't match the C4 model yet.

### Step 2: Apply Database Migration (GREEN Phase Start)

```bash
# Apply the migration to local database
npm run db:migrate:verification:local

# Or manually:
npx wrangler d1 execute DB --env local --file=./migrations/002_add_email_verification.sql
```

**Expected Result:** Migration tests should now pass.

### Step 3: Update Subscription Handler (GREEN Phase)

The main implementation needed is in `src/index.ts` in the `handleSubscription` function. 

**Current Behavior (WRONG):**
```typescript
// Store as verified subscriber immediately  
await storeSubscription(email, request, env.DB);

return createCORSResponse({
  success: true,
  message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
});
```

**Required Behavior (CORRECT per C4 model):**
```typescript
// Generate verification token
const verificationToken = generateVerificationToken(email, env.HMAC_SECRET_KEY);

// Store as UNVERIFIED subscriber
await storeUnverifiedSubscription(email, verificationToken, request, env.DB);

// Queue verification email
await env.EMAIL_VERIFICATION_QUEUE.send({
  email,
  verificationToken,
  subscribedAt: now,
  metadata: {
    ipAddress: request.headers.get('CF-Connecting-IP') || '',
    userAgent: request.headers.get('User-Agent') || '',
    country: request.headers.get('CF-IPCountry') || ''
  }
});

return createCORSResponse({
  success: true,
  message: 'Please check your email and click the verification link to complete your subscription.'
});
```

### Step 4: Implement Required Functions

You'll need to create these functions:

1. **Token Generation Function:**
```typescript
function generateVerificationToken(email: string, secretKey: string): string {
  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const message = `${email}:${timestamp}`;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(`${token}:${timestamp}`).toString('base64url');
}
```

2. **Unverified Subscription Storage:**
```typescript
async function storeUnverifiedSubscription(
  email: string, 
  verificationToken: string, 
  request: Request, 
  db: D1Database
): Promise<void> {
  const now = new Date().toISOString();
  const ipAddress = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  const country = request.headers.get('CF-IPCountry') || '';

  await db.prepare(`
    INSERT INTO subscribers (
      email, 
      subscribed_at, 
      unsubscribed_at, 
      email_verified, 
      verification_token, 
      verification_sent_at,
      ip_address, 
      user_agent, 
      country, 
      city
    )
    VALUES (?, ?, NULL, FALSE, ?, ?, ?, ?, ?, '')
    ON CONFLICT(email) DO UPDATE SET 
      subscribed_at = ?,
      unsubscribed_at = NULL,
      email_verified = FALSE,
      verification_token = ?,
      verification_sent_at = ?,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    email, now, verificationToken, now, 
    ipAddress, userAgent, country,
    now, verificationToken, now
  ).run();
}
```

### Step 5: Test GREEN Phase

After implementing the changes:

```bash
# Run TDD tests again - more should pass now
./scripts/run-email-verification-tdd.sh

# Run specific test suites
npm run test tests/subscription-with-verification.test.ts
npm run test tests/