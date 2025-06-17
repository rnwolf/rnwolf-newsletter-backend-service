// src/email-verification-handler.ts
// Handle email verification confirmation clicks

interface Env {
  DB: D1Database;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

export async function handleEmailVerification(request: Request, env: Env): Promise<Response> {
  console.log('handleEmailVerification called', { method: request.method, url: request.url });

  const permissiveCORSHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Only accept GET requests
  if (request.method !== 'GET') {
    return generateErrorResponse(
      'Method Not Allowed',
      'This verification link only accepts GET requests.',
      405
    );
  }

  try {
    // Parse URL parameters
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const email = url.searchParams.get('email');

    console.log('Verification request:', { hasToken: !!token, email });

    // Validate parameters
    if (!token || !email || token.trim() === '' || email.trim() === '') {
      return generateErrorResponse(
        'Missing Parameters',
        'Both verification token and email are required.',
        400
      );
    }

    // Verify token (24 hour expiry)
    const isValidToken = verifyVerificationToken(email, token, env.HMAC_SECRET_KEY, 24 * 60 * 60 * 1000);
    console.log('Token verification result:', isValidToken);

    if (!isValidToken) {
      return generateErrorResponse(
        'Invalid or Expired Link',
        'This verification link is invalid or has expired. Please try subscribing again.',
        400
      );
    }

    // Check if email exists and is unverified
    const subscriber = await env.DB.prepare(
      'SELECT email, email_verified, verification_token FROM subscribers WHERE email = ?'
    ).bind(email).first();

    if (!subscriber) {
      return generateErrorResponse(
        'Subscription Not Found',
        'This email address was not found in our subscription list. Please try subscribing again.',
        404
      );
    }

    if (subscriber.email_verified) {
      // Already verified - show success anyway
      return generateSuccessResponse(email, true);
    }

    // Verify the token matches what's in the database
    if (subscriber.verification_token !== token) {
      return generateErrorResponse(
        'Invalid Token',
        'This verification token does not match our records. Please try subscribing again.',
        400
      );
    }

    // Mark email as verified
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE subscribers
      SET email_verified = TRUE,
          verified_at = ?,
          verification_token = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `).bind(now, email).run();

    console.log('Email verified successfully:', email);

    return generateSuccessResponse(email, false);

  } catch (error) {
    console.error('Email verification error:', error);

    if (error instanceof Error && error.message.toLowerCase().includes('database')) {
      return generateErrorResponse(
        'Service Temporarily Unavailable',
        'Our verification service is temporarily unavailable. Please try again later.',
        503
      );
    }

    return generateErrorResponse(
      'An Error Occurred',
      'An unexpected error occurred during verification. Please try again.',
      500
    );
  }
}

function generateSuccessResponse(email: string, alreadyVerified: boolean): Response {
  const title = alreadyVerified ? 'Already Confirmed' : 'Email Confirmed!';
  const message = alreadyVerified
    ? 'Your email address was already confirmed for our newsletter.'
    : 'Thank you! Your email address has been confirmed and you\'re now subscribed to our newsletter.';

  const html = `<!DOCTYPE html>
<html>
<head>
    <title>${title} - Newsletter</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .success-icon {
            color: #28a745;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #28a745;
            margin-bottom: 20px;
        }
        .email {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: monospace;
            margin: 20px 0;
            word-break: break-all;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        .next-steps {
            background: #e8f5e8;
            padding: 20px;
            border-radius: 4px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="email">${email}</div>

        ${!alreadyVerified ? `
        <div class="next-steps">
            <h3>What happens next?</h3>
            <p>You'll receive our monthly newsletter with interesting content, links, and updates. We typically send one email per month, and you can unsubscribe at any time using the link in each email.</p>
        </div>
        ` : ''}

        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>Thank you for subscribing to our newsletter!</p>
        </div>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function generateErrorResponse(title: string, message: string, statusCode: number): Response {
  const html = `<!DOCTYPE html>
<html>
<head>
    <title>Error - Newsletter Verification</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 40px 20px;
            background-color: #f8f9fa;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            text-align: center;
        }
        .error-icon {
            color: #dc3545;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #dc3545;
            margin-bottom: 20px;
        }
        .footer {
            margin-top: 30px;
            font-size: 14px;
            color: #666;
        }
        a {
            color: #0066cc;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .retry-box {
            background: #fff3cd;
            padding: 15px;
            border-radius: 4px;
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>${title}</h1>
        <p>${message}</p>

        <div class="retry-box">
            <p><strong>Want to try again?</strong><br>
            Visit our <a href="https://www.rnwolf.net/">website</a> and subscribe with the newsletter form.</p>
        </div>

        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>If you need help, please contact our support team.</p>
        </div>
    </div>
</body>
</html>`;

  return new Response(html, {
    status: statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

// Token verification function (same as in subscription worker)
function verifyVerificationToken(email: string, token: string, secretKey: string, maxAgeMs: number = 24 * 60 * 60 * 1000): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [tokenHash, timestamp] = decoded.split(':');

    // Check if token is expired
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > maxAgeMs) {
      return false;
    }

    // Verify token
    const crypto = require('crypto');
    const message = `${email}:${timestamp}`;
    const expectedHash = crypto.createHmac('sha256', secretKey).update(message).digest('hex');

    return tokenHash === expectedHash;
  } catch (error) {
    console.error('Token verification error:', error);
    return false;
  }
}