interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

async function handleSubscription(request: Request, env: Env): Promise<Response> {
  // Only accept POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({
      success: false,
      message: 'Method not allowed'
    }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Parse request body
    const body = await request.json() as { email: string; turnstileToken?: string };

    // Basic email validation
    if (!body.email) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Email address is required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Turnstile verification (optional for now, but log if provided)
    if (body.turnstileToken) {
      const turnstileValid = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!turnstileValid) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      // For now, just log that no Turnstile token was provided
      console.log('No Turnstile token provided - proceeding without verification');
    }

    // Normalize email
    const email = body.email.trim().toLowerCase();

    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || email.length > 254) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Invalid email address'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract metadata
    const now = new Date().toISOString();
    const ipAddress = request.headers.get('CF-Connecting-IP') || '';
    const userAgent = request.headers.get('User-Agent') || '';
    const country = request.headers.get('CF-IPCountry') || '';

    // Insert/update subscriber in database
    await env.DB.prepare(`
      INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
      VALUES (?, ?, NULL, ?, ?, ?, '')
      ON CONFLICT(email) DO UPDATE SET
        subscribed_at = ?,
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(email, now, ipAddress, userAgent, country, now).run();

    return new Response(JSON.stringify({
      success: true,
      message: 'Thank you for subscribing! You\'ll receive our monthly newsletter with interesting content and links.'
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Subscription error:', error);

    return new Response(JSON.stringify({
      success: false,
      message: 'An error occurred while processing your subscription. Please try again.'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
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
    console.error('Turnstile verification error:', error);
    return false;
  }
}

// MAIN EXPORT - This was missing!
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/' || url.pathname === '/health') {
      try {
        const result = await env.DB.prepare('SELECT 1 as test').first();
        return new Response(JSON.stringify({
          success: true,
          message: 'Newsletter API is running!',
          database: 'Connected',
          environment: env.ENVIRONMENT || 'local'
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          success: false,
          message: 'Database connection failed',
          error: error.message
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Newsletter subscription endpoint
    if (url.pathname === '/v1/newsletter/subscribe') {
      return handleSubscription(request, env);
    }

    return new Response('Not Found', { status: 404 });
  }
};