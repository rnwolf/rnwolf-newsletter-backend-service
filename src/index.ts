// src/index.ts - Updated with observability
import { handleUnsubscribe } from './unsubscribe-handler';
import { WorkerObservability, PerformanceMonitor } from './observability/otel';
import { MetricsHandler } from './metrics/metrics-handler';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  GRAFANA_API_KEY: string; // New environment variable
}

// CORS configuration
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.rnwolf.net',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  'Content-Type': 'application/json'
};

// Helper function to generate request ID
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
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
function createCORSResponse(body: any, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: CORS_HEADERS
  });
}

// Function to handle newsletter subscription with observability
async function handleSubscription(request: Request, env: Env, observability: WorkerObservability): Promise<Response> {
  const monitor = PerformanceMonitor.getInstance(observability);

  return await monitor.monitorRequest('POST', '/v1/newsletter/subscribe', async () => {
    console.log('handleSubscription called', { method: request.method, url: request.url });

    if (request.method !== 'POST') {
      console.log('Method not allowed:', request.method);
      observability.recordMetric('newsletter.subscription.errors', 1, {
        error_type: 'method_not_allowed'
      });
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
        observability.recordMetric('newsletter.subscription.errors', 1, {
          error_type: 'missing_email'
        });
        return createCORSResponse({
          success: false,
          message: 'Email address is required'
        }, 400);
      }

      // Turnstile verification with monitoring
      if (body.turnstileToken) {
        console.log('Verifying Turnstile token...');
        const turnstileValid = await monitor.monitorExternalCall('turnstile', 'verify', async () => {
          return await verifyTurnstile(body.turnstileToken!, env.TURNSTILE_SECRET_KEY);
        });

        console.log('Turnstile verification result:', turnstileValid);
        observability.recordMetric('newsletter.turnstile.verifications', 1, {
          result: turnstileValid ? 'success' : 'failure'
        });

        if (!turnstileValid) {
          observability.recordMetric('newsletter.subscription.errors', 1, {
            error_type: 'turnstile_failed'
          });
          return createCORSResponse({
            success: false,
            message: 'Please complete the security verification. If you\'re having trouble, visit our troubleshooting guide for help.',
            troubleshootingUrl: 'https://www.rnwolf.net/troubleshooting'
          }, 400);
        }
      } else {
        console.log('No Turnstile token provided - proceeding without verification');
        observability.recordMetric('newsletter.turnstile.skipped', 1);
      }

      // Email validation
      const email = body.email.trim().toLowerCase();
      console.log('Normalized email:', email);

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email) || email.length > 254) {
        console.log('Invalid email format:', email);
        observability.recordMetric('newsletter.subscription.errors', 1, {
          error_type: 'invalid_email'
        });
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

      // Database operation with monitoring
      console.log('Attempting database insert...');
      await monitor.monitorDatabaseOperation('insert_subscriber', async () => {
        return await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
          VALUES (?, ?, NULL, ?, ?, ?, '')
          ON CONFLICT(email) DO UPDATE SET
            subscribed_at = ?,
            unsubscribed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).bind(email, now, ipAddress, userAgent, country, now).run();
      });

      console.log('Database operation successful');
      observability.recordMetric('newsletter.subscriptions', 1, {
        country: country || 'unknown'
      });

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

      // Record error metrics
      observability.recordMetric('newsletter.subscription.errors', 1, {
        error_type: 'internal_error'
      });

      // Check for database-specific errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : undefined;

      if (errorMessage?.includes('Database unavailable') ||
          errorMessage?.includes('D1_ERROR') ||
          errorMessage?.includes('database') ||
          errorName === 'DatabaseError') {

        observability.recordMetric('newsletter.database.errors', 1);
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
  });
}

// Add Turnstile verification function (unchanged)
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

            return createCORSResponse(healthData);
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
            }, 500);
          }
        });
      }

      // Newsletter subscription endpoint
      if (url.pathname === '/v1/newsletter/subscribe') {
        return handleSubscription(request, env, observability);
      }

      // Newsletter unsubscribe endpoint
      if (url.pathname === '/v1/newsletter/unsubscribe') {
        return await monitor.monitorRequest('GET', '/v1/newsletter/unsubscribe', async () => {
          return handleUnsubscribe(request, env);
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
      }, 404);

    } catch (error) {
      console.error(`[${requestId}] Unhandled error:`, error);

      observability.recordMetric('http.errors.total', 1, {
        error_type: 'unhandled_exception'
      });

      return createCORSResponse({
        error: 'Internal Server Error',
        requestId,
        debug: env.ENVIRONMENT === 'staging' ?
          (error instanceof Error ? error.message : String(error)) : undefined
      }, 500);
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
  }
};