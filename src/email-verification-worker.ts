// src/email-verification-worker.ts
// Queue consumer for sending verification emails

// Helper function to mask email addresses for logging (PII protection)
function maskEmailForLogging(email: string): string {
  if (!email || !email.includes('@')) {
    return 'invalid-email';
  }
  const [localPart, domain] = email.split('@');
  const maskedLocal = localPart.length > 3 ? localPart.substring(0, 3) + '***' : '***';
  return `${maskedLocal}@${domain}`;
}

export interface EmailVerificationMessage {
  email: string;
  verificationToken: string;
  subscribedAt: string;
  metadata: {
    ipAddress: string;
    userAgent: string;
    country: string;
  };
}

interface Env {
  DB: D1Database;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  EMAIL_VERIFICATION_QUEUE: Queue;
  MAILCHANNEL_API_KEY: string; // Added for MailChannels
  SENDER_EMAIL: string;
  SENDER_NAME: string;
  MAILCHANNEL_AUTH_ID?: string; // Optional
}

export default {
  async queue(batch: MessageBatch<EmailVerificationMessage>, env: Env): Promise<void> {
    console.log(`Processing ${batch.messages.length} email verification messages`);

    for (const message of batch.messages) {
      try {
        await processVerificationEmail(message.body, env);
        message.ack(); // Acknowledge successful processing
      } catch (error) {
        console.error('Failed to process verification email:', error);
        // Don't ack - message will be retried
        message.retry();
      }
    }
  }
};

async function processVerificationEmail(data: EmailVerificationMessage, env: Env): Promise<void> {
  const { email, verificationToken, subscribedAt, metadata } = data;

  console.log(`Sending verification email to: ${maskEmailForLogging(email)}`);

  // Generate verification URL
  const verificationUrl = `https://api.rnwolf.net/v1/newsletter/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

  // Create verification email content
  const emailContent = generateVerificationEmail(email, verificationUrl, subscribedAt);

  try {
    // Send email using MailChannels (or your preferred email service)
    await sendVerificationEmail(email, emailContent, env);

    console.log(`Verification email sent successfully to: ${maskEmailForLogging(email)}`);

    // Optional: Update database to track email sent
    await env.DB.prepare(`
      UPDATE subscribers
      SET verification_sent_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `).bind(email).run();

  } catch (error) {
    console.error(`Failed to send verification email to ${email}:`, error);
    throw error; // This will cause the message to be retried
  }
}

function generateVerificationEmail(email: string, verificationUrl: string, subscribedAt: string): { subject: string; html: string; text: string } {
  const subject = 'Please confirm your newsletter subscription';

  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirm Your Newsletter Subscription</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .confirm-button {
            background-color: #007cba;
            color: white;
            padding: 15px 30px;
            text-decoration: none;
            border-radius: 5px;
            display: inline-block;
            margin: 20px 0;
            font-weight: bold;
        }
        .confirm-button:hover {
            background-color: #005a87;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        .security-note {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Confirm Your Newsletter Subscription</h1>
        <p>Hi there!</p>
        <p>You recently signed up for our newsletter with this email address: <strong>${email}</strong></p>
        <p>To complete your subscription and start receiving our monthly newsletter, please click the button below:</p>

        <a href="${verificationUrl}" class="confirm-button">Confirm My Subscription</a>

        <div class="security-note">
            <strong>Why are we asking for confirmation?</strong><br>
            This extra step helps us ensure that only you can subscribe this email address to our newsletter. It also helps prevent spam and protects your inbox.
        </div>

        <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
        <p style="word-break: break-all; font-family: monospace; background: #f8f9fa; padding: 10px; border-radius: 4px;">
            ${verificationUrl}
        </p>
        </br>
        <p>After you have clicked on the link please hit the reply to this email and let me know what country you are in. This is to help me understand where my readers are located and to improve the content I send out.</p>
        <p>Thanks Rüdiger!</p>
        </br>
        <div class="footer">
            <p><strong>Didn't sign up for this newsletter?</strong><br>
            No worries! Just ignore this email and you won't receive any future messages from us.</p>

            <p>This verification link will expire in 24 hours for security reasons.</p>

            <p>Visit our website: <a href="https://www.rnwolf.net/">www.rnwolf.net</a></p>
        </div>
    </div>
</body>
</html>`;

  const text = `
Confirm Your Newsletter Subscription

Hi there!

You recently signed up for our newsletter with this email address: ${email}

To complete your subscription and start receiving our monthly newsletter, please click this link:
${verificationUrl}

After you have clicked on the link please hit the reply to this email and let me know what country you are in. This is to help me understand where my readers are located and to improve the content I send out.
Thanks Rüdiger!


Why are we asking for confirmation?
This extra step helps us ensure that only you can subscribe this email address to our newsletter. It also helps prevent spam and protects your inbox.

Didn't sign up for this newsletter?
No worries! Just ignore this email and you won't receive any future messages from us.

This verification link will expire in 24 hours for security reasons.

Visit our website: https://www.rnwolf.net/
`;

  return { subject, html, text };
}

