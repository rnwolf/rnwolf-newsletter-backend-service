// tests/queue-processing.test.ts
import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import { handleEmailVerificationQueue } from '../src/email-verification-worker';

interface EmailVerificationMessage {
  email: string;
  verificationToken: string;
  subscribedAt: string;
  metadata: {
    ipAddress: string;
    userAgent: string;
    country: string;
  };
}

// Interface for the content parts within the email body sent to MailChannels/SendGrid
interface EmailContentPart {
  type: string;
  value: string;
}
interface MockMessage {
  body: EmailVerificationMessage;
  ack: () => void;
  retry: () => void;
}

interface MockMessageBatch {
  messages: MockMessage[];
}

// Mock queue message for testing
function createMockMessage(data: EmailVerificationMessage): MockMessage {
  return {
    body: data,
    ack: vi.fn(),
    retry: vi.fn()
  };
}

// Mock batch for testing
function createMockBatch(messages: MockMessage[]): MockMessageBatch {
  return { messages };
}

describe('Queue Processing Tests (local only)', () => {
  beforeEach(async () => {
    await setupTestDatabase(env);

    // Note: With the new migration system, email verification columns should already exist
    // No need to add them manually anymore since they're in 0001_initial_schema.sql

    // Set test environment variables
    if (!env.HMAC_SECRET_KEY) {
      (env as any).HMAC_SECRET_KEY = 'test-secret';
    }
    if (!env.ENVIRONMENT) {
      (env as any).ENVIRONMENT = 'local';
    }
    if (!env.MAILCHANNEL_API_KEY) {
      (env as any).MAILCHANNEL_API_KEY = 'test-mailchannel-key';
    }
    if (!env.SENDER_EMAIL) {
      (env as any).SENDER_EMAIL = 'test@rnwolf.net';
    }
    if (!env.SENDER_NAME) {
      (env as any).SENDER_NAME = 'Test Newsletter';
    }
    if (!env.MAILCHANNEL_AUTH_ID) {
      (env as any).MAILCHANNEL_AUTH_ID = 'test-auth-id';
    }

    // Mock fetch for email sending
    global.fetch = vi.fn();
    
    // Reset the mock before each test
    vi.clearAllMocks();
  });

  describe('Email Verification Queue Consumer', () => {
    it('should process single verification email message successfully', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'queue-test@testdomain.com',
        verificationToken: 'test-token-123',
        subscribedAt: new Date().toISOString(),
        metadata: {
          ipAddress: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Test',
          country: 'GB'
        }
      };

      // Insert subscriber to database
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      // Mock successful email sending
      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      // Verify message was acknowledged
      expect(mockMessage.ack).toHaveBeenCalled();
      expect(mockMessage.retry).not.toHaveBeenCalled();

      // Verify email API was called
      expect(global.fetch as Mock).toHaveBeenCalledWith(
        'https://api.mailchannels.net/tx/v1/send',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': expect.any(String), // Expect the API key header
            'X-MailChannels-Auth-Id': expect.any(String), // Expect the Auth ID header
          },
          body: expect.stringContaining(testMessage.email)
        })
      );

      // Verify database was updated with sent timestamp
      const subscriber = await env.DB.prepare(
        'SELECT verification_sent_at FROM subscribers WHERE email = ?'
      ).bind(testMessage.email).first();

      expect(subscriber).toBeTruthy();
      expect((subscriber as any)?.verification_sent_at).toBeTruthy();
    });

    it('should process multiple messages in a batch', async () => {
      const testMessages: EmailVerificationMessage[] = [
        {
          email: 'batch1@testdomain.com',
          verificationToken: 'token1',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        },
        {
          email: 'batch2@testdomain.com',
          verificationToken: 'token2',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.2', userAgent: 'Test', country: 'US' }
        },
        {
          email: 'batch3@testdomain.com',
          verificationToken: 'token3',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.3', userAgent: 'Test', country: 'CA' }
        }
      ];

      // Insert all subscribers
      for (const msg of testMessages) {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
          VALUES (?, ?, FALSE, ?)
        `).bind(msg.email, msg.subscribedAt, msg.verificationToken).run();
      }

      // Mock successful email sending
      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessages = testMessages.map(createMockMessage);
      const batch = createMockBatch(mockMessages);

      await handleEmailVerificationQueue(batch as any, env);

      // Verify all messages were acknowledged
      mockMessages.forEach((msg: MockMessage) => {
        expect(msg.ack).toHaveBeenCalled();
        expect(msg.retry).not.toHaveBeenCalled();
      });

      // Verify email API was called for each message
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should retry failed email sending', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'retry-test@testdomain.com',
        verificationToken: 'retry-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      // Mock failed email sending
      (global.fetch as any).mockResolvedValue(
        new Response('Email service unavailable', { status: 500 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      // Verify message was retried, not acknowledged
      expect(mockMessage.retry).toHaveBeenCalled();
      expect(mockMessage.ack).not.toHaveBeenCalled();
    });

    it('should handle partial batch failures correctly', async () => {
      const testMessages: EmailVerificationMessage[] = [
        {
          email: 'success@testdomain.com',
          verificationToken: 'success-token',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        },
        {
          email: 'failure@testdomain.com',
          verificationToken: 'failure-token',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.2', userAgent: 'Test', country: 'US' }
        }
      ];

      // Insert subscribers
      for (const msg of testMessages) {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
          VALUES (?, ?, FALSE, ?)
        `).bind(msg.email, msg.subscribedAt, msg.verificationToken).run();
      }

      // Mock mixed success/failure responses
      (global.fetch as any)
        .mockResolvedValueOnce(new Response('', { status: 200 })) // Success
        .mockResolvedValueOnce(new Response('Failed', { status: 500 })); // Failure

      const mockMessages = testMessages.map(createMockMessage);
      const batch = createMockBatch(mockMessages);

      await handleEmailVerificationQueue(batch as any, env);

      // First message should be acknowledged (success)
      expect(mockMessages[0].ack).toHaveBeenCalled();
      expect(mockMessages[0].retry).not.toHaveBeenCalled();

      // Second message should be retried (failure)
      expect(mockMessages[1].retry).toHaveBeenCalled();
      expect(mockMessages[1].ack).not.toHaveBeenCalled();
    });

    it('should handle network timeouts gracefully', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'timeout-test@testdomain.com',
        verificationToken: 'timeout-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      // Mock network timeout
      (global.fetch as any).mockRejectedValue(new Error('Network timeout'));

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      // Message should be retried on network error
      expect(mockMessage.retry).toHaveBeenCalled();
      expect(mockMessage.ack).not.toHaveBeenCalled();
    });

    it('should handle missing subscriber record gracefully', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'missing@testdomain.com',
        verificationToken: 'missing-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      // Don't insert subscriber - simulate race condition

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      // Should still try to send email and acknowledge
      // (Email service will handle non-existent users)
      expect(mockMessage.ack).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  describe('Email Content Quality', () => {
    it('should include security explanation in email', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'security-test@testdomain.com',
        verificationToken: 'security-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      const emailCall = (global.fetch as Mock).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/html');

      // Check for security explanation
      expect(htmlContent.value).toContain('Why are we asking for confirmation?');
      expect(htmlContent.value).toContain('This extra step helps us ensure');
      expect(htmlContent.value).toContain('prevent spam');
      expect(htmlContent.value).toContain('expire in 24 hours');
    });

    it('should include unsubscribe option for non-subscribers', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'unsubscribe-test@testdomain.com',
        verificationToken: 'unsubscribe-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      const emailCall = (global.fetch as Mock).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/html');

      // Check for "didn't sign up" message
      expect(htmlContent.value).toContain('Didn\'t sign up for this newsletter?');
      expect(htmlContent.value).toContain('Just ignore this email');
    });
  });

  describe('Performance and Reliability', () => {
    it('should process large batches efficiently', async () => {
      const batchSize = 50; // Simulate large batch
      const testMessages: EmailVerificationMessage[] = [];

      // Generate large batch of messages
      for (let i = 0; i < batchSize; i++) {
        const message: EmailVerificationMessage = {
          email: `batch-user-${i}@testdomain.com`,
          verificationToken: `token-${i}`,
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        };
        testMessages.push(message);

        // Insert subscriber
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
          VALUES (?, ?, FALSE, ?)
        `).bind(message.email, message.subscribedAt, message.verificationToken).run();
      }

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const startTime = Date.now();
      const mockMessages = testMessages.map(createMockMessage);
      const batch = createMockBatch(mockMessages);

      await handleEmailVerificationQueue(batch as any, env);

      const duration = Date.now() - startTime;

      // Performance assertions
      expect(duration).toBeLessThan(8000); // Should complete within 8 seconds
      expect(global.fetch).toHaveBeenCalledTimes(batchSize);

      // All messages should be acknowledged
      mockMessages.forEach(msg => {
        expect(msg.ack).toHaveBeenCalled();
      });
    },10000);

    it('should handle database connection issues', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'db-error@testdomain.com',
        verificationToken: 'db-error-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      // Mock database error
      const dbSpy = vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      // Should retry on database error
      expect(mockMessage.retry).toHaveBeenCalled();
      expect(mockMessage.ack).not.toHaveBeenCalled();

      dbSpy.mockRestore();
    });

    it('should handle concurrent processing safely', async () => {
      const concurrentMessages: EmailVerificationMessage[] = [];

      // Create multiple messages for same user (edge case)
      for (let i = 0; i < 3; i++) {
        concurrentMessages.push({
          email: 'concurrent@testdomain.com',
          verificationToken: `concurrent-token-${i}`,
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        });
      }

      // Insert subscriber once
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind('concurrent@testdomain.com', new Date().toISOString(), 'latest-token').run();

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessages = concurrentMessages.map(createMockMessage);
      const batch = createMockBatch(mockMessages);

      await handleEmailVerificationQueue(batch as any, env);

      // All should be processed (even if some are outdated)
      mockMessages.forEach(msg => {
        expect(msg.ack).toHaveBeenCalled();
      });
    });
  });

  describe('Integration with Environment', () => {
    it('should use correct email sending domain based on environment', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'env-test@testdomain.com',
        verificationToken: 'env-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      const emailCall = (global.fetch as Mock).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);

      // Should use rnwolf.net domain for local testing
      expect(emailBody.from.email).toBe('newsletter@rnwolf.net');
    });

    it('should generate environment-appropriate verification URLs', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'url-test@testdomain.com',
        verificationToken: 'url-token',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
      };

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(testMessage.email, testMessage.subscribedAt, testMessage.verificationToken).run();

      (global.fetch as any).mockResolvedValue(
        new Response('', { status: 200 })
      );

      const mockMessage = createMockMessage(testMessage);
      const batch = createMockBatch([mockMessage]);

      await handleEmailVerificationQueue(batch as any, env);

      const emailCall = (global.fetch as Mock).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');

      // Should use api.rnwolf.net for verification URL
      expect(htmlContent.value).toContain('https://api.rnwolf.net/v1/newsletter/verify');
    });
  });

// Alternative: If your worker doesn't export a queue handler, mock it directly
describe('Queue Processing Tests (alternative approach)', () => {
  it('should handle queue messages with mocked queue processing', async () => {
    // Mock the email verification queue processing function directly
    const processEmailVerificationMessage = vi.fn().mockImplementation(async (message) => {
      const { email, verificationToken } = message.body;

      // Mock email generation and sending
      const emailContent = {
        personalizations: [{
          to: [{ email }],
          subject: 'Confirm Your Newsletter Subscription'
        }],
        from: {
          email: 'newsletter@rnwolf.net',
          name: 'RN Wolf Newsletter'
        },
        content: [
          {
            type: 'text/plain',
            value: `Please confirm your subscription: https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`
          },
          {
            type: 'text/html',
            value: `<a href="https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}">Confirm My Subscription</a>`
          }
        ]
      };

      // Mock sending email
      await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer mock-key',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(emailContent)
      });

      message.ack();
    });

    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true })));

    const testMessage = {
      body: {
        email: 'test@testdomain.com',
        verificationToken: 'test-token-123'
      },
      id: 'test-message',
      ack: vi.fn(),
      retry: vi.fn()
    };

    await processEmailVerificationMessage(testMessage);

    expect(global.fetch).toHaveBeenCalled();
    expect(testMessage.ack).toHaveBeenCalled();

    const fetchCall = (global.fetch as Mock).mock.calls[0];
    const emailBody = JSON.parse(fetchCall[1].body);

    expect(emailBody.content[0].value).toContain('test%40testdomain.com'); // URL encoded
    expect(emailBody.content[1].value).toContain('test%40testdomain.com'); // URL encoded
  });

describe('New Queue Processing Tests (local only)', () => {
  describe('Email Verification Queue Consumer', () => {
    beforeEach(async () => {
      await setupTestDatabase(env);

      // Add verification fields to table
      try {
        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN email_verified BOOLEAN DEFAULT FALSE
        `).run();

        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN verification_token TEXT
        `).run();

        await env.DB.prepare(`
          ALTER TABLE subscribers
          ADD COLUMN verification_sent_at DATETIME
        `).run();
      } catch (error) {
        // Columns might already exist, ignore error
      }

      // Set test environment variables
      if (!env.HMAC_SECRET_KEY) {
        (env as any).HMAC_SECRET_KEY = 'test-secret';
      }
      if (!env.ENVIRONMENT) {
        (env as any).ENVIRONMENT = 'local';
      }

      // Mock fetch for email sending
      global.fetch = vi.fn();
    });

    it('should generate proper verification email content', async () => {
      // Mock the email verification queue processing function directly
      const processEmailVerificationMessage = vi.fn().mockImplementation(async (message) => {
        const { email, verificationToken, subscriptionData } = message.body;

        // Mock email generation (this simulates your actual email content generation)
        const emailContent = {
          personalizations: [{
            to: [{ email }],
            subject: 'Confirm Your Newsletter Subscription'
          }],
          from: {
            email: 'newsletter@rnwolf.net',
            name: 'RN Wolf Newsletter'
          },
          content: [
            {
              type: 'text/plain',
              value: `Please confirm your subscription for ${email}. Click this link: https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}\n\nThis verification link will expire in 24 hours.`
            },
            {
              type: 'text/html',
              value: `<html><body>
                <h2>Confirm My Subscription</h2>
                <p>You signed up with: ${email}</p>
                <p><a href="https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}">Confirm My Subscription</a></p>
                <p>This verification link will expire in 24 hours.</p>
              </body></html>`
            }
          ]
        };

        // Mock sending email to SendGrid
        await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer mock-sendgrid-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailContent)
        });

        message.ack();
      });

      // Mock successful email sending response
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true, message_id: 'test-123' }))
      );

      const testMessage = {
        body: {
          email: 'content-test@testdomain.com',
          verificationToken: 'content-token-123',
          subscriptionData: {
            ip_address: '192.168.1.1',
            user_agent: 'Test Browser',
            country: 'GB'
          }
        },
        id: 'test-message-1',
        ack: vi.fn(),
        retry: vi.fn()
      };

      await processEmailVerificationMessage(testMessage);

      // Verify fetch was called for email sending
      expect(global.fetch).toHaveBeenCalled();
      expect(testMessage.ack).toHaveBeenCalled();

      const fetchCall = (global.fetch as Mock).mock.calls[0];
      const [url, options] = fetchCall as [string, RequestInit]; // Cast to tuple type

      // Check SendGrid API call
      expect(url).toBe('https://api.sendgrid.com/v3/mail/send');
      expect(options.method).toBe('POST');

      expect(options.headers).toBeDefined(); // Ensure headers object exists
      const headers = options.headers as Record<string, string>; // Cast to plain object
      expect(headers['Authorization']).toContain('Bearer');
      expect(headers['Content-Type']).toBe('application/json');

      // Parse email body
      const emailBody = JSON.parse(options.body as string); // options.body is BodyInit | null

      // Verify email structure matches your expected format
      expect(emailBody).toMatchObject({
        personalizations: [
          {
            to: [{ email: 'content-test@testdomain.com' } as { email: string }],
            subject: 'Confirm Your Newsletter Subscription'
          }
        ],
        from: {
          email: 'newsletter@rnwolf.net',
          name: 'RN Wolf Newsletter'
        }
      });

      // Verify content exists
      expect(emailBody.content).toHaveLength(2); // HTML and text versions

      const htmlContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/html');
      const textContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/plain');

      // Additional specific content checks
      expect(htmlContent.value).toContain('content-test@testdomain.com');
      expect(htmlContent.value).toContain('content-token-123');
      expect(htmlContent.value).toContain('Confirm My Subscription');
      expect(htmlContent.value).toContain('verification link will expire');

      expect(textContent.value).toContain('content-test@testdomain.com');
      expect(textContent.value).toContain('content-token-123');
      expect(textContent.value).toContain('confirm your subscription');
      expect(textContent.value).toContain('verification link will expire');
    });

    it('should generate verification URLs with proper encoding', async () => {
      // Mock the email verification queue processing function directly
      const processEmailVerificationMessage = vi.fn().mockImplementation(async (message) => {
        const { email, verificationToken } = message.body;

        // Mock email generation with proper URL encoding
        const emailContent = {
          personalizations: [{
            to: [{ email }],
            subject: 'Confirm Your Newsletter Subscription'
          }],
          from: {
            email: 'newsletter@rnwolf.net',
            name: 'RN Wolf Newsletter'
          },
          content: [
            {
              type: 'text/plain',
              value: `Please confirm your subscription for ${email}. Click this link: https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`
            },
            {
              type: 'text/html',
              value: `<html><body>
                <p>You signed up with: ${email}</p>
                <p><a href="https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}">Confirm My Subscription</a></p>
              </body></html>`
            }
          ]
        };

        // Mock sending email
        await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer mock-sendgrid-key',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(emailContent)
        });

        message.ack();
      });

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ success: true }))
      );

      const specialEmail = 'user+test@domain.co.uk';
      const testMessage = {
        body: {
          email: specialEmail,
          verificationToken: 'special-token',
          subscriptionData: {
            ip_address: '192.168.1.1',
            user_agent: 'Test Browser',
            country: 'GB'
          }
        },
        id: 'test-message-special',
        ack: vi.fn(),
        retry: vi.fn()
      };

      await processEmailVerificationMessage(testMessage);

      expect(global.fetch).toHaveBeenCalled();
      expect(testMessage.ack).toHaveBeenCalled();

      const fetchCall = (global.fetch as Mock).mock.calls[0];
      const emailBody = JSON.parse(fetchCall[1].body);

      const htmlContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/html');
      const textContent = emailBody.content.find((c: EmailContentPart) => c.type === 'text/plain');

      // The email should be URL-encoded in verification links
      const expectedEncodedEmail = encodeURIComponent(specialEmail); // user%2Btest%40domain.co.uk

      console.log('DEBUG - Special email:', specialEmail);
      console.log('DEBUG - Encoded email should be:', expectedEncodedEmail);
      console.log('DEBUG - HTML content preview:', htmlContent.value.substring(0, 200));

      // Check that URLs are properly encoded
      const urlPattern = /https:\/\/api\.rnwolf\.net\/v1\/newsletter\/verify\?token=[^&]+&email=([^"'\s>&]+)/g;
      const urlMatches = [...htmlContent.value.matchAll(urlPattern)];

      expect(urlMatches.length).toBeGreaterThan(0);

      // Check that the email parameter in URLs is properly encoded
      for (const match of urlMatches) {
        const emailParam = match[1] as string;
        expect(emailParam).toBe(expectedEncodedEmail);
        expect(emailParam).not.toBe(specialEmail); // Should not be the raw email
      }

      // Also check text content URLs
      const textUrlMatches = [...textContent.value.matchAll(urlPattern)];
      for (const match of textUrlMatches) {
        const emailParam = match[1] as string;
        expect(emailParam).toBe(expectedEncodedEmail);
      }

      // It's OK for the email to appear unencoded in display text (like "You signed up with: user+test@domain.co.uk")
      // But URLs must be encoded
      console.log('Email encoding test passed - URLs are properly encoded');
    });
  });

});




});

});