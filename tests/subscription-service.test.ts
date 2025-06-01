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