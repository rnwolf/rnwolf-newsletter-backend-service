interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Test database connection
    try {
      const result = await env.DB.prepare('SELECT 1 as test').first();
      return new Response(JSON.stringify({
        success: true,
        message: 'Newsletter API is running!',
        database: 'Connected',
        test_result: result
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
};