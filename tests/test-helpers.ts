import { env } from 'cloudflare:test';

// Get environment from ENV variable, default to local
const TEST_ENV = (env.ENVIRONMENT || 'local');

// Helper function to generate unique test emails
export function generateTestEmail(base: string): string {
  const senderEmail = env.SENDER_EMAIL;
  if (!senderEmail || !senderEmail.includes('@')) {
    // Fallback to example.com if SENDER_EMAIL is not set or invalid
    const domain = 'example.com';
    if (TEST_ENV === 'local') {
      return `${base.split('@')[0]}@${domain}`;
    }
    const timestamp = Date.now();
    return `${base.split('@')[0]}-${timestamp}@${domain}`;
  }

  const domain = senderEmail.split('@')[1];
  const localPart = base.split('@')[0];

  if (TEST_ENV === 'local') {
    return `${localPart}@${domain}`;
  }

  const timestamp = Date.now();
  return `${localPart}+${timestamp}@${domain}`;
}
