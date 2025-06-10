// src/metrics/metrics-handler.ts
import { WorkerObservability } from '../observability/otel';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY: string;
  HMAC_SECRET_KEY: string;
  ENVIRONMENT: string;
  GRAFANA_API_KEY: string; // New secret for Grafana authentication
}

interface MetricsQuery {
  start?: string;
  end?: string;
  metric?: string;
  labels?: Record<string, string>;
  format?: 'prometheus' | 'json' | 'grafana';
}

export class MetricsHandler {
  constructor(private env: Env, private observability: WorkerObservability) {}

  async handleMetricsRequest(request: Request): Promise<Response> {
    // Authenticate request
    const authResult = this.authenticateRequest(request);
    if (!authResult.success) {
      return this.unauthorizedResponse(authResult.error || 'Authentication failed');
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Route metrics requests
      if (path === '/metrics') {
        return this.handlePrometheusMetrics(request);
      } else if (path === '/metrics/json') {
        return this.handleJSONMetrics(request);
      } else if (path === '/metrics/health') {
        return this.handleHealthMetrics(request);
      } else if (path === '/metrics/database') {
        return this.handleDatabaseMetrics(request);
      } else if (path === '/metrics/performance') {
        return this.handlePerformanceMetrics(request);
      } else if (path.startsWith('/metrics/traces')) {
        return this.handleTraces(request);
      }

      return this.notFoundResponse();
    } catch (error) {
      console.error('Metrics endpoint error:', error);
      return this.errorResponse('Internal server error', 500);
    }
  }

  private authenticateRequest(request: Request): { success: boolean; error?: string } {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader) {
      return { success: false, error: 'Missing Authorization header' };
    }

    if (!authHeader.startsWith('Bearer ')) {
      return { success: false, error: 'Invalid Authorization header format' };
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!this.env.GRAFANA_API_KEY) {
      return { success: false, error: 'Grafana API key not configured' };
    }

    if (token !== this.env.GRAFANA_API_KEY) {
      return { success: false, error: 'Invalid API key' };
    }

