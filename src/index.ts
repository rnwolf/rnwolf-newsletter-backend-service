// src/index.ts - Corrected version with proper function routing
import { handleUnsubscribe } from './unsubscribe-handler';
import { handleEmailVerification } from './email-verification-handler';
import { handleEmailVerificationQueue } from './email-verification-worker';
import { WorkerObservability, PerformanceMonitor } from './observability/otel';
import { MetricsHandler } from './metrics/metrics-handler';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  GRAFANA_API_KEY: string;
  EMAIL_VERIFICATION_QUEUE: Queue;
}

interface SubscriptionData {
  email: string;
  verificationToken: string;
  subscriptionTimestamp: string;
  metadata: {
    ipAddress: string;
    userAgent: string;
    country: string;
    city: string;
  };
}

// CORS configuration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.rnwolf.net',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

// Helper function to generate a verification token
function generateVerificationToken(email: string, secretKey: string): string {
  console.log('generateVerificationToken called with:', {
    email,
    secretKey: secretKey ? `${secretKey.substring(0, 8)}...` : 'undefined',
    secretKeyType: typeof secretKey
  });

  const crypto = require('crypto');
  const timestamp = Date.now().toString();
  const message = `${email}:${timestamp}`;
  const token = crypto.createHmac('sha256', secretKey).update(message).digest('hex');
  return Buffer.from(`${token}:${timestamp}`).toString('base64url');
}

// Helper function to generate request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

// Helper function to normalize email addresses
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Helper function to validate email addresses
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}


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
function createCORSResponse(
  body: any,
  status: number = 200,
  endpoint?: string,
  env?: Env,
  errorForDebug?: any
): Response {
  // Use permissive CORS for email-related endpoints
  const isEmailEndpoint = endpoint === '/v1/newsletter/verify' || endpoint === '/v1/newsletter/unsubscribe';

  const baseHeaders = isEmailEndpoint ? {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Content-Type': 'application/json'
  } : CORS_HEADERS;

  let responseBody = { ...body };

  if (env && env.ENVIRONMENT === 'staging' && errorForDebug) {
    responseBody.debug = errorForDebug instanceof Error ? errorForDebug.message : String(errorForDebug);
  }

  return new Response(JSON.stringify(responseBody), {
    status,
    headers: baseHeaders
  });
}



