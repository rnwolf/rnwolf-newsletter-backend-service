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

## The Metrics

Based on the Grafana dashboard configurations and metrics implementation in your codebase, here's a detailed description of each metric displayed on the
"Newsletter Backend Service Grafana dashboards". This comprehensive metrics setup gives you complete visibility into your newsletter service's health, growth, and user engagement patterns.

### Core Newsletter Metrics

1. newsletter_subscribers_total

  Type: Gauge
  Description: The total number of email addresses that have ever subscribed to the newsletter
  What it shows: Complete count of all subscribers in the database, including both active and unsubscribed users
  Use case: Understanding the overall reach and growth of your newsletter audience over time
  Database query: SELECT COUNT(*) FROM subscribers
  Expected values: Always increasing (never decreases, even when users unsubscribe)

2. newsletter_subscribers_active

  Type: Gauge
  Description: The current number of active (not unsubscribed) newsletter subscribers
  What it shows: Only subscribers where unsubscribed_at IS NULL
  Use case: Your actual mailing list size - how many people will receive your next newsletter
  Database query: SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at IS NULL
  Expected values: Can go up (new subscriptions) or down (unsubscribes)

3. newsletter_subscriptions_24h

  Type: Gauge
  Description: Number of new subscriptions in the last 24 hours
  What it shows: Recent growth rate and subscription activity
  Use case: Monitoring daily growth, detecting traffic spikes, measuring marketing campaign effectiveness
  Database query: SELECT COUNT(*) FROM subscribers WHERE subscribed_at > datetime("now", "-24 hours")
  Expected values: Typically 0-10 for personal blogs, higher for popular sites

4. newsletter_unsubscribes_24h

  Type: Gauge
  Description: Number of unsubscribes in the last 24 hours
  What it shows: Recent churn rate
  Use case: Monitoring subscriber satisfaction, detecting issues with recent newsletters
  Database query: SELECT COUNT(*) FROM subscribers WHERE unsubscribed_at > datetime("now", "-24 hours")
  Expected values: Usually lower than subscriptions; spikes may indicate content issues

### System Health Metrics

5. up

  Type: Gauge
  Description: Standard Prometheus health metric indicating service availability
  What it shows: Whether the newsletter API service is running and responding
  Values:

  1 = Service is up and responding
  0 = Service is down (you wouldn't see this since the service wouldn't respond)


  Use case: Basic service monitoring, uptime tracking, alerting
  Labels: {environment="production|staging|local"}

6. database_status

  Type: Gauge
  Description: Database connection health indicator
  What it shows: Whether the newsletter service can connect to and query the D1 database
  Values:

  1 = Database connected and responding normally
  0 = Database connection failed or queries timing out


  Use case: Database health monitoring, detecting Cloudflare D1 issues
  Labels: {environment="production|staging|local"}

### Dashboard Panel Descriptions

#### Service Health Overview Panel

  Shows: newsletter_subscribers_total and newsletter_subscribers_active as large stat numbers
  Purpose: Quick overview of your newsletter size
  Thresholds:

  Red (0): No subscribers
  Yellow (1-4): Just getting started
  Green (5+): Healthy subscriber base

#### Newsletter Subscription Activity Panel

  Shows: Time series chart of newsletter_subscriptions_24h and newsletter_unsubscribes_24h
  Purpose: Monitor daily growth vs. churn trends
  Chart type: Line chart showing activity over time
  Use case: Spot patterns, measure campaign effectiveness, detect problems

#### Database Status Panel

  Shows: up and database_status metrics as status indicators
  Purpose: System health monitoring
  Display:

  Green = Healthy (value = 1)
  Red = Down (value = 0)

  Mappings: Shows "Up"/"Down" text instead of 1/0 numbers

#### Subscriber Growth Over Time Panel

  Shows: Historical trend of newsletter_subscribers_total and newsletter_subscribers_active
  Purpose: Long-term growth tracking
  Chart type: Time series line chart
  Use case: Understand growth patterns, measure success over weeks/months

#### Recent Activity Panel

  Shows: newsletter_subscriptions_24h over time
  Purpose: Monitor immediate subscription activity
  Chart type: Time series showing daily new subscriptions
  Use case: Real-time monitoring of newsletter growth

#### System Metrics Table

  Shows: All key metrics in table format with current values
  Columns: Metric name, current value, timestamp
  Purpose: Detailed current status overview
  Use case: Debugging, detailed monitoring, data export

### Metric Labels and Dimensions

#### Environment Label

All metrics include an environment label:

environment="local" - Local development
environment="staging" - Staging environment
environment="production" - Production environment

This allows you to:

Monitor multiple environments in one dashboard
Compare staging vs. production metrics
Filter dashboards by environment

### Data Freshness

  Update Frequency: Metrics are generated in real-time when queried
  Database Queries: Run fresh each time Grafana requests data
  Caching: No caching (always current data)
  Time Range: Dashboards default to last 1 hour with 30-second refresh


