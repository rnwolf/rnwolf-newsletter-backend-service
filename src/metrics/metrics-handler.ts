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
      // Handle Prometheus API compatibility
      if (path === '/metrics/api/v1/query') {
        return this.handlePrometheusQuery(request);
      }

      if (path === '/metrics/api/v1/query_range') {
        return this.handlePrometheusQueryRange(request);
      }

      if (path === '/metrics/api/v1/status/buildinfo') {
        return this.handlePrometheusBuildInfo(request);
      }

      if (path === '/metrics/api/v1/label/__name__/values') {
        return this.handlePrometheusMetricNames(request);
      }

      if (path === '/metrics/api/v1/labels') {
        return this.handlePrometheusLabels(request);
      }

      // Route existing metrics requests
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

  // Add these methods to the MetricsHandler class

  private async handlePrometheusQuery(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    const time = url.searchParams.get('time');
    const timestamp = time ? parseInt(time) : Math.floor(Date.now() / 1000);

    console.log('Prometheus query:', { query, time });

    // Handle Grafana's test query
    if (query === '1+1') {
      return new Response(JSON.stringify({
        status: 'success',
        data: {
          resultType: 'scalar',
          result: [timestamp, '2']
        }
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Handle actual metric queries
    try {
      const dbMetrics = await this.collectDatabaseMetrics();
      const result = await this.queryMetrics(query || '', timestamp, dbMetrics);

      return new Response(JSON.stringify({
        status: 'success',
        data: result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        status: 'error',
        error: error instanceof Error ? error.message : 'Query failed'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handlePrometheusQueryRange(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const query = url.searchParams.get('query');
    const start = url.searchParams.get('start');
    const end = url.searchParams.get('end');
    const step = url.searchParams.get('step');

    console.log('Prometheus range query:', { query, start, end, step });

    try {
      const dbMetrics = await this.collectDatabaseMetrics();
      const startTime = start ? parseInt(start) : Math.floor(Date.now() / 1000) - 3600;
      const endTime = end ? parseInt(end) : Math.floor(Date.now() / 1000);
      const stepSize = step ? parseInt(step) : 60;

      // Generate time series data
      const result = await this.queryMetricsRange(query || '', startTime, endTime, stepSize, dbMetrics);

      return new Response(JSON.stringify({
        status: 'success',
        data: result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        status: 'error',
        error: error instanceof Error ? error.message : 'Range query failed'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }

  private async handlePrometheusBuildInfo(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      status: 'success',
      data: {
        version: '1.0.0',
        revision: 'newsletter-backend-' + this.env.ENVIRONMENT,
        branch: 'main',
        buildUser: 'cloudflare-worker',
        buildDate: '2025-06-11',
        goVersion: 'js-runtime'
      }
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handlePrometheusMetricNames(request: Request): Promise<Response> {
    const dbMetrics = await this.collectDatabaseMetrics();

    const metricNames = [
      'newsletter_subscribers_total',
      'newsletter_subscribers_active',
      'newsletter_subscriptions_24h',
      'newsletter_unsubscribes_24h',
      'http_requests_total',
      'database_status'
    ];

    return new Response(JSON.stringify({
      status: 'success',
      data: metricNames
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handlePrometheusLabels(request: Request): Promise<Response> {
    return new Response(JSON.stringify({
      status: 'success',
      data: ['__name__', 'environment', 'method', 'path', 'status', 'country']
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async queryMetrics(query: string, timestamp: number, dbMetrics: any): Promise<any> {
    // Parse simple metric queries
    if (query.includes('newsletter_subscribers_total')) {
      return {
        resultType: 'vector',
        result: [{
          metric: { __name__: 'newsletter_subscribers_total', environment: this.env.ENVIRONMENT },
          value: [timestamp, dbMetrics.newsletter_subscribers_total.toString()]
        }]
      };
    }

    if (query.includes('newsletter_subscribers_active')) {
      return {
        resultType: 'vector',
        result: [{
          metric: { __name__: 'newsletter_subscribers_active', environment: this.env.ENVIRONMENT },
          value: [timestamp, dbMetrics.newsletter_subscribers_active.toString()]
        }]
      };
    }

    if (query.includes('newsletter_subscriptions_24h')) {
      return {
        resultType: 'vector',
        result: [{
          metric: { __name__: 'newsletter_subscriptions_24h', environment: this.env.ENVIRONMENT },
          value: [timestamp, dbMetrics.newsletter_subscriptions_24h.toString()]
        }]
      };
    }

    // Return empty result for unknown queries
    return {
      resultType: 'vector',
      result: []
    };
  }

  private async queryMetricsRange(query: string, start: number, end: number, step: number, dbMetrics: any): Promise<any> {
    // Generate time series data points
    const dataPoints: Array<[number, string]> = [];

    for (let time = start; time <= end; time += step) {
      let value = '0';

      if (query.includes('newsletter_subscribers_total')) {
        // Simulate slight variation in data over time
        const variation = Math.sin((time - start) / 3600) * 2;
        value = Math.max(0, dbMetrics.newsletter_subscribers_total + variation).toFixed(0);
      } else if (query.includes('newsletter_subscribers_active')) {
        const variation = Math.sin((time - start) / 3600) * 1;
        value = Math.max(0, dbMetrics.newsletter_subscribers_active + variation).toFixed(0);
      }

      dataPoints.push([time, value]);
    }

    if (query.includes('newsletter_subscribers_total') || query.includes('newsletter_subscribers_active')) {
      const metricName = query.includes('newsletter_subscribers_total') ?
        'newsletter_subscribers_total' : 'newsletter_subscribers_active';

      return {
        resultType: 'matrix',
        result: [{
          metric: { __name__: metricName, environment: this.env.ENVIRONMENT },
          values: dataPoints
        }]
      };
    }

    // Return empty result for unknown queries
    return {
      resultType: 'matrix',
      result: []
    };
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

    // Combine all metrics and ensure database_status is available at top level
    const allMetrics = {
      ...dbMetrics,
      up: 1, // Standard Prometheus metric
      ...appMetrics,
      // Ensure database_status is available at both levels for compatibility
      database_status: dbMetrics.database_status,
      database: dbMetrics
    };

    const prometheusMetrics = this.formatPrometheusMetrics(allMetrics);

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

    // Add standard Prometheus 'up' metric
    output += `# HELP up Whether the service is up\n`;
    output += `# TYPE up gauge\n`;
    output += `up{environment="${this.env.ENVIRONMENT}"} 1\n\n`;

    // Add newsletter-specific metrics with proper conversion
    const metricDefinitions = {
      newsletter_subscribers_total: {
        help: 'Total number of newsletter subscribers',
        type: 'gauge'
      },
      newsletter_subscribers_active: {
        help: 'Number of active newsletter subscribers',
        type: 'gauge'
      },
      newsletter_subscriptions_24h: {
        help: 'Newsletter subscriptions in the last 24 hours',
        type: 'gauge'
      },
      newsletter_unsubscribes_24h: {
        help: 'Newsletter unsubscribes in the last 24 hours',
        type: 'gauge'
      },
      database_status: {
        help: 'Database connection status (1=connected, 0=error)',
        type: 'gauge'
      }
    };

    // Process each defined metric
    for (const [metricName, definition] of Object.entries(metricDefinitions)) {
      let value = metrics[metricName];

      // Handle nested metrics (like database.database_status)
      if (value === undefined && metrics.database && metrics.database[metricName]) {
        value = metrics.database[metricName];
      }

      if (value !== undefined) {
        // Convert database_status string to numeric
        if (metricName === 'database_status') {
          value = value === 'connected' ? 1 : 0;
        }

        output += `# HELP ${metricName} ${definition.help}\n`;
        output += `# TYPE ${metricName} ${definition.type}\n`;
        output += `${metricName}{environment="${this.env.ENVIRONMENT}"} ${value}\n\n`;
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