// Database helper function - handles the subscription logic
async function handleSubscriptionInDatabase(
  email: string,
  metadata: SubscriptionData['metadata'],
  env: Env
): Promise<{ success: boolean; subscriber: any; isNewSubscriber: boolean }> {

  const now = new Date().toISOString();

  console.log('About to call generateVerificationToken with:', {
    email,
    secretKey: env.HMAC_SECRET_KEY ? `${env.HMAC_SECRET_KEY.substring(0, 8)}...` : 'undefined',
    secretKeyType: typeof env.HMAC_SECRET_KEY
  });

  const verificationToken = generateVerificationToken(email, env.HMAC_SECRET_KEY);

  try {
    // First, check if subscriber exists and their current status
    const existingSubscriber = await env.DB.prepare(
      'SELECT email, subscribed_at, unsubscribed_at, email_verified, verified_at FROM subscribers WHERE email = ?'
    ).bind(email).first();

    if (!existingSubscriber) {
      // Scenario 1: Brand new subscriber
      console.log(`New subscriber: ${email}`);

      await env.DB.prepare(`
        INSERT INTO subscribers (
          email, subscribed_at, unsubscribed_at,
          email_verified, verification_token, verification_sent_at, verified_at,
          ip_address, user_agent, country, city,
          created_at, updated_at
        ) VALUES (?, ?, NULL, 0, ?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(
        email, now, verificationToken, now,
        metadata.ipAddress, metadata.userAgent, metadata.country, metadata.city
      ).run();

      const newSubscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(email).first();

      return { success: true, subscriber: newSubscriber, isNewSubscriber: true };

    } else {
      // Existing subscriber - determine scenario and handle appropriately
      const isCurrentlyUnsubscribed = existingSubscriber.unsubscribed_at !== null;
      const isCurrentlyVerified = Boolean(existingSubscriber.email_verified);

      console.log(`Existing subscriber: ${email}, unsubscribed: ${isCurrentlyUnsubscribed}, verified: ${isCurrentlyVerified}`);

      if (isCurrentlyUnsubscribed) {
        // Scenario 2: Previously unsubscribed user resubscribing
        console.log(`Resubscribing previously unsubscribed user: ${email}`);

        await env.DB.prepare(`
          UPDATE subscribers
          SET
            subscribed_at = ?,
            unsubscribed_at = NULL,
            email_verified = 0,              -- Reset to unverified (they need to verify again)
            verification_token = ?,          -- New verification token
            verification_sent_at = ?,        -- New sent timestamp
            verified_at = NULL,              -- Clear previous verification timestamp
            ip_address = ?,                  -- Update metadata
            user_agent = ?,
            country = ?,
            city = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE email = ?
        `).bind(
          now, verificationToken, now,
          metadata.ipAddress, metadata.userAgent, metadata.country, metadata.city,
          email
        ).run();

      } else if (isCurrentlyVerified) {
        // Scenario 3: Previously verified user resubscribing (maybe they forgot they were subscribed)
        console.log(`Resubscribing previously verified user: ${email} - resetting verification status`);

        await env.DB.prepare(`
          UPDATE subscribers
          SET
            subscribed_at = ?,               -- Update subscription timestamp
            email_verified = 0,              -- Reset to unverified
            verification_token = ?,          -- New verification token
            verification_sent_at = ?,        -- New sent timestamp
            verified_at = NULL,              -- Clear previous verification timestamp
            ip_address = ?,                  -- Update metadata
            user_agent = ?,
            country = ?,
            city = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE email = ?
        `).bind(
          now, verificationToken, now,
          metadata.ipAddress, metadata.userAgent, metadata.country, metadata.city,
          email
        ).run();

      } else {
        // Scenario 4: Existing unverified user subscribing again
        console.log(`Updating existing unverified user: ${email} - generating new token`);

        await env.DB.prepare(`
          UPDATE subscribers
          SET
            subscribed_at = ?,               -- Update subscription timestamp
            verification_token = ?,          -- New verification token
            verification_sent_at = ?,        -- New sent timestamp
            ip_address = ?,                  -- Update metadata
            user_agent = ?,
            country = ?,
            city = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE email = ?
        `).bind(
          now, verificationToken, now,
          metadata.ipAddress, metadata.userAgent, metadata.country, metadata.city,
          email
        ).run();
      }

      // Get updated subscriber data
      const updatedSubscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(email).first();

      return { success: true, subscriber: updatedSubscriber, isNewSubscriber: false };
    }

  } catch (error) {
    console.error('Database error in handleSubscriptionInDatabase:', error);
    throw error;
  }
}

// Turnstile verification function
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

// Main subscription processing function
async function processSubscription(
  email: string,
  turnstileToken: string,
  request: Request,
  env: Env
): Promise<Response> {

  try {
    // Extract metadata from request
    const metadata = {
      ipAddress: request.headers.get('CF-Connecting-IP') || '',
      userAgent: request.headers.get('User-Agent') || '',
      country: request.headers.get('CF-IPCountry') || '',
      city: request.headers.get('CF-IPCity') || ''
    };

    // Verify Turnstile if token provided
    if (turnstileToken) {
      const turnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY);
      if (!turnstileValid) {
        return createCORSResponse({
          success: false,
          message: 'Please complete the security verification.',
          troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
        }, 400, undefined, env);
      }
    }

    // Handle the subscription
    const result = await handleSubscriptionInDatabase(email, metadata, env);

    // Queue verification email (for all scenarios - new and existing users need to verify)
    if (env.EMAIL_VERIFICATION_QUEUE) {
      try {
        await env.EMAIL_VERIFICATION_QUEUE.send({
          email: email,
          verificationToken: result.subscriber.verification_token,
          subscribedAt: result.subscriber.subscribed_at,
          metadata: metadata
        });

        console.log(`Verification email queued for: ${email}`);
      } catch (queueError) {
        console.error('Failed to queue verification email:', queueError);
        // Continue with success response - email verification can be retried
      }
    }

    // Return appropriate success message
    const message = result.isNewSubscriber
      ? 'Thank you for subscribing! Please check your email and click the verification link complete your subscription.'
      : 'Thank you for subscribing! Please check your email and click the verification link to complete your subscription.';

    return createCORSResponse({
      success: true,
      message: message
    }, 200, undefined, env);

  } catch (error) {
    console.error('Subscription processing error:', error);

    if (error instanceof Error && (error.message?.includes('Database') || error.name === 'DatabaseError')) {
      return createCORSResponse({
        success: false,
        message: 'Our subscription service is temporarily unavailable. Please try again later.'
      }, 500, undefined, env, error);
    }

    return createCORSResponse({
      success: false,
      message: 'An error occurred while processing your subscription. Please try again.'
    }, 500, undefined, env, error);
  }
}

// Request handler for subscription endpoint
async function handleSubscriptionRequest(
  request: Request,
  env: Env,
  observability: WorkerObservability
): Promise<Response> {

  console.log('handleSubscriptionRequest called');

  if (request.method !== 'POST') {
    return createCORSResponse({
      success: false,
      message: 'Method not allowed'
    }, 405, undefined, env);
  }

  try {
    // Parse request body
    const requestData = await request.json() as {
      email: string;
      turnstileToken?: string;
    };

    console.log('Parsed request data:', {
      email: requestData.email,
      hasTurnstileToken: !!requestData.turnstileToken
    });

    if (!requestData.email) {
      return createCORSResponse({
        success: false,
        message: 'Email address is required'
      }, 400, undefined, env);
    }

    // Add email validation
    const normalizedEmail = normalizeEmail(requestData.email);
    if (!isValidEmail(normalizedEmail)) {
      return createCORSResponse({
        success: false,
        message: 'Invalid email address'
      }, 400, undefined, env);
    }

    // Call the subscription processing function with normalized email
    return await processSubscription(
      normalizedEmail,
      requestData.turnstileToken || '',
      request,
      env
    );

  } catch (error) {
    console.error('Request parsing error:', error);
    return createCORSResponse({
      success: false,
      message: 'Invalid request format'
    }, 400, undefined, env, error);
  }
}

// MAIN EXPORT with observability
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = generateRequestId();
    const observability = new WorkerObservability(requestId);
    const monitor = PerformanceMonitor.getInstance(observability);

    // Add request ID to all logs
    console.log(`[${requestId}] Request received:`, {
      method: request.method,
      url: request.url,
      environment: env.ENVIRONMENT
    });

    const url = new URL(request.url);

    // Record basic request metrics
    observability.recordMetric('http.requests.total', 1, {
      method: request.method,
      path: url.pathname,
      environment: env.ENVIRONMENT
    });

    try {
      // Check if this is a metrics endpoint request
      if (url.pathname.startsWith('/metrics')) {
        const metricsHandler = new MetricsHandler(env, observability);
        return await metricsHandler.handleMetricsRequest(request);
      }

      // Handle CORS preflight requests
      if (request.method === 'OPTIONS') {
        const url = new URL(request.url);

        // Email verification and unsubscribe endpoints allow any origin (for email client compatibility)
        if (url.pathname === '/v1/newsletter/unsubscribe' || url.pathname === '/v1/newsletter/verify') {
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
          headers: CORS_HEADERS
        });
      }

      // Health check endpoint with enhanced metrics
      if (url.pathname === '/' || url.pathname === '/health') {
        return await monitor.monitorRequest('GET', '/health', async () => {
          try {
            const dbCheckStart = Date.now();
            const result = await env.DB.prepare('SELECT 1 as test').first();
            const dbResponseTime = Date.now() - dbCheckStart;

            observability.recordMetric('database.health.response_time', dbResponseTime, {}, 'histogram');
            observability.recordMetric('database.health.status', 1, { status: 'connected' });

            const healthData = {
              success: true,
              message: 'Newsletter API is running!',
              database: 'Connected',
              environment: env.ENVIRONMENT || 'local',
              requestId,
              timestamp: new Date().toISOString(),
              performance: {
                database_response_time: dbResponseTime
              }
            };

            return createCORSResponse(healthData, 200, url.pathname, env);
          } catch (error) {
            observability.recordMetric('database.health.status', 1, { status: 'error' });
            observability.recordMetric('http.errors.total', 1, {
              endpoint: '/health',
              error_type: 'database_error'
            });

            return createCORSResponse({
              success: false,
              message: 'Database connection failed',
              error: error instanceof Error ? error.message : String(error),
              requestId
            }, 500, url.pathname, env, error);
          }
        });
      }

      // Newsletter subscription endpoint - CORRECTED
      if (url.pathname === '/v1/newsletter/subscribe') {
        return await monitor.monitorRequest('POST', '/v1/newsletter/subscribe', async () => {
          return handleSubscriptionRequest(request, env, observability);
        });
      }

      // Newsletter unsubscribe endpoint
      if (url.pathname === '/v1/newsletter/unsubscribe') {
        return await monitor.monitorRequest('GET', '/v1/newsletter/unsubscribe', async () => {
          return handleUnsubscribe(request, env);
        });
      }

      // Email verification endpoint
      if (url.pathname === '/v1/newsletter/verify') {
        return await monitor.monitorRequest('GET', '/v1/newsletter/verify', async () => {
          return handleEmailVerification(request, env);
        });
      }

      // 404 for unknown endpoints
      observability.recordMetric('http.errors.total', 1, {
        endpoint: url.pathname,
        error_type: 'not_found'
      });

      return createCORSResponse({
        error: 'Not Found',
        path: url.pathname,
        requestId
      }, 404, url.pathname, env);

    } catch (error) {
      console.error(`[${requestId}] Unhandled error:`, error);

      observability.recordMetric('http.errors.total', 1, {
        error_type: 'unhandled_exception'
      });

      return createCORSResponse({
        error: 'Internal Server Error',
        requestId,
        // debug field will be added by createCORSResponse if env is staging and error is passed
      }, 500, undefined, env, error);
    } finally {
      // Log observability data for debugging (in staging/development)
      if (env.ENVIRONMENT !== 'production') {
        const obsData = observability.getObservabilityData();
        console.log(`[${requestId}] Observability data:`, {
          metrics_count: obsData.metrics.length,
          traces_count: obsData.traces.length,
          total_duration: obsData.traces.reduce((sum, trace) => sum + trace.duration, 0)
        });
      }
    }
  },

  // Queue consumer for email verification
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    return await handleEmailVerificationQueue(batch, env);
  }
};