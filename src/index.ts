import { handleUnsubscribe } from './unsubscribe-handler';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

// CORS configuration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.rnwolf.net',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

// Helper function to add CORS headers to any response
function addCORSHeaders(response: Response): Response {
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...Object.fromEntries(response.headers.entries()),
      ...CORS_HEADERS
    }
  });
  return newResponse;
}

// Helper function to create a response with CORS headers
function createCORSResponse(body: any, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS
  });
}

// Function to handle newsletter subscription
async function handleSubscription(request: Request, env: Env): Promise<Response> {
  console.log('handleSubscription called', { method: request.method, url: request.url });

  if (request.method !== 'POST') {
    console.log('Method not allowed:', request.method);
    return createCORSResponse({
      success: false,
      message: 'Method not allowed'
    }, 405);
  }

  try {
    console.log('Parsing request body...');
    const body = await request.json() as { email: string; turnstileToken?: string };
    console.log('Request body parsed:', { email: body.email, hasTurnstileToken: !!body.turnstileToken });

    if (!body.email) {
      console.log('No email provided');
      return createCORSResponse({
        success: false,
        message: 'Email address is required'
      }, 400);
    }

    // Turnstile verification
    if (body.turnstileToken) {
      console.log('Verifying Turnstile token...');
      const turnstileValid = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
      console.log('Turnstile verification result:', turnstileValid);
      if (!turnstileValid) {
        return createCORSResponse({
          success: false,
          message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        }, 400);
      }
    } else {
      console.log('No Turnstile token provided - proceeding without verification');
    }

    // Email validation
    const email = body.email.trim().toLowerCase();
    console.log('Normalized email:', email);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      console.log('Invalid email format:', email);
      return createCORSResponse({
        success: false,
        message: 'Invalid email address'
      }, 400);
    }

    // Extract metadata
    const now = new Date().toISOString();
    const ipAddress = request.headers.get('CF-Connecting-IP') || '';
    const userAgent = request.headers.get('User-Agent') || '';
    const country = request.headers.get('CF-IPCountry') || '';

    console.log('Metadata extracted:', { now, ipAddress, userAgent, country });

    // Database operation
    console.log('Attempting database insert...');
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
      VALUES (?, ?, NULL, ?, ?, ?, '')
      ON CONFLICT(email) DO UPDATE SET
        subscribed_at = ?,
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(email, now, ipAddress, userAgent, country, now).run();

    console.log('Database operation successful');

    return createCORSResponse({
      success: true,
      message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
    });

  } catch (error) {
    console.error('Subscription error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });

    // Check for database-specific errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorName = error instanceof Error ? error.name : undefined;

    if (errorMessage?.includes('Database unavailable') ||
        errorMessage?.includes('D1_ERROR') ||
        errorMessage?.includes('database') ||
        errorName === 'DatabaseError') {
      return createCORSResponse({
        success: false,
        message: 'Our subscription service is temporarily unavailable for maintenance. Please try again later.'
      }, 503);
    }

    // Handle Turnstile verification errors specifically
    if (errorMessage?.includes('Turnstile') || errorMessage?.includes('verification')) {
      return createCORSResponse({
        success: false,
        message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
        troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
      }, 400);
    }

    // Generic error for all other cases
    return createCORSResponse({
      success: false,
      message: 'An error occurred while processing your subscription. Please try again.',
      debug: env.ENVIRONMENT === 'staging' ? errorMessage : undefined
    }, 500);
  }
}

// Add Turnstile verification function
async function verifyTurnstile(token: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${secretKey}&response=${token}`
    });

    const result = await response.json() as { success: boolean };
    return result.success;

  } catch (error) {
    console.error('Turnstile verification error:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

// MAIN EXPORT
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      const url = new URL(request.url);

      // Unsubscribe endpoint allows any origin (for email client compatibility)
      if (url.pathname === '/v1/newsletter/unsubscribe') {
        return new Response(null, {
          status: 200,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            'Content-Type': 'application/json'
          }
        });
      }

      // All other endpoints use restricted CORS
      return new Response(null, {
        status: 200,
        headers: CORS_HEADERS  // This should still be the restricted headers
      });
    }

    // Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      try {
        const result = await env.DB.prepare('SELECT 1 as test').first();
        return createCORSResponse({
          success: true,
          message: 'Newsletter API is running!',
          database: 'Connected',
          environment: env.ENVIRONMENT || 'local'
        });
      } catch (error) {
        return createCORSResponse({
          success: false,
          message: 'Database connection failed',
          error: error instanceof Error ? error.message : String(error)
        }, 500);
      }
    }

    // Newsletter subscription endpoint
    if (url.pathname === '/v1/newsletter/subscribe') {
      return handleSubscription(request, env);
    }

    // Newsletter unsubscribe endpoint
    if (url.pathname === '/v1/newsletter/unsubscribe') {
      return handleUnsubscribe(request, env);
    }

    return createCORSResponse('Not Found', 404);
  }
};