# Grafana Metrics and Observability

The implementation provides both performance testing capabilities and production observability, giving comprehensive insights into newsletter service's behaviour under various conditions while maintaining security through bearer token authentication.

## Building blocks for solution

OpenTelemetry (OTEL) is open standard to provide observability into applications.
Grafana is an opensource application suite to manage and visualize metrics.

## Benefits of This Implementation

🔒 Security: Bearer token authentication protects your metrics
📊 Comprehensive Metrics: Database, application, and performance metrics
🚀 Performance Insights: P50, P95, P99 response times
⚠️ Alerting: Built-in health checks and error detection
📈 Scalability Monitoring: Memory usage and request rate tracking
🌍 Geographic Analytics: Subscription patterns by country
🔍 Distributed Tracing: Request flow visibility
⚡ Performance Testing: Automated load testing with observability

## Implementation

### Install Otel SDK

```
npm install @opentelemetry/api
```

### Configure Environment variables for access

Update the .env file:

#### For local testing

GRAFANA_API_KEY=local-test-key

#### Keep the actual keys secure - use different env vars

GRAFANA_API_KEY_STAGING=glsa_your_staging_token_here
GRAFANA_API_KEY_PRODUCTION=glsa_your_production_token_here

#### Settings for Performance Testing

PERFORMANCE_TEST_DURATION=30000
PERFORMANCE_CONCURRENT_USERS=10
PERFORMANCE_REQUESTS_PER_USER=20

### Set the secret in Cloudflare:

```
echo "your_grafana_api_key" | npx wrangler secret put GRAFANA_API_KEY --env staging

echo "your_grafana_api_key" | npx wrangler secret put GRAFANA_API_KEY --env production
```

### **Metrics Endpoints**

Your application will exposes these authenticated endpoints:

    | Endpoint | Purpose | Format |
    |----------|---------|--------|
    | /metrics  | Prometheus format for Grafana scraping | text/plain |
    | /metrics/json | JSON format for custom dashboards | application/json |
    | /metrics/health | Health metrics for alerting | application/json |
    | /metrics/database | Database-specific metrics | application/json |
    | /metrics/performance | Performance metrics with percentiles | application/json |
    | /metrics/traces | Distributed tracing data | application/json |

### Gafana Dashboard Structure:

 - Service Health Overview - Database status and subscription rate stats
 - HTTP Request Rate - Real-time request metrics by method and path
 - Response Time Percentiles - P50, P95, P99 performance metrics
 - Newsletter Subscription Metrics - Total/active subscribers and rates
 - Error Rate - Error tracking by type
 - Database Performance - DB response times and error rates
 - Turnstile Verification Metrics - Bot protection success/failure rates
 - Geographic Distribution - Pie chart of subscriptions by country
 - Worker Memory Usage - Memory utilization percentage
 - Recent Activity Timeline - Live subscription/unsubscribe activity

Additional Features:

 - Templating: Environment variable selection (staging/production)
 - Annotations: Deployment markers
 - Alerting Rules: 4 pre-configured alerts for common issues
 - Data Source Config: Ready-to-use Prometheus configuration

The dashboard provides comprehensive visibility into your newsletter service's performance, health, and usage patterns, all secured with bearer token authentication.

## How to set up Grafana API keys and configure your Grafana Cloud Free account

### 1. Create Grafana API Keys (Service Account Tokens)

#### In Grafana Cloud:

 - Log into your Grafana Cloud account at https://grafana.com/
 - Go to your Grafana dashboard (usually at https://yourorg.grafana.net)
 - Navigate to Administration → Service Accounts (in the left sidebar)
 - Create a new Service Account:

    - Click "Add service account"
    - Name: newsletter-backend-metrics
    - Display name: Newsletter Backend Metrics Access
    - Role: Viewer (or Editor if you want to create dashboards via API)

 - Generate tokens for each environment:

    - Click on the service account you just created
    - Click "Add service account token"
    - Create two tokens:

        Name: newsletter-staging, Expiration: No expiration or 1 year
        Name: newsletter-production, Expiration: No expiration or 1 year

 - Copy the tokens - you'll only see them once!

### 2. Set Environment Variables

Add to your .env file:

```
GRAFANA_API_KEY=local-test-key
GRAFANA_API_KEY_STAGING=glsa_your_staging_token_here
GRAFANA_API_KEY_PRODUCTION=glsa_your_production_token_here
```


### 3. Set secret in cloudflare

```
echo "glsa_your_staging_token_here" | npx wrangler secret put GRAFANA_API_KEY --env staging
echo "glsa_your_production_token_here" | npx wrangler secret put GRAFANA_API_KEY --env production
```

### 4. Configure Datasources in Grafana


#### Method 1: Via Grafana UI

In your Grafana Cloud dashboard, go to Configuration → Data Sources
Click "Add data source"
Select "Prometheus" (even though we're using JSON endpoints)
Configure the data source:

Name: Newsletter Backend API - Staging
URL: https://api-staging.rnwolf.net
Access: Server (default)

HTTP Headers:
- Header: Authorization
- Value: Bearer glsa_your_staging_token_here

Advanced HTTP Settings:
- Timeout: 30s
- Keep Cookies: []

Repeat for Production:

Name: Newsletter Backend API - Production
URL: https://api.rnwolf.net
Access: Server (default)

HTTP Headers:
- Header: Authorization
- Value: Bearer glsa_your_production_token_here


#### Method 2 via configuration file

Prefer this approach as it can be version controlled and automated.

```
# grafana-datasources.yml
# Configuration for Grafana Cloud data sources

apiVersion: 1

datasources:
  # Staging Environment
  - name: Newsletter-API-Staging
    type: prometheus
    access: proxy
    url: https://api-staging.rnwolf.net/metrics
    isDefault: false
    jsonData:
      timeInterval: "30s"
      httpMethod: GET
      httpHeaderName1: "Authorization"
    secureJsonData:
      httpHeaderValue1: "Bearer glsa_YOUR_STAGING_TOKEN_HERE"
    editable: true

  # Production Environment
  - name: Newsletter-API-Production
    type: prometheus
    access: proxy
    url: https://api.rnwolf.net/metrics
    isDefault: true
    jsonData:
      timeInterval: "30s"
      httpMethod: GET
      httpHeaderName1: "Authorization"
    secureJsonData:
      httpHeaderValue1: "Bearer glsa_YOUR_PRODUCTION_TOKEN_HERE"
    editable: true

  # JSON API Data Source (Custom)
  - name: Newsletter-JSON-API
    type: grafana-simple-json-datasource
    access: proxy
    url: https://api.rnwolf.net/metrics/json
    isDefault: false
    jsonData:
      httpHeaderName1: "Authorization"
    secureJsonData:
      httpHeaderValue1: "Bearer glsa_YOUR_PRODUCTION_TOKEN_HERE"
    editable: true
```


Not sure how I can actually do this. Need to get clarity to try. Maybe the following will work?

See https://grafana.com/docs/grafana/latest/developers/http_api/data_source/

```
curl -X POST https://throughputfocus.grafana.net/api/datasources \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer glsa_YOUR_PRODUCTION_TOKEN_HERE" \
  -d @grafana-datasources.yml
```




### 5. Configure Dashboards


```
curl -X POST https://throughputfocus.grafana.net/api/dashboards/db \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer glsa_YOUR_STAGING_TOKEN_HERE" \
  -d @grafana-dashboard-config_staging.json

curl -X POST https://throughputfocus.grafana.net/api/dashboards/db \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer glsa_YOUR_PRODUCTION_TOKEN_HERE" \
  -d @grafana-dashboard-config_production.json
```
