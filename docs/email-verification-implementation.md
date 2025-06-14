# Email verification Implementation

# Architecture

The solution architecture:

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

## Usage of queues in Worker Code

You can use the queues in your worker like this:

```typescript
// In your subscription handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // When user subscribes, queue verification email
    await env.EMAIL_VERIFICATION_QUEUE.send({
      email: "user@example.com",
      verificationToken: "abc123",
      subscriptionData: { /* ... */ }
    });

    return new Response("Check your email for verification");
  },

  // Queue consumer handler
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await sendVerificationEmail(message.body, env);
        message.ack();
      } catch (error) {
        console.error("Failed to send verification email:", error);
        message.retry();
      }
    }
  }
};
```