async function sendVerificationEmail(email: string, content: { subject: string; html: string; text: string }, env: Env): Promise<void> {
  // Using MailChannels (free tier is discontinued but paid tier available)

  // Check if this is a test email and skip actual sending in non-production environments
  const testEmailDomains = [
    '@example.com',
    '@example.org', 
    '@example.net',
    '@test.com',
    '@test.example.com',
    '@performance-test.example.com',
    '@smoke-test.example.com'
  ];
  
  // Also check for plus addressing test patterns (test+something@domain)
  const isTestEmailDomain = testEmailDomains.some(domain => email.endsWith(domain));
  const isTestEmailPlusAddressing = email.includes('+smoke-test') || email.includes('+staging-smoke-test') || email.startsWith('test+');
  
  const isTestEmail = isTestEmailDomain || isTestEmailPlusAddressing;
  
  if (isTestEmail) {
    console.log(`[TEST_EMAIL_SKIP] Skipping actual email send for test email: ${maskEmailForLogging(email)} (environment: ${env.ENVIRONMENT})`);
    
    // In staging/local environments, don't send emails to test domains
    if (env.ENVIRONMENT !== 'production') {
      console.log(`[TEST_EMAIL_SKIP] Test email blocked in ${env.ENVIRONMENT} environment`);
      return; // Do not proceed to send the email
    } else {
      // In production, log warning but allow (in case someone actually uses example.com)
      console.warn(`[TEST_EMAIL_WARNING] Attempting to send to test domain in production: ${email}`);
    }
  }

  if (!env.MAILCHANNEL_API_KEY) {
    console.error('MAILCHANNEL_API_KEY is not defined. Email sending will fail.');
    throw new Error('MailChannels API key is not configured.');
  }

  if (!env.SENDER_EMAIL || !env.SENDER_NAME) {
    console.error('SENDER_EMAIL or SENDER_NAME is not defined. Email sending will fail.');
    throw new Error('SENDER_EMAIL or SENDER_NAME is not configured.');
  }

  const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.MAILCHANNEL_API_KEY, // Add the API key header
      'X-MailChannels-Auth-Id': env.MAILCHANNEL_AUTH_ID || '' // Optional, if you have an auth ID
    },
    body: JSON.stringify({
      personalizations: [
        {
          to: [{ email: email }],
        }
      ],
      from: {
        email: env.SENDER_EMAIL,
        name: env.SENDER_NAME,
      },
      subject: content.subject,
      content: [
        {
          type: 'text/plain',
          value: content.text
        },
        {
          type: 'text/html',
          value: content.html
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to send email: ${response.status} ${errorText}`);
  }
}

// Add this to your main worker's queue handler
export async function handleEmailVerificationQueue(batch: MessageBatch<EmailVerificationMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processVerificationEmail(message.body, env);
      message.ack();
    } catch (error) {
      console.error('Email verification failed:', error);
      message.retry();
    }
  }
}