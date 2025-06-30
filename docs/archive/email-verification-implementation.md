# Email verification Implementation

# Solution flow

Left to right flow:

```
User Subscribes → Turnstile Check → Database: unverified → Redirect to newsletter_next → Queue Message → Email Worker → Verification Email
     ↓                  ↓                   ↓                      ↓                                                            │
   Form Submit    Bot Protection      Record Created        Static Page Message                                                 │
                     Pass/Fail                             "Check your email"                                                   │
                                                                                                                                │
                                                                                                                          User Clicks Link
                                                                                                                                │
                                                                                                                                ↓
                                                                                                                         Confirm Worker
                                                                                                                                ↓
                                                                                                                        Database: verified
```

Solution workflow top to bottom:

```
1. User Subscribes (Form Submit)
   ↓
2. Cloudflare Turnstile Verification
   ├─ FAIL → Return error to user
   └─ PASS → Continue
   ↓
3. Database: Create unverified subscriber
   ↓
4. Redirect to newsletter_next page
   ↓ (async)
5. Queue verification email message
   ↓
6. Email Worker processes queue
   ↓
7. Send Verification Email to user
   ↓
8. User receives email and clicks verification link
   ↓
9. Verification endpoint (Confirm Worker)
   ↓
10. Database: Mark subscriber as verified
```

## Key Security & Flow details:

1. Form Submit: User fills out subscription form
2. Turnstile Challenge: Client-side bot protection widget
3. Turnstile Verification: Server-side validation of Turnstile token
4. Database Record: Only created if Turnstile passes
5. User Feedback: Immediate redirect to newsletter_next (no waiting for email)
6. Email Queue: Asynchronous email sending (doesn't slow down user experience)
7. Send Email: Crate email and send to user via SMTP server
8. Email Verification: Second layer of verification via email click

We have two layers of verification:

 - Layer 1: Turnstile (prevents bots from subscribing)
 - Layer 2: Email verification (confirms email ownership)

# Queues

## Key Points about the design

Queue Names:

    Environment-specific (e.g., email-verification-queue-staging) to avoid conflicts between environments.

Dead Letter Queues:

    Also environment-specific to keep failed messages separate per environment.

JSON Structure:

    The queues object contains both producers and consumers arrays.

Binding:

    The EMAIL_VERIFICATION_QUEUE binding will be available in your worker code as env.EMAIL_VERIFICATION_QUEUE.

## Infrastructure

### Creating the Queues

Before this configuration will work, you need to create the actual queues in Cloudflare:

This is based on the configuration in the `wrangler.jsonc` file.

```bash
# Create queues for each environment
wrangler queues create email-verification-queue --env local
wrangler queues create email-verification-dlq --env local

wrangler queues create email-verification-queue-staging --env staging
wrangler queues create email-verification-dlq-staging --env staging

wrangler queues create email-verification-queue-production --env production
wrangler queues create email-verification-dlq-production --env production
```
