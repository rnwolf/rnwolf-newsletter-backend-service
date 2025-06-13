// tests/metrics.test.ts - Complete fixed version
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';
import worker from '../src/index';

interface MetricsResponse {
  status: string;
  data: {
    resultType: string;
    result: Array<{
      metric: Record<string, string>;
      value?: [number, string];
      values?: Array<[number, string]>;
    }>;
  };
}

// Configuration based on environment
const TEST_CONFIG = {
  local: {
    baseUrl: 'http://localhost:8787',
    useWorkerFetch: true,
    setupDatabase: true,
    testToken: 'local-test-key'
  },
  staging: {
    baseUrl: 'https://api-staging.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    testToken: process.env.GRAFANA_API_KEY_STAGING
  },
  production: {
    baseUrl: 'https://api.rnwolf.net',
    useWorkerFetch: false,
    setupDatabase: false,
    testToken: process.env.GRAFANA_API_KEY_PRODUCTION
  }
};

const TEST_ENV = (process.env.TEST_ENV || 'local') as keyof typeof TEST_CONFIG;
const config = TEST_CONFIG[TEST_ENV];

// Helper function to make requests
async function makeRequest(path: string, options?: RequestInit): Promise<Response> {
  const url = `${config.baseUrl}${path}`;

  if (config.useWorkerFetch) {
    const request = new Request(url, options);
    return await worker.fetch(request, env);
  } else {
    return await fetch(url, options);
  }
}

// Helper to make authenticated metrics requests
async function makeMetricsRequest(path: string): Promise<Response> {
  return makeRequest(path, {
    headers: {
      'Authorization': `Bearer ${config.testToken}`,
      'Content-Type': 'application/json'
    }
  });
}

