interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

interface SubscriptionRequest {
  email: string;
  turnstileToken: string;
}

interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS(request);
    }

    // Only accept POST requests to subscription endpoint
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        message: 'Method not allowed'
      }), {
        status: 405,
        headers: getCORSHeaders(request)
      });
    }

    try {
      // Validate origin
      if (!isValidOrigin(request)) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Forbidden'
        }), {
          status: 403,
          headers: getCORSHeaders(request)
        });
      }

      // Parse and validate request
      const requestData = await parseRequest(request);
      if (!requestData.success) {
        return new Response(JSON.stringify({
          success: false,
          message: requestData.error
        }), {
          status: 400,
          headers: getCORSHeaders(request)
        });
      }

      const { email, turnstileToken } = requestData.data;

      // Verify Turnstile token
      const turnstileResult = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!turnstileResult.success) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        }), {
          status: 400,
          headers: getCORSHeaders(request)
        });
      }

      // Store subscription in database
      await storeSubscription(email, request, env.DB);

      return new Response(JSON.stringify({
        success: true,
        message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
      }), {
        status: 200,
        headers: getCORSHeaders(request)
      });

    } catch (error) {
      console.error('Subscription error:', error);

      // Handle database unavailable
      if (error.message?.includes('Database unavailable')) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Our subscription service is temporarily unavailable for maintenance. Please try again later.'
        }), {
          status: 503,
          headers: getCORSHeaders(request)
        });
      }

      // Handle other errors
      return new Response(JSON.stringify({
        success: false,
        message: 'An error occurred while processing your subscription. Please try again or contact support if the problem persists.'
      }), {
        status: 500,
        headers: getCORSHeaders(request)
      });
    }
  }
};

function handleCORS(request: Request): Response {
  const headers = getCORSHeaders(request);
  return new Response(null, { status: 200, headers });
}

function getCORSHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');

  return {
    'Access-Control-Allow-Origin': origin === 'https://www.rnwolf.net' ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function isValidOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return !origin || origin === 'https://www.rnwolf.net';
}

async function parseRequest(request: Request): Promise<{ success: boolean; data?: SubscriptionRequest; error?: string }> {
  try {
    const contentType = request.headers.get('Content-Type');
    if (!contentType?.includes('application/json')) {
      return { success: false, error: 'Content-Type must be application/json' };
    }

    const body = await request.json() as SubscriptionRequest;

    if (!body.email) {
      return { success: false, error: 'Email address is required' };
    }

    if (!body.turnstileToken) {
      return { success: false, error: 'Turnstile verification required' };
    }

    // Validate and normalize email
    const normalizedEmail = normalizeEmail(body.email);
    if (!isValidEmail(normalizedEmail)) {
      return { success: false, error: 'Invalid email address' };
    }

    return {
      success: true,
      data: {
        email: normalizedEmail,
        turnstileToken: body.turnstileToken
      }
    };

  } catch (error) {
    return { success: false, error: 'Invalid request format' };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

async function verifyTurnstile(token: string, secretKey: string): Promise<{ success: boolean }> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });

    const result = await response.json() as TurnstileResponse;
    return { success: result.success };

  } catch (error) {
    console.error('Turnstile verification error:', error);
    throw error;
  }
}

async function storeSubscription(email: string, request: Request, db: D1Database): Promise<void> {
  const now = new Date().toISOString();
  const ipAddress = request.headers.get('CF-Connecting-IP') || '';
  const userAgent = request.headers.get('User-Agent') || '';
  const country = request.headers.get('CF-IPCountry') || '';

  await db.prepare(`
    INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
    VALUES (?, ?, NULL, ?, ?, ?, '')
    ON CONFLICT(email) DO UPDATE SET
      subscribed_at = ?,
      unsubscribed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).bind(email, now, ipAddress, userAgent, country, now).run();
}