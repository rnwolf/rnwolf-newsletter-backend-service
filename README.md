# Claude Code AI Development of a Cloudflare hosted newsletter subscription service

## The Problem

I have a personal website and blog. There might be people who want an occasional email newsletter.
My previous implementation using google function did not use bot protection which resulted in most of the registrations being bot users. Why they would want to signup for an email newsletter is beyond me.

## The Context

The website is hosted at Cloudflare and thus it seems logical to make use of "Cloudflare Workers" to implement the newsletter functionality.
With the advent of AI coding assistants it also presented it self as an opportunity to apply recommended practices to develop the solution.

## The Solution

I am working with Claude Code via browser.

Design Specification Document Prompt:
```
I am hosting a MkDocs static website at cloudflare.
I have setup a cloudflare worker to create CSP record for scripts. That is all working ok.
I want to create a page and another cloudflare worker to allow users to signup for newsletter.  Can you help create a Design-Specification-Document for this newsletter subscription service. Please ask me questions one at a time to help crate this specification.
```

After numerous questions and some suggestions we ended up with the following specification:

SDLC Specification Document Prompt:
```
Explain the SDLC that we will use.  I want to know what the development steps are from local development environment to test environment hosted in cloudflare and then finally the deployment to production environment.
Remembers that we have a versioned API url, so that breaking changes will be deployed to a new end point before we retire the old API.
We this need to be really clear on the overall pipeline from local dev to production. What the current live multiple versions of API are, and how we go about retiring superseded endpoints.
```

Task 2.1: Newsletter Subscription Worker - TDD Implementation Prompt:
```
Proceed with the TDD demonstration for Task 2.1: Create Subscription Worker
```

## Cloudflare Turnstile Key Types & Security Model

### Site Key (Public) - Safe to Expose

- Purpose: Identifies your site to Cloudflare's Turnstile service
- Location: Frontend JavaScript (visible to everyone)
- Security: ✅ Designed to be public
- Analogy: Like a "return address" on an envelope

### Secret Key (Private) - Must Stay Hidden

- Purpose: Server-side verification of Turnstile responses
- Location: Your Cloudflare Workers environment variables
- Security: ❌ Must never be exposed
- Analogy: Like a private password for verification

### How Turnstile Security Works

1. Frontend (Public Site Key)     →  Turnstile Challenge
2. User Completes Challenge       →  Turnstile Token Generated
3. Frontend Sends Token to API    →  Your Newsletter API
4. API Verifies Token (Secret)    →  Cloudflare Verification API
5. Cloudflare Confirms Valid      →  Subscription Allowed

### Why Site Keys Are Safe to Expose

- Domain Validation: Site keys only work on domains you've registered
- No Direct Access: Site key can't bypass verification - only initiate challenges
- Token Required: Each challenge generates a unique token that must be verified server-side
- Rate Limiting: Cloudflare handles abuse prevention at their level

## Deployment and testing commands

### Make sure Cloudflare CLI for development is installed

#### Update Wrangler to latest version

`npm install -g wrangler@latest`

#### Or if using npx, clear cache and use latest

`npx clear-npx-cache
npx wrangler@latest --version`

#### Set the new token (this will update your existing token)

`npx wrangler auth`

#### Or set it as an environment variable

`export CLOUDFLARE_API_TOKEN=your_new_token_here`

### Local Development

#### Test local development

`npm run dev`

#### Test health check

`curl http://localhost:8787`

Expect : `{"success":true,"message":"Newsletter API is running!","database":"Connected","environment":"local"}`

#### Test subscription

`
curl -X POST http://localhost:8787/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
`
Expect: `{"success":true,"message":"Thank you for subscribing! You'll receive our monthly newsletter with interesting content and links."}`

#### Run test suite and test locally

`npm test`

Expect output similar to:

```
 ✓ tests/api.test.ts (21 tests) 1222ms
   ✓ API Tests (local environment) > CORS Configuration > should handle OPTIONS preflight requests correctly 63ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in successful POST responses 62ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in error responses 46ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in health check responses 51ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in 404 responses 45ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in method not allowed responses 56ms
   ✓ API Tests (local environment) > CORS Configuration > should handle multiple CORS preflight scenarios 59ms
   ✓ API Tests (local environment) > Health Check > should return healthy status 51ms
   ✓ API Tests (local environment) > Newsletter Subscription > should accept valid email subscription 56ms
   ✓ API Tests (local environment) > Newsletter Subscription > should reject invalid email addresses 61ms
   ✓ API Tests (local environment) > Newsletter Subscription > should require email field 44ms
   ✓ API Tests (local environment) > Newsletter Subscription > should normalize email addresses 64ms
   ✓ API Tests (local environment) > Newsletter Subscription > should handle duplicate subscriptions 56ms
   ✓ API Tests (local environment) > Newsletter Subscription > should reject non-POST requests 49ms
   ✓ API Tests (local environment) > Error Handling > should return 404 for unknown endpoints 48ms
   ✓ API Tests (local environment) > Error Handling > should handle malformed JSON 65ms
   ✓ API Tests (local environment) > Error Response Handling > should return proper error structure for invalid email 56ms
   ✓ API Tests (local environment) > Error Response Handling > should return proper error structure for missing email 47ms
   ✓ API Tests (local environment) > Error Response Handling > should return troubleshooting URL for Turnstile failures 50ms
   ✓ API Tests (local environment) > Error Response Handling > should include debug info only in staging environment 43ms
   ✓ API Tests (local environment) > Error Response Handling > should handle network timeouts gracefully 45ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  22:24:29
   Duration  3.86s (transform 145ms, setup 0ms, collect 174ms, tests 1.22s, environment 1ms, prepare 338ms)
```

