# Grafana "No Data" Debugging Guide

Since your reset completed successfully but dashboards show "No data", let's systematically test each component in the pipeline:

**Pipeline Components:**
1. **Newsletter API** → 2. **Metrics Handler** → 3. **Grafana Datasource** → 4. **Dashboard Panels**

## Step 1: Test Newsletter API Health

First, verify your APIs are running and responding:

```bash
# Test staging API
curl -s https://api-staging.rnwolf.net/health | jq .

# Test production API  
curl -s https://api.rnwolf.net/health | jq .
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Newsletter API is running!",
  "database": "Connected",
  "environment": "staging|production"
}
```

**❌ If this fails:** Your API deployment is broken
**✅ If this works:** API is healthy, continue to metrics

---

## Step 2: Test Metrics Handler with Authentication

Test the metrics endpoints that Grafana is trying to access:

```bash
# Get your new tokens
cat .grafana-tokens-20250613-114810.env

# Set them as variables
export GRAFANA_API_KEY_STAGING="your_staging_token_here"
export GRAFANA_API_KEY_PRODUCTION="your_production_token_here"

# Test staging metrics endpoint
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_STAGING" \
  https://api-staging.rnwolf.net/metrics | head -20

# Test production metrics endpoint  
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics | head -20
```

**Expected Response (Prometheus format):**
```
# HELP up Whether the service is up
# TYPE up gauge
up{environment="production"} 1

# HELP newsletter_subscribers_total Total number of newsletter subscribers
# TYPE newsletter_subscribers_total gauge
newsletter_subscribers_total{environment="production"} 3

# HELP database_status Database connection status (1=connected, 0=error)
# TYPE database_status gauge
database_status{environment="production"} 1
```

**❌ If you get 401/403:** Authentication issue with new tokens
**❌ If you get 404:** Metrics handler not deployed or wrong path
**❌ If you get empty/wrong format:** Metrics handler code issue
**✅ If you get Prometheus format:** Metrics handler working, continue

---

## Step 3: Test Database Metrics Specifically

Test the database metrics that your "database status" panel needs:

```bash
# Test database metrics endpoint
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics/database | jq .

# Test health metrics endpoint
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics/health | jq .
```

**Expected Database Response:**
```json
{
  "newsletter_subscribers_total": 3,
  "newsletter_subscribers_active": 3,
  "newsletter_subscriptions_24h": 0,
  "newsletter_unsubscribes_24h": 0,
  "database_status": "connected"
}
```

**❌ If database_status is "error":** Database connection issue
**❌ If values are -1:** Database query failures
**✅ If you get valid numbers:** Database is working

---

## Step 4: Test Prometheus API Compatibility

Test the specific API format that Grafana uses:

```bash
# Test the Prometheus query API that Grafana calls
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=database_status" | jq .

# Test the 'up' metric that Grafana always checks first
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=up" | jq .

# Test newsletter metrics
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=newsletter_subscribers_total" | jq .
```

**Expected Response:**
```json
{
  "status": "success",
  "data": {
    "resultType": "vector",
    "result": [
      {
        "metric": {
          "__name__": "database_status",
          "environment": "production"
        },
        "value": [1749811234, "1"]
      }
    ]
  }
}
```

**❌ If status is "error":** Prometheus API implementation issue
**❌ If result is empty []:** Metric not found or query wrong
**✅ If you get valid data:** Prometheus API working

---

## Step 5: Test Grafana Datasource Configuration

Test if Grafana can reach your APIs through the datasources:

```bash
# Go to Grafana UI
open https://throughputfocus.grafana.net/connections/datasources

# Find your Newsletter-API-Production datasource
# Click "Save & Test"
```

**Expected:** Green "Data source is working" message

**❌ If authentication fails:** Check if tokens were updated correctly
**❌ If connection fails:** Network/URL issue
**❌ If timeout:** API too slow or not responding

