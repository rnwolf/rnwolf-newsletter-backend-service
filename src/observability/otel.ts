// src/observability/otel.ts
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export interface MetricData {
  name: string;
  value: number;
  labels?: Record<string, string>;
  timestamp?: number;
  type: 'counter' | 'gauge' | 'histogram';
}

export interface TraceData {
  traceId: string;
  spanId: string;
  operationName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'ok' | 'error';
  tags?: Record<string, any>;
  logs?: Array<{ timestamp: number; message: string; level: string }>;
}

export class WorkerObservability {
  private metrics: MetricData[] = [];
  private traces: TraceData[] = [];
  private requestId: string;

  constructor(requestId: string) {
    this.requestId = requestId;
  }

  // Record metrics
  recordMetric(name: string, value: number, labels: Record<string, string> = {}, type: MetricData['type'] = 'counter') {
    this.metrics.push({
      name,
      value,
      labels: {
        ...labels,
        requestId: this.requestId,
        environment: labels.environment || 'unknown'
      },
      timestamp: Date.now(),
      type
    });
  }

  // Start a span
  startSpan(operationName: string, tags: Record<string, any> = {}): WorkerSpan {
    const startTime = Date.now();
    const spanId = this.generateSpanId();
    const traceId = this.generateTraceId();

    return new WorkerSpan(operationName, spanId, traceId, startTime, tags, this);
  }

  // Record a completed trace
  recordTrace(trace: TraceData) {
    this.traces.push(trace);
  }

  // Get all collected observability data
  getObservabilityData() {
    return {
      requestId: this.requestId,
      metrics: this.metrics,
      traces: this.traces,
      timestamp: Date.now()
    };
  }

  // Clear collected data
  clear() {
    this.metrics = [];
    this.traces = [];
  }

  private generateSpanId(): string {
    return Math.random().toString(16).substring(2, 18);
  }

  private generateTraceId(): string {
    return Math.random().toString(16).substring(2, 34);
  }
}

export class WorkerSpan {
  private logs: Array<{ timestamp: number; message: string; level: string }> = [];

  constructor(
    private operationName: string,
    private spanId: string,
    private traceId: string,
    private startTime: number,
    private tags: Record<string, any>,
    private observability: WorkerObservability
  ) {}

  addTag(key: string, value: any): void {
    this.tags[key] = value;
  }

  log(message: string, level: string = 'info'): void {
    this.logs.push({
      timestamp: Date.now(),
      message,
      level
    });
  }

  setStatus(status: 'ok' | 'error'): void {
    this.tags.status = status;
  }

  finish(): void {
    const endTime = Date.now();
    const duration = endTime - this.startTime;

    this.observability.recordTrace({
      traceId: this.traceId,
      spanId: this.spanId,
      operationName: this.operationName,
      startTime: this.startTime,
      endTime,
      duration,
      status: this.tags.status || 'ok',
      tags: this.tags,
      logs: this.logs
    });

    // Record duration as a metric
    this.observability.recordMetric(
      `operation.duration`,
      duration,
      {
        operation: this.operationName,
        status: this.tags.status || 'ok'
      },
      'histogram'
    );
  }
}

// Performance monitoring utilities
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private observability: WorkerObservability;

  constructor(observability: WorkerObservability) {
    this.observability = observability;
  }

  static getInstance(observability?: WorkerObservability): PerformanceMonitor {
    if (!PerformanceMonitor.instance && observability) {
      PerformanceMonitor.instance = new PerformanceMonitor(observability);
    }
    return PerformanceMonitor.instance;
  }

  // Monitor database operations
  async monitorDatabaseOperation<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const span = this.observability.startSpan(`db.${operation}`, {
      component: 'database',
      operation
    });

    try {
      const result = await fn();
      span.setStatus('ok');
      span.addTag('result.success', true);
      return result;
    } catch (error) {
      span.setStatus('error');
      span.addTag('error.message', error instanceof Error ? error.message : String(error));
      span.log(`Database operation failed: ${error}`, 'error');
      throw error;
    } finally {
      span.finish();
    }
  }

  // Monitor external API calls
  async monitorExternalCall<T>(
    service: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const span = this.observability.startSpan(`external.${service}.${operation}`, {
      component: 'external_api',
      service,
      operation
    });

    try {
      const result = await fn();
      span.setStatus('ok');
      return result;
    } catch (error) {
      span.setStatus('error');
      span.addTag('error.message', error instanceof Error ? error.message : String(error));
      span.log(`External call failed: ${error}`, 'error');
      throw error;
    } finally {
      span.finish();
    }
  }

  // Monitor request processing
  async monitorRequest<T>(
    method: string,
    path: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const span = this.observability.startSpan(`http.${method.toLowerCase()}`, {
      component: 'http',
      'http.method': method,
      'http.path': path
    });

    const startTime = Date.now();

    try {
      const result = await fn();
      span.setStatus('ok');
      span.addTag('http.status_code', 200);

      // Record request metrics
      this.observability.recordMetric('http.requests.total', 1, {
        method,
        path,
        status: '200'
      });

      return result;
    } catch (error) {
      span.setStatus('error');
      span.addTag('error.message', error instanceof Error ? error.message : String(error));

      // Record error metrics
      this.observability.recordMetric('http.requests.total', 1, {
        method,
        path,
        status: 'error'
      });

      throw error;
    } finally {
      const duration = Date.now() - startTime;
      span.addTag('duration', duration);
      span.finish();

      // Record response time
      this.observability.recordMetric('http.request.duration', duration, {
        method,
        path
      }, 'histogram');
    }
  }
}