    return { success: true };
  }

  // Prometheus format metrics for Grafana scraping
  private async handlePrometheusMetrics(request: Request): Promise<Response> {
    const dbMetrics = await this.collectDatabaseMetrics();
    const appMetrics = this.observability.getObservabilityData();

    const prometheusMetrics = this.formatPrometheusMetrics({
      ...dbMetrics,
      ...appMetrics
    });

    return new Response(prometheusMetrics, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // JSON format for custom dashboards
  private async handleJSONMetrics(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const query = this.parseMetricsQuery(url.searchParams);

    const metrics = {
      timestamp: Date.now(),
      environment: this.env.ENVIRONMENT,
      database: await this.collectDatabaseMetrics(),
      application: this.observability.getObservabilityData(),
      system: await this.collectSystemMetrics(),
      performance: await this.collectPerformanceMetrics()
    };

    // Filter metrics based on query parameters
    const filteredMetrics = this.filterMetrics(metrics, query);

    return new Response(JSON.stringify(filteredMetrics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // Health metrics specifically for alerting
  private async handleHealthMetrics(request: Request): Promise<Response> {
    const healthStatus = await this.collectHealthMetrics();

    return new Response(JSON.stringify(healthStatus, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Database-specific metrics
  private async handleDatabaseMetrics(request: Request): Promise<Response> {
    const dbMetrics = await this.collectDatabaseMetrics();

    return new Response(JSON.stringify(dbMetrics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Performance metrics with percentiles
  private async handlePerformanceMetrics(request: Request): Promise<Response> {
    const perfMetrics = await this.collectPerformanceMetrics();

    return new Response(JSON.stringify(perfMetrics, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Distributed traces
  private async handleTraces(request: Request): Promise<Response> {
    const traces = this.observability.getObservabilityData().traces;

    return new Response(JSON.stringify({ traces }, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }

  // Collect database metrics
  private async collectDatabaseMetrics() {
    try {
      const subscriberCount = await this.env.DB.prepare(
        'SELECT COUNT(*) as total FROM subscribers'
      ).first() as { total: number } | null;

      const activeSubscribers = await this.env.DB.prepare(
        'SELECT COUNT(*) as active FROM subscribers WHERE unsubscribed_at IS NULL'
      ).first() as { active: number } | null;

      const recentSubscriptions = await this.env.DB.prepare(
        'SELECT COUNT(*) as recent FROM subscribers WHERE subscribed_at > datetime("now", "-24 hours")'
      ).first() as { recent: number } | null;

      const recentUnsubscribes = await this.env.DB.prepare(
        'SELECT COUNT(*) as recent FROM subscribers WHERE unsubscribed_at > datetime("now", "-24 hours")'
      ).first() as { recent: number } | null;

      return {
        newsletter_subscribers_total: subscriberCount?.total || 0,
        newsletter_subscribers_active: activeSubscribers?.active || 0,
        newsletter_subscriptions_24h: recentSubscriptions?.recent || 0,
        newsletter_unsubscribes_24h: recentUnsubscribes?.recent || 0,
        database_status: 'connected'
      };
    } catch (error) {
      console.error('Database metrics collection failed:', error);
      return {
        newsletter_subscribers_total: -1,
        newsletter_subscribers_active: -1,
        newsletter_subscriptions_24h: -1,
        newsletter_unsubscribes_24h: -1,
        database_status: 'error'
      };
    }
  }

  // Collect system metrics
  private async collectSystemMetrics() {
    return {
      worker_memory_used: (performance as any).memory?.usedJSHeapSize || 0,
      worker_memory_total: (performance as any).memory?.totalJSHeapSize || 0,
      worker_memory_limit: (performance as any).memory?.jsHeapSizeLimit || 0,
      uptime: Date.now() // Approximate since workers are stateless
    };
  }

  // Collect performance metrics
  private async collectPerformanceMetrics() {
    const observabilityData = this.observability.getObservabilityData();

    // Calculate percentiles from trace data
    const durations = observabilityData.traces.map(t => t.duration).sort((a, b) => a - b);

    return {
      request_duration_p50: this.calculatePercentile(durations, 50),
      request_duration_p95: this.calculatePercentile(durations, 95),
      request_duration_p99: this.calculatePercentile(durations, 99),
      total_requests: durations.length,
      error_rate: observabilityData.traces.filter(t => t.status === 'error').length / durations.length || 0
    };
  }

  // Collect health metrics for alerting
  private async collectHealthMetrics() {
    const dbHealth = await this.checkDatabaseHealth();
    const appHealth = this.checkApplicationHealth();

    return {
      overall_status: dbHealth.healthy && appHealth.healthy ? 'healthy' : 'unhealthy',
      database: dbHealth,
      application: appHealth,
      environment: this.env.ENVIRONMENT,
      timestamp: Date.now()
    };
  }

  private async checkDatabaseHealth(): Promise<{ healthy: boolean; response_time: number; error?: string }> {
    const start = Date.now();
    try {
      await this.env.DB.prepare('SELECT 1').first();
      return {
        healthy: true,
        response_time: Date.now() - start
      };
    } catch (error) {
      return {
        healthy: false,
        response_time: Date.now() - start,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private checkApplicationHealth(): { healthy: boolean; memory_usage: number } {
    const memoryUsage = performance.memory?.usedJSHeapSize || 0;
    const memoryLimit = performance.memory?.jsHeapSizeLimit || Infinity;

    return {
      healthy: memoryUsage < memoryLimit * 0.9, // Alert if using > 90% memory
      memory_usage: memoryUsage / memoryLimit
    };
  }

  // Format metrics in Prometheus format
  private formatPrometheusMetrics(metrics: any): string {
    let output = '';

    for (const [key, value] of Object.entries(metrics)) {
      if (typeof value === 'number') {
        output += `# TYPE ${key} gauge\n`;
        output += `${key}{environment="${this.env.ENVIRONMENT}"} ${value}\n`;
      }
    }

    return output;
  }

  // Calculate percentile from sorted array
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;

    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, index)] || 0;
  }

  // Parse metrics query parameters
  private parseMetricsQuery(searchParams: URLSearchParams): MetricsQuery {
    return {
      start: searchParams.get('start') || undefined,
      end: searchParams.get('end') || undefined,
      metric: searchParams.get('metric') || undefined,
      format: (searchParams.get('format') as any) || 'json'
    };
  }

  // Filter metrics based on query
  private filterMetrics(metrics: any, query: MetricsQuery): any {
    // Basic filtering implementation
    if (query.metric) {
      const filtered: any = { timestamp: metrics.timestamp };
      if (metrics[query.metric]) {
        filtered[query.metric] = metrics[query.metric];
      }
      return filtered;
    }

    return metrics;
  }

  // Response helpers
  private unauthorizedResponse(error: string): Response {
    return new Response(JSON.stringify({ error, status: 401 }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="metrics"'
      }
    });
  }

  private notFoundResponse(): Response {
    return new Response(JSON.stringify({ error: 'Endpoint not found', status: 404 }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private errorResponse(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message, status }), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}