**Manual Token Check:**
```bash
# Verify the token is set in Cloudflare
npx wrangler secret list --env production

# Should show GRAFANA_API_KEY in the list
```

---

## Step 6: Test Dashboard Panel Queries

If datasource works but panels show "No data", check the panel configuration:

1. **Open the Production Dashboard:**
   ```
   https://throughputfocus.grafana.net/d/newsletter-production-1749811701/...
   ```

2. **Edit the "Database Status" panel:**
   - Click the panel title → Edit
   - Check the Query tab
   - Verify the query is: `database_status`
   - Check the datasource is: `Newsletter-API-Production`

3. **Test the query directly:**
   - In the query editor, click "Run queries"
   - Check the Query Inspector (click the "Query Inspector" button)

**Expected in Query Inspector:**
- ✅ Status: 200
- ✅ Response has data array with values
- ✅ No error messages

---

## Step 7: Debug Common Issues

### Issue: Authentication Errors (401/403)

```bash
# Check if secret was actually updated
npx wrangler secret list --env production

# Test with the exact token from your file
TOKEN=$(grep GRAFANA_API_KEY_PRODUCTION .grafana-tokens-20250613-114810.env | cut -d'=' -f2)
curl -s -H "Authorization: Bearer $TOKEN" https://api.rnwolf.net/metrics | head -5
```

### Issue: Wrong Metric Format

```bash
# Check if metrics are in correct Prometheus format
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics | grep -E "(database_status|up)" 

# Should show lines like:
# database_status{environment="production"} 1
# up{environment="production"} 1
```

### Issue: Panel Configuration

Check these panel settings in Grafana:
- **Query:** Should be exactly `database_status` or `up`
- **Datasource:** Should be `Newsletter-API-Production`
- **Time range:** Try "Last 5 minutes" or "Last 1 hour"
- **Refresh:** Click the refresh button in dashboard

### Issue: Time Range Problems

```bash
# Check if metrics have timestamps
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=up" | jq '.data.result[0].value'

# Should return: [timestamp, "1"]
# timestamp should be recent (within last few minutes)
```

---

## Step 8: Generate Fresh Data

If everything tests fine but you still see "No data", try generating fresh metrics:

```bash
# Hit the health endpoint a few times to generate metrics
for i in {1..5}; do
  curl -s https://api.rnwolf.net/health > /dev/null
  echo "Hit $i"
  sleep 1
done

# Wait 30 seconds for metrics to be collected
sleep 30

# Test metrics again
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=up"
```

---

## Quick Diagnostic Script

Run this to test everything at once:

```bash
#!/bin/bash
# Save as debug-grafana.sh

echo "=== Testing Grafana Pipeline ==="

# Load tokens
source .grafana-tokens-20250613-114810.env

echo "1. Testing API health..."
curl -s https://api.rnwolf.net/health | jq .success

echo "2. Testing metrics endpoint..."
METRICS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" https://api.rnwolf.net/metrics)
echo "Metrics HTTP status: $METRICS_STATUS"

echo "3. Testing Prometheus API..."
UP_QUERY=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" "https://api.rnwolf.net/metrics/api/v1/query?query=up" | jq '.data.result | length')
echo "Up query results: $UP_QUERY"

echo "4. Testing database status..."
DB_QUERY=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" "https://api.rnwolf.net/metrics/api/v1/query?query=database_status" | jq '.data.result | length')
echo "Database status results: $DB_QUERY"

echo "5. Check Cloudflare secret..."
npx wrangler secret list --env production | grep GRAFANA_API_KEY
```

---

## Most Likely Issues (in order):

1. **Token not updated in Cloudflare** - Secret didn't propagate
2. **Metrics format issue** - Not proper Prometheus format  
3. **Panel query wrong** - Dashboard looking for wrong metric name
4. **Time range issue** - Dashboard looking at wrong time window
5. **Database empty** - No actual data to display

Run through steps 1-4 first, then check the Grafana datasource configuration. This will pinpoint exactly where the pipeline breaks.