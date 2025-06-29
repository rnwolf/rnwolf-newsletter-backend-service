// Helper function to mask email addresses for logging (PII protection)
function maskEmailForLogging(email: string): string {
  if (!email || !email.includes('@')) {
    return 'invalid-email';
  }
  const [localPart, domain] = email.split('@');
  const maskedLocal = localPart.length > 3 ? localPart.substring(0, 3) + '***' : '***';
  return `${maskedLocal}@${domain}`;
}

interface Env {
  DB: D1Database;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

// HMAC token verification
function verifyUnsubscribeToken(email: string, token: string, secretKey: string): boolean {
  try {
    const crypto = require('crypto');
    const expectedToken = crypto.createHmac('sha256', secretKey).update(email).digest('hex');
    const expectedBase64 = Buffer.from(expectedToken).toString('base64url');

    // Strip padding from both tokens for comparison
    const normalizedInputToken = token.replace(/=+$/, '');
    const normalizedExpectedToken = expectedBase64.replace(/=+$/, '');

    return normalizedInputToken === normalizedExpectedToken;
  } catch (error) {
    console.error('Token verification error:', error);
    return false;
  }
}

// HTML response generators
function generateSuccessHTML(email: string): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Unsubscribed - Newsletter</title>
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
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Successfully Unsubscribed</h1>
        <p>You have been unsubscribed from our newsletter.</p>
        <div class="email">${email}</div>
        <p>We're sorry to see you go! If you change your mind, you can always resubscribe from our website.</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
        </div>
    </div>
</body>
</html>`;
}

function generateErrorHTML(title: string, message: string, statusCode: number = 400): string {
  return `<!DOCTYPE html>
<html>
<head>
    <title>Error - Newsletter Unsubscribe</title>
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
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">⚠</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
            <p><a href="https://www.rnwolf.net/">Return to main site</a></p>
            <p>If you need help, please contact our support team.</p>
        </div>
    </div>
</body>
</html>`;
}

// Main unsubscribe handler
export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  console.log('handleUnsubscribe called', { method: request.method, url: request.url });

  // Only accept GET requests
  if (request.method !== 'GET') {
    const html = generateErrorHTML(
      'Method Not Allowed',
      'This unsubscribe link only accepts GET requests.',
      405
    );

    return new Response(html, {
      status: 405,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });
  }

  try {
    // Parse URL parameters
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const email = url.searchParams.get('email');

    console.log('Unsubscribe request:', { hasToken: !!token, email: email ? maskEmailForLogging(email) : 'undefined', hasEmail: !!email });

    // Validate parameters
    if (!token || !email || token.trim() === '' || email.trim() === '') {
      const html = generateErrorHTML(
        'Missing Parameters',
        'Both token and email parameters are required for unsubscribing.',
        400
      );

      return new Response(html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Verify HMAC token
    const isValidToken = verifyUnsubscribeToken(email, token, env.HMAC_SECRET_KEY);
    console.log('Token verification result:', isValidToken);

    if (!isValidToken) {
      const html = generateErrorHTML(
        'Invalid Unsubscribe Link',
        'This unsubscribe link is invalid or has expired. Please use the unsubscribe link from a recent newsletter email.',
        400
      );

      return new Response(html, {
        status: 400,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Check if email exists in database
    console.log('Checking email in database...');
    const subscriber = await env.DB.prepare(
      'SELECT email, subscribed_at, unsubscribed_at FROM subscribers WHERE email = ?'
    ).bind(email).first();

    if (!subscriber) {
      console.log('Email not found in database');
      const html = generateErrorHTML(
        'Email Not Found',
        'This email address was not found in our newsletter subscription list.',
        404
      );

      return new Response(html, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Update database to mark as unsubscribed
    const now = new Date().toISOString();
    console.log('Updating database to mark as unsubscribed...');

    await env.DB.prepare(`
      UPDATE subscribers
      SET unsubscribed_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE email = ?
    `).bind(now, email).run();

    console.log('Database updated successfully');

    // Return success HTML
    const html = generateSuccessHTML(email);

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS'
      }
    });

  } catch (error) {
    console.error('Unsubscribe error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : undefined;

    // Check for database-specific errors (case-insensitive)
    if (errorMessage?.toLowerCase().includes('database unavailable') ||
        errorMessage?.toLowerCase().includes('database connection failed') ||
        errorMessage?.toLowerCase().includes('d1_error') ||
        errorMessage?.toLowerCase().includes('database') ||
        errorName === 'DatabaseError') {

      const html = generateErrorHTML(
        'Service Temporarily Unavailable',
        'Our unsubscribe service is temporarily unavailable. Please try again later.',
        503
      );

      return new Response(html, {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*'
        }
      });
    }

    // Generic error for all other cases
    const html = generateErrorHTML(
      'An Error Occurred',
      'An unexpected error occurred while processing your unsubscribe request. Please try again.',
      500
    );

    return new Response(html, {
      status: 500,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}