describe(`Metrics System Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (config.setupDatabase) {
      await setupTestDatabase(env);

      // Set test environment variables for local testing
      if (!env.GRAFANA_API_KEY) {
        (env as any).GRAFANA_API_KEY = config.testToken;
      }
      if (!env.ENVIRONMENT) {
        (env as any).ENVIRONMENT = TEST_ENV;
      }

      // Add some test data to ensure we have metrics to test
      const testData = [
        { email: 'metrics-test-1@example.com', country: 'GB' },
        { email: 'metrics-test-2@example.com', country: 'US' },
        { email: 'metrics-test-3@example.com', country: 'CA' }
      ];

      for (const data of testData) {
        await env.DB.prepare(`
          INSERT OR REPLACE INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
          VALUES (?, ?, NULL, '192.168.1.1', ?)
        `).bind(data.email, new Date().toISOString(), data.country).run();
      }

      console.log('✅ Test database setup complete with sample data');
    }
  });

  describe('Prometheus Format Metrics Endpoint', () => {
    it('should return metrics in Prometheus format', async () => {
      const response = await makeMetricsRequest('/metrics');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');

      const metricsText = await response.text();

      // Check for required Prometheus format elements
      expect(metricsText).toContain('# HELP');
      expect(metricsText).toContain('# TYPE');

      // Check for specific metrics
      expect(metricsText).toContain('up{environment=');
      expect(metricsText).toContain('newsletter_subscribers_total{environment=');
      expect(metricsText).toContain('database_status{environment=');
    });

    it('should include all required standard metrics', async () => {
      const response = await makeMetricsRequest('/metrics');
      const metricsText = await response.text();

      const requiredMetrics = [
        'up',
        'newsletter_subscribers_total',
        'newsletter_subscribers_active',
        'newsletter_subscriptions_24h',
        'newsletter_unsubscribes_24h',
        'database_status'
      ];

      for (const metric of requiredMetrics) {
        expect(metricsText).toContain(`${metric}{environment=`);
      }
    });

    it('should have proper metric help text and types', async () => {
      const response = await makeMetricsRequest('/metrics');
      const metricsText = await response.text();

      // Check help text exists for key metrics
      expect(metricsText).toContain('# HELP up Whether the service is up');
      expect(metricsText).toContain('# HELP newsletter_subscribers_total Total number of newsletter subscribers');
      expect(metricsText).toContain('# HELP database_status Database connection status');

      // Check metric types
      expect(metricsText).toContain('# TYPE up gauge');
      expect(metricsText).toContain('# TYPE newsletter_subscribers_total gauge');
      expect(metricsText).toContain('# TYPE database_status gauge');
    });

    it('should return valid numeric values', async () => {
      const response = await makeMetricsRequest('/metrics');
      const metricsText = await response.text();

      // Extract metric values using regex
      const upMatch = metricsText.match(/up\{[^}]*\}\s+(\d+)/);
      const subscribersMatch = metricsText.match(/newsletter_subscribers_total\{[^}]*\}\s+(\d+)/);
      const dbStatusMatch = metricsText.match(/database_status\{[^}]*\}\s+([01])/);

      expect(upMatch).toBeTruthy();
      expect(upMatch![1]).toBe('1'); // Should always be 1 if service is responding

      expect(subscribersMatch).toBeTruthy();
      expect(parseInt(subscribersMatch![1])).toBeGreaterThanOrEqual(0);

      expect(dbStatusMatch).toBeTruthy();
      expect(['0', '1']).toContain(dbStatusMatch![1]);
    });
  });

  describe('Prometheus Query API (/api/v1/query)', () => {
    it('should handle the "up" metric query', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=up');

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('vector');
      expect(result.data.result).toHaveLength(1);
      expect(result.data.result[0].metric.__name__).toBe('up');
      expect(result.data.result[0].value![1]).toBe('1');
    });

    it('should handle the "database_status" metric query', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=database_status');

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('vector');
      expect(result.data.result).toHaveLength(1);
      expect(result.data.result[0].metric.__name__).toBe('database_status');
      expect(['0', '1']).toContain(result.data.result[0].value![1]);
    });

    it('should handle newsletter metrics queries', async () => {
      const queries = [
        'newsletter_subscribers_total',
        'newsletter_subscribers_active',
        'newsletter_subscriptions_24h',
        'newsletter_unsubscribes_24h'
      ];

      for (const query of queries) {
        const response = await makeMetricsRequest(`/metrics/api/v1/query?query=${query}`);

        expect(response.status).toBe(200);

        const result = await response.json() as MetricsResponse;

        expect(result.status).toBe('success');
        expect(result.data.resultType).toBe('vector');
        expect(result.data.result).toHaveLength(1);
        expect(result.data.result[0].metric.__name__).toBe(query);
        expect(result.data.result[0].value).toBeDefined();
        expect(result.data.result[0].value![1]).toMatch(/^\d+$/); // Should be a number string
      }
    });

    it('should return empty results for unknown metrics', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=unknown_metric');

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('vector');
      expect(result.data.result).toHaveLength(0);
    });

    it('should handle Grafana test query "1+1"', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=1%2B1'); // URL encoded 1+1

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('scalar');
      expect(result.data.result).toEqual([expect.any(Number), '2']);
    });

    it('should include environment labels in all metrics', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=up');

      const result = await response.json() as MetricsResponse;

      expect(result.data.result[0].metric.environment).toBe(TEST_ENV);
    });
  });

  describe('Prometheus Range Query API (/api/v1/query_range)', () => {
    it('should handle range queries for "up" metric', async () => {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 3600; // 1 hour ago
      const end = now;
      const step = 300; // 5 minutes

      const response = await makeMetricsRequest(
        `/metrics/api/v1/query_range?query=up&start=${start}&end=${end}&step=${step}`
      );

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('matrix');
      expect(result.data.result).toHaveLength(1);
      expect(result.data.result[0].metric.__name__).toBe('up');
      expect(result.data.result[0].values).toBeDefined();
      expect(result.data.result[0].values!.length).toBeGreaterThan(0);

      // All values should be '1' for up metric
      result.data.result[0].values!.forEach(([timestamp, value]) => {
        expect(typeof timestamp).toBe('number');
        expect(value).toBe('1');
      });
    });

    it('should handle range queries for "database_status" metric', async () => {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 1800; // 30 minutes ago
      const end = now;
      const step = 60; // 1 minute

      const response = await makeMetricsRequest(
        `/metrics/api/v1/query_range?query=database_status&start=${start}&end=${end}&step=${step}`
      );

      expect(response.status).toBe(200);

      const result = await response.json() as MetricsResponse;

      expect(result.status).toBe('success');
      expect(result.data.resultType).toBe('matrix');
      expect(result.data.result[0].metric.__name__).toBe('database_status');

      // All values should be '0' or '1'
      result.data.result[0].values!.forEach(([timestamp, value]) => {
        expect(['0', '1']).toContain(value);
      });
    });

    it('should generate time series data with proper timestamps', async () => {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 600; // 10 minutes ago
      const end = now;
      const step = 60; // 1 minute

      const response = await makeMetricsRequest(
        `/metrics/api/v1/query_range?query=newsletter_subscribers_total&start=${start}&end=${end}&step=${step}`
      );

      const result = await response.json() as MetricsResponse;
      const values = result.data.result[0].values!;

      // Check timestamps are in correct sequence
      for (let i = 1; i < values.length; i++) {
        expect(values[i][0]).toBeGreaterThan(values[i-1][0]);
      }

      // Check timestamp intervals match step
      if (values.length > 1) {
        const actualStep = values[1][0] - values[0][0];
        expect(actualStep).toBe(step);
      }
    });
  });

  describe('JSON Metrics Endpoint', () => {
    it('should return comprehensive metrics in JSON format', async () => {
      const response = await makeMetricsRequest('/metrics/json');

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/json');

      const metrics = await response.json();

      expect(metrics).toHaveProperty('timestamp');
      expect(metrics).toHaveProperty('environment');
      expect(metrics).toHaveProperty('database');
      expect(metrics).toHaveProperty('application');
      expect(metrics).toHaveProperty('system');
      expect(metrics).toHaveProperty('performance');

      // Check database metrics structure
      expect(metrics.database).toHaveProperty('newsletter_subscribers_total');
      expect(metrics.database).toHaveProperty('newsletter_subscribers_active');
      expect(metrics.database).toHaveProperty('database_status');
    });
  });

  describe('Health Metrics Endpoint', () => {
    it('should return health status information', async () => {
      const response = await makeMetricsRequest('/metrics/health');

      expect(response.status).toBe(200);

      const health = await response.json();

      expect(health).toHaveProperty('overall_status');
      expect(health).toHaveProperty('database');
      expect(health).toHaveProperty('application');
      expect(health).toHaveProperty('environment');
      expect(health).toHaveProperty('timestamp');

      expect(['healthy', 'unhealthy']).toContain(health.overall_status);
      expect(health.environment).toBe(TEST_ENV);
    });
  });

  describe('Database Metrics Endpoint', () => {
    it('should return database-specific metrics', async () => {
      const response = await makeMetricsRequest('/metrics/database');

      expect(response.status).toBe(200);

      const dbMetrics = await response.json();

      expect(dbMetrics).toHaveProperty('newsletter_subscribers_total');
      expect(dbMetrics).toHaveProperty('newsletter_subscribers_active');
      expect(dbMetrics).toHaveProperty('newsletter_subscriptions_24h');
      expect(dbMetrics).toHaveProperty('newsletter_unsubscribes_24h');
      expect(dbMetrics).toHaveProperty('database_status');

      expect(typeof dbMetrics.newsletter_subscribers_total).toBe('number');
      expect(typeof dbMetrics.newsletter_subscribers_active).toBe('number');
      expect(['connected', 'error']).toContain(dbMetrics.database_status);
    });
  });

  describe('Metrics Authentication', () => {
    it('should require authentication for metrics endpoints', async () => {
      const endpoints = [
        '/metrics',
        '/metrics/json',
        '/metrics/health',
        '/metrics/database',
        '/metrics/api/v1/query?query=up'
      ];

      for (const endpoint of endpoints) {
        const response = await makeRequest(endpoint); // No auth header
        expect(response.status).toBe(401);
      }
    });

    it('should reject invalid authentication tokens', async () => {
      const response = await makeRequest('/metrics', {
        headers: { 'Authorization': 'Bearer invalid-token' }
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      if (TEST_ENV !== 'local') return; // Skip for remote tests

      // Mock database error
      const dbSpy = vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      const response = await makeMetricsRequest('/metrics/database');

      expect(response.status).toBe(200); // Should still respond

      const dbMetrics = await response.json();
      expect(dbMetrics.database_status).toBe('error');
      expect(dbMetrics.newsletter_subscribers_total).toBe(-1);

      dbSpy.mockRestore();
    });

    it('should handle malformed query parameters', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query='); // Empty query

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.status).toBe('success');
      expect(result.data.result).toHaveLength(0);
    });
  });

  describe('Prometheus API Compatibility', () => {
    it('should return proper Prometheus API response structure', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/query?query=up');

      const result = await response.json() as MetricsResponse;

      // Check required Prometheus API fields
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('data');
      expect(result.data).toHaveProperty('resultType');
      expect(result.data).toHaveProperty('result');

      expect(result.status).toBe('success');
      expect(['vector', 'matrix', 'scalar', 'string']).toContain(result.data.resultType);
      expect(Array.isArray(result.data.result)).toBe(true);
    });

    it('should handle buildinfo endpoint', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/status/buildinfo');

      expect(response.status).toBe(200);

      const buildInfo = await response.json();
      expect(buildInfo.status).toBe('success');
      expect(buildInfo.data).toHaveProperty('version');
      expect(buildInfo.data).toHaveProperty('revision');
    });

    it('should handle metric names endpoint', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/label/__name__/values');

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.status).toBe('success');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toContain('up');
      expect(result.data).toContain('newsletter_subscribers_total');
      expect(result.data).toContain('database_status');
    });

    it('should handle labels endpoint', async () => {
      const response = await makeMetricsRequest('/metrics/api/v1/labels');

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.status).toBe('success');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toContain('__name__');
      expect(result.data).toContain('environment');
    });
  });

  describe('Performance and Load', () => {
    it('should handle multiple concurrent metric requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        makeMetricsRequest('/metrics/api/v1/query?query=up')
      );

      const responses = await Promise.all(promises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });
    });

    it('should respond within reasonable time limits', async () => {
      const start = Date.now();
      const response = await makeMetricsRequest('/metrics');
      const duration = Date.now() - start;

      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
    });
  });

  describe('Data Consistency', () => {
    it('should return consistent data across different endpoints', async () => {
      // Get data from different endpoints
      const [prometheusResponse, jsonResponse, dbResponse] = await Promise.all([
        makeMetricsRequest('/metrics/api/v1/query?query=newsletter_subscribers_total'),
        makeMetricsRequest('/metrics/json'),
        makeMetricsRequest('/metrics/database')
      ]);

      const prometheusResult = await prometheusResponse.json() as MetricsResponse;
      const jsonResult = await jsonResponse.json();
      const dbResult = await dbResponse.json();

      // Extract subscriber count from each endpoint
      const prometheusCount = parseInt(prometheusResult.data.result[0].value![1]);
      const jsonCount = jsonResult.database.newsletter_subscribers_total;
      const dbCount = dbResult.newsletter_subscribers_total;

      // All should be the same
      expect(prometheusCount).toBe(jsonCount);
      expect(jsonCount).toBe(dbCount);
    });
  });
});