## summary of what the complete test file `metrics.test.ts`

1. Prometheus Format Metrics Endpoint

  Tests Prometheus text format output
  Validates required metrics and their format
  Checks help text and metric types
  Validates numeric values

2. Prometheus Query API (/api/v1/query)

  Tests individual metric queries (up, database_status, newsletter metrics)
  Validates response structure
  Tests Grafana compatibility (1+1 query)
  Ensures environment labels are present

3. Prometheus Range Query API (/api/v1/query_range)

  Tests time series data generation
  Validates timestamp sequences
  Checks data point values

4. JSON Metrics Endpoint

  Tests comprehensive JSON format
  Validates all required properties
  Checks nested structure

5. Health Metrics Endpoint

  Tests health status reporting
  Validates environment information

6. Database Metrics Endpoint

  Tests database-specific metrics
  Validates data types and values

7. Authentication

  Tests required authentication
  Validates token rejection

8. Error Handling

  Tests graceful error handling
  Database connection failures
  Malformed queries

9. Prometheus API Compatibility

  Tests standard Prometheus endpoints
  Validates response structures
  Tests buildinfo, metric names, labels endpoints

10. Performance and Load

  Concurrent request handling
  Response time validation

11. Data Consistency

  Cross-endpoint data validation
  Ensures same data across different formats

## Key Features of the Test:

Proper Test Data Setup: Creates sample subscribers before running tests
Environment Variable Handling: Sets up proper environment variables for local testing
Complete Coverage: Tests all metrics endpoints and functionality
Error Handling: Includes proper mocking and error scenarios
Prometheus Compatibility: Validates full Prometheus API compliance

### Run the complete test suite:

```bash
npm run test:metrics:local
```


## Metrics Validation Script

A script to check metrics for the system.


1: Make Scripts Executable

```bash
chmod +x scripts/metrics-validation.sh
chmod +x scripts/debug-metrics.sh  # If you want the debug version too
```

2: Ensure Dependencies are Installed

```bash
# Check if jq is installed
which jq

# If not installed:
# On Ubuntu/Debian:
sudo apt install jq

# On macOS:
brew install jq
```

On other systems, see: https://jqlang.github.io/jq/download/

3: Set Environment Variables

Make sure you have the correct environment variables set:

```bash
# For production testing:
export GRAFANA_API_KEY_PRODUCTION="glsa_your_production_token_here"

# For staging testing:
export GRAFANA_API_KEY_STAGING="glsa_your_staging_token_here"

# Verify they're set:
echo "Production key: ${GRAFANA_API_KEY_PRODUCTION:0:15}..."
echo "Staging key: ${GRAFANA_API_KEY_STAGING:0:15}..."
```

4: Debug Step by Step

If you're still having issues, run the debug script first:
```bash
# Debug production environment
./scripts/debug-metrics.sh production

# Debug staging environment
./scripts/debug-metrics.sh staging
```

5: Run the Full Validation

```bash
# Test production
./scripts/metrics-validation.sh production

# Test staging
./scripts/metrics-validation.sh staging
Expected Output
With the fixed script, you should see output like:
bashValidating Metrics for production Environment
API URL: https://api.rnwolf.net
========================================

=== Basic Connectivity Tests ===
[TEST] API Health Check
[PASS] API Health Check (HTTP 200)

=== Metrics Authentication Tests ===
[TEST] Metrics endpoint (no auth)
[PASS] Metrics endpoint (no auth) (HTTP 401)
[TEST] Metrics endpoint (with auth)
[PASS] Metrics endpoint (with auth) (HTTP 200)

=== Prometheus Format Tests ===
[TEST] Prometheus Metrics Format
[PASS] Prometheus Metrics Format

=== Essential Metrics Presence ===
[PASS] Metric present: up{environment="production"}
[PASS] Metric present: newsletter_subscribers_total{environment="production"}
[PASS] Metric present: newsletter_subscribers_active{environment="production"}
[PASS] Metric present: database_status{environment="production"}

=== Prometheus Query API Tests ===
[TEST] Prometheus Query API: up
[PASS] Query API: up = 1
[TEST] Prometheus Query API: database_status
[PASS] Query API: database_status = 1
[TEST] Prometheus Query API: newsletter_subscribers_total
[PASS] Query API: newsletter_subscribers_total = 3
[TEST] Prometheus Query API: newsletter_subscribers_active
[PASS] Query API: newsletter_subscribers_active = 3

... (more tests)

========================================
Metrics Validation Summary
========================================
Environment: production
Total Tests: 25
Passed: 25
Failed: 0

🎉 All metrics tests passed!

✅ Your metrics system is working correctly!
✅ Grafana should be able to scrape and display all metrics
✅ All Prometheus API endpoints are functional
```
