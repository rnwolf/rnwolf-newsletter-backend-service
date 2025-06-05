# Claude Code AI Development of a Cloudflare hosted newsletter subscription service

## The Problem

I have a personal website and blog. There might be people who want an occasional email newsletter.
My previous implementation using google function did not use bot protection which resulted in most of the registrations being bot users. Why they would want to signup for an email newsletter is beyond me.

## The Context

The website is hosted at Cloudflare and thus it seems logical to make use of "Cloudflare Workers" to implement the newsletter functionality.
With the advent of AI coding assistants it also presented it self as an opportunity to apply recommended practices to develop the solution.

## The Solution

I am working with Claude.ai, via browser.

Design Specification Document Prompt:
```
I am hosting a MkDocs static website at cloudflare.
I have setup a cloudflare worker to create CSP record for scripts. That is all working ok.
I want to create a page and another cloudflare worker to allow users to signup for newsletter.  Can you help create a Design-Specification-Document for this newsletter subscription service. Please ask me questions one at a time to help crate this specification.
```

### Key solution documents

After numerous questions, answers and further clarifications we ended up with the following key documents:

| Document Name                      | Purpose                                                 |
|------------------------------------|---------------------------------------------------------|
| newsletter_design_spec.md          | Design Specification Document |
| newsletter_backend_deployment.md   | Repository Setup & Deployment Guide |
| newsletter_sdlc_pipeline.md        | SDLC for the newsletter service, from local development through to production |
| newsletter_implementation_tasks.md | Implementation Task List |

Software Development Life Cycle = SDLC

The above documents are then used as context to create a detailed task list with code and instructions to implement each of the **implementation tasks**.

### Implementation Details for each task

| Document Name                     | Purpose                                                       |
|-----------------------------------|---------------------------------------------------------------|
| newsletter_subscription_tdd.md    | Task 2.1: Newsletter Subscription Worker - TDD Implementation |

The alignment between the document above and the actual implementation got a bit fuzzy as I had ongoing conversations with Claude.ai as I worked on implementing the code. I asked questions about the work as we progressed and then claude.ai and I made suggestion about what to do next as we progressed.

## Cloudflare Turnstile Key Types & Security Model

One of the problems I had with my previous online webform was the many bot submissions. I need to try someway to key them out as sending emails to bots is likely to taint the reputation of my email address, which will result in my emails ending up in spam folders.

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


## Fetching subscribers from D1

Fetches active subscribers from your Cloudflare D1 database
Saves them to a CSV file with tracking columns
Shows subscriber statistics by country
Tests database connection before running

How to run the script:

1. install uv

    https://docs.astral.sh/uv/getting-started/installation/#installation-methods

2. Make sure environment variable are loaded

    ```
    export $(cat .env | xargs)  # or source .env
    ```

3. Run the script

    ```
    ⬢ ❯ cd scripts
    ⬢ ❯ uv run subscriber_fetcher_script.py
    ```

    Expected output:

    ```
    Newsletter Subscriber Fetcher
    ========================================
    Testing D1 database connection...
    ✓ Database connection successful. Total subscribers: 3
    Fetching subscribers from D1 database...
    Found 3 active subscribers
    Subscribers saved to subscribers.csv

    Subscriber Summary:
    Total active subscribers: 3

    By country:
    GB: 3

    ✓ Successfully exported subscribers to subscribers.csv
    You can now run the newsletter sender script.
    ```


## Sending Newsletter Script

Once you have downloaded you current subscribers.csv and you have published a newsletter to the blog you can use `newsletter_sender_script.py` to send emails.

### Features:

- Rate limited email sending, email providers do not like it if you send out lots of email and might flag you as a spammer!
- Restartable (tracks progress in CSV file) so that you can stop and restart sending process. Sending is logged to file.
- Configurable SMTP settings for your email provider.
- Error handling and logging.
- Unsubscribe token generation to embed link in newsletter email.
- Markdown to HTML/Text conversion for newsletter content (Reuses the published newsletter markdown file)
- Parses the newsletter markdown file and extracts frontmatter to reuse data
    - Uses title for email subject line
    - Generates blog URL from slug and created date
- Shows a mini-preview of the newsletter before sending to make sure its all as expected
- Generates the blog URL using the pattern: https://www.rnwolf.net/blog/{year}/{slug}/ should user wish to read in web browser.
- Creates both text and HTML versions of the email so that users always get readable content.
- Adds the custom intro message to remind people that they actually subscribed to the newsletter. We don't want them flagging email as spam!
    >   "You signed up for this newsletter on Sign-Up Date. Just making sure you know this isn't spam. 😊"
        "Don't want to hear from me anymore? No problem — there's a one-click unsubscribe link"

- Newsletter get includes unsubscribe links
- Alerts user if markdown file is marked as draft, and is this not yet published to the blog!
- Requires the path to blog newsletter markdown file, either via parameter or prompt

3. Markdown to HTML/Text Conversion

Uses the markdown library with extensions for:

Code highlighting
Tables
Fenced code blocks
Table of contents
And more


Run the script with uv command:
```
# Provide markdown file as argument
uv run newsletter_sender_script.py "/path/to/your/newsletter.md"

# Or run without argument and get prompted for file path
uv run newsletter_sender_script.py

# Check sending status
uv run newsletter_sender_script.py status
```

Example Output:

```
Newsletter Preview:
  Title: New website newsletter sign-up
  Description: How I added a newsletter sign-up form to my static website blog using Claude.AI.
  Slug: new_newsletter_sign_up_via_cloudflare_developed_with_claude_ai
  Created: 2024-06-04T11:00:00Z
  Draft: true
  Content length: 1250 characters
  Content preview: # How I Built This Newsletter System

In this post, I'll walk through...

⚠️  WARNING: This post is marked as DRAFT
Continue with draft post? (y/N): y
2025-06-05 12:27:12,364 - INFO - Total subscribers: 3
2025-06-05 12:27:12,365 - INFO - Already sent: 0
2025-06-05 12:27:12,365 - INFO - Pending: 2

Send newsletter 'New website newsletter sign-up' to 3 subscribers? (y/N): y
2025-06-05 12:27:13,348 - INFO - Starting newsletter send with 60.0s delay between emails
2025-06-05 12:27:13,348 - INFO - Sending 1/2 to rudiger.wolf@throughputfocus.com
2025-06-05 12:27:15,279 - INFO - ✓ Sent to rudiger.wolf@throughputfocus.com
2025-06-05 12:27:15,279 - INFO - Waiting 60.0 seconds...
2025-06-05 12:28:17,174 - INFO - Sending 2/2 to rudi@rnwolf.net
2025-06-05 12:28:19,132 - INFO - ✓ Sent to rudi@rnwolf.net
2025-06-05 12:28:20,595 - INFO -
Newsletter sending complete!
2025-06-05 12:28:20,595 - INFO - Successful: 2
2025-06-05 12:28:20,595 - INFO - Errors: 0
2025-06-05 12:28:20,595 - INFO - Total processed: 2
```