### Move code to Staging environment

#### Deploy Code

`npm run deploy:staging`

#### Test health check to confirm worker is running

`curl https://api-staging.rnwolf.net/health`

Expect : `{"success":true,"message":"Newsletter API is running!","database":"Connected","environment":"local"}`


#### Test subscription again

`
curl -X POST https://api-staging.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-test@example.com"}'
`

Expect: `{"success":true,"message":"Thank you for subscribing! You'll receive our monthly newsletter with interesting content and links."}`

#### Verify subscriber was added to remote database

`
npx wrangler d1 execute DB --env staging --remote --command="SELECT * FROM subscribers;"
`
Expect something similar to:


```
 Executing on remote database DB (149f8e5b-2fc1-41f0-8ed0-74b3d00e1da2):
🌀 To execute on your local development database, remove the --remote flag from your wrangler command.
🚣 Executed 1 command in 0.5478ms
┌────┬──────────────────────────┬──────────────────────────┬─────────────────┬──────────────┬─────────────┬─────────┬──────┬─────────────────────┬─────────────────────┐
│ id │ email                    │ subscribed_at            │ unsubscribed_at │ ip_address   │ user_agent  │ country │ city │ created_at          │ updated_at          │
├────┼──────────────────────────┼──────────────────────────┼─────────────────┼──────────────┼─────────────┼─────────┼──────┼─────────────────────┼─────────────────────┤
│ 1  │ test@test.com            │ 2025-06-03T08:25:38.837Z │ null            │ 81.78.190.37 │ curl/7.81.0 │ GB      │      │ 2025-06-03 08:25:39 │ 2025-06-03 08:25:39 │
├────┼──────────────────────────┼──────────────────────────┼─────────────────┼──────────────┼─────────────┼─────────┼──────┼─────────────────────┼─────────────────────┤
│ 2  │ staging-test@example.com │ 2025-06-04T21:35:59.434Z │ null            │ 81.78.190.37 │ curl/7.81.0 │ GB      │      │ 2025-06-04 21:35:59 │ 2025-06-04 21:35:59 │
└────┴──────────────────────────┴──────────────────────────┴─────────────────┴──────────────┴─────────────┴─────────┴──────┴─────────────────────┴─────────────────────┘

```

#### Run test suite and against staging

`npm run test:staging`

Expect output similar to:

```
✓ tests/api.test.ts (21 tests) 991ms
   ✓ API Tests (local environment) > CORS Configuration > should handle OPTIONS preflight requests correctly 44ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in successful POST responses 40ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in error responses 36ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in health check responses 38ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in 404 responses 26ms
   ✓ API Tests (local environment) > CORS Configuration > should include CORS headers in method not allowed responses 29ms
   ✓ API Tests (local environment) > CORS Configuration > should handle multiple CORS preflight scenarios 40ms
   ✓ API Tests (local environment) > Health Check > should return healthy status 37ms
   ✓ API Tests (local environment) > Newsletter Subscription > should accept valid email subscription 44ms
   ✓ API Tests (local environment) > Newsletter Subscription > should reject invalid email addresses 37ms
   ✓ API Tests (local environment) > Newsletter Subscription > should require email field 72ms
   ✓ API Tests (local environment) > Newsletter Subscription > should normalize email addresses 65ms
   ✓ API Tests (local environment) > Newsletter Subscription > should handle duplicate subscriptions 52ms
   ✓ API Tests (local environment) > Newsletter Subscription > should reject non-POST requests 42ms
   ✓ API Tests (local environment) > Error Handling > should return 404 for unknown endpoints 37ms
   ✓ API Tests (local environment) > Error Handling > should handle malformed JSON 44ms
   ✓ API Tests (local environment) > Error Response Handling > should return proper error structure for invalid email 43ms
   ✓ API Tests (local environment) > Error Response Handling > should return proper error structure for missing email 49ms
   ✓ API Tests (local environment) > Error Response Handling > should return troubleshooting URL for Turnstile failures 52ms
   ✓ API Tests (local environment) > Error Response Handling > should include debug info only in staging environment 47ms
   ✓ API Tests (local environment) > Error Response Handling > should handle network timeouts gracefully 47ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
   Start at  22:40:21
   Duration  2.38s (transform 90ms, setup 0ms, collect 118ms, tests 991ms, environment 1ms, prepare 204ms)
```

### Move code to Production environment

#### Deploy Code

`npm run deploy:production`

#### Set production secrets

npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put HMAC_SECRET_KEY --env production

#### Verify production secrets are set

npx wrangler secret list --env production

#### Run the migration

npm run db:migrate:production

#### Or run it directly with the --remote flag

npx wrangler d1 execute DB --env production --remote --file=./migrations/001_initial_schema.sql

#### Test all functionality in production (including CORS)

`npm run test:production`

#### Test the API directly

curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.rnwolf.net" \
  -d '{"email":"migration-test@example.com"}'

#### Monitor logs while testing

npx wrangler tail --env production

#### Check if subscriber was added

npx wrangler d1 execute DB --env production --remote --command="SELECT * FROM subscribers WHERE email='migration-test@example.com';"

#### Check if the table exists in production

npx wrangler d1 execute DB --env production --remote --command="SELECT name FROM sqlite_master WHERE type='table';"

#### Check the table structure

npx wrangler d1 execute DB --env production --remote --command="PRAGMA table_info(subscribers);"
