// tests/queue-processing.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  describe('Email Verification Queue Consumer', () => {
    it('should process single verification email message successfully', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'queue-test@example.com',
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
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.mailchannels.net/tx/v1/send',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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
          email: 'batch1@example.com',
          verificationToken: 'token1',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        },
        {
          email: 'batch2@example.com',
          verificationToken: 'token2',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.2', userAgent: 'Test', country: 'US' }
        },
        {
          email: 'batch3@example.com',
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
      mockMessages.forEach(msg => {
        expect(msg.ack).toHaveBeenCalled();
        expect(msg.retry).not.toHaveBeenCalled();
      });

      // Verify email API was called for each message
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should retry failed email sending', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'retry-test@example.com',
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
          email: 'success@example.com',
          verificationToken: 'success-token',
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        },
        {
          email: 'failure@example.com',
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
        email: 'timeout-test@example.com',
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

    it('should generate proper verification email content', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'content-test@example.com',
        verificationToken: 'content-token-123',
        subscribedAt: new Date().toISOString(),
        metadata: { ipAddress: '192.168.1.1', userAgent: 'Test Browser', country: 'GB' }
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

      // Verify email content structure
      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);

      expect(emailBody).toMatchObject({
        personalizations: [
          {
            to: [{ email: testMessage.email }],
            dkim_domain: 'rnwolf.net',
            dkim_selector: 'mailchannels'
          }
        ],
        from: {
          email: 'newsletter@rnwolf.net',
          name: 'RN Wolf Newsletter'
        },
        subject: 'Please confirm your newsletter subscription',
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text/plain',
            value: expect.stringContaining('confirm your subscription')
          }),
          expect.objectContaining({
            type: 'text/html',
            value: expect.stringContaining('Confirm My Subscription')
          })
        ])
      });

      // Verify verification URL is included
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');
      expect(htmlContent.value).toContain(`https://api.rnwolf.net/v1/newsletter/verify?token=${testMessage.verificationToken}`);
      expect(htmlContent.value).toContain(encodeURIComponent(testMessage.email));
    });

    it('should handle missing subscriber record gracefully', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'missing@example.com',
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
    it('should generate verification URLs with proper encoding', async () => {
      const specialEmail = 'user+test@domain.co.uk';
      const testMessage: EmailVerificationMessage = {
        email: specialEmail,
        verificationToken: 'special-token',
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

      // Check that special characters in email are properly encoded
      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');

      expect(htmlContent.value).toContain(encodeURIComponent(specialEmail));
      expect(htmlContent.value).not.toContain('user+test@domain.co.uk'); // Should be encoded
    });

    it('should include security explanation in email', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'security-test@example.com',
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

      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');

      // Check for security explanation
      expect(htmlContent.value).toContain('Why are we asking for confirmation?');
      expect(htmlContent.value).toContain('This extra step helps us ensure');
      expect(htmlContent.value).toContain('prevent spam');
      expect(htmlContent.value).toContain('expire in 24 hours');
    });

    it('should include unsubscribe option for non-subscribers', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'unsubscribe-test@example.com',
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

      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');

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
          email: `batch-user-${i}@example.com`,
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
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
      expect(global.fetch).toHaveBeenCalledTimes(batchSize);

      // All messages should be acknowledged
      mockMessages.forEach(msg => {
        expect(msg.ack).toHaveBeenCalled();
      });
    });

    it('should handle database connection issues', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'db-error@example.com',
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
          email: 'concurrent@example.com',
          verificationToken: `concurrent-token-${i}`,
          subscribedAt: new Date().toISOString(),
          metadata: { ipAddress: '192.168.1.1', userAgent: 'Test', country: 'GB' }
        });
      }

      // Insert subscriber once
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind('concurrent@example.com', new Date().toISOString(), 'latest-token').run();

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
        email: 'env-test@example.com',
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

      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);

      // Should use rnwolf.net domain for local testing
      expect(emailBody.from.email).toBe('newsletter@rnwolf.net');
      expect(emailBody.personalizations[0].dkim_domain).toBe('rnwolf.net');
    });

    it('should generate environment-appropriate verification URLs', async () => {
      const testMessage: EmailVerificationMessage = {
        email: 'url-test@example.com',
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

      const emailCall = (global.fetch as any).mock.calls[0];
      const emailBody = JSON.parse(emailCall[1].body);
      const htmlContent = emailBody.content.find((c: any) => c.type === 'text/html');

      // Should use api.rnwolf.net for verification URL
      expect(htmlContent.value).toContain('https://api.rnwolf.net/v1/newsletter/verify');
    });
  });
});