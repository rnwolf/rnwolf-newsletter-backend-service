#!/bin/bash
# debug-metrics.sh - Detailed debugging for metrics validation

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENVIRONMENT=${1:-production}
if [[ "$ENVIRONMENT" == "staging" ]]; then
    API_URL="https://api-staging.rnwolf.net"
    API_KEY="$GRAFANA_API_KEY_STAGING"
elif [[ "$ENVIRONMENT" == "production" ]]; then
    API_URL="https://api.rnwolf.net"
    API_KEY="$GRAFANA_API_KEY_PRODUCTION"
else
    echo "Usage: $0 [staging|production]"
    exit 1
fi

echo "🔍 Debugging Metrics Validation for $ENVIRONMENT"
echo "================================================"
echo "API URL: $API_URL"
echo ""

# Step 1: Check environment variables
echo "1. Environment Variables Check:"
echo "------------------------------"
if [[ -n "$API_KEY" ]]; then
    echo "✅ GRAFANA_API_KEY_${ENVIRONMENT^^} is set"
    echo "   Value: ${API_KEY:0:15}... (showing first 15 chars)"
else
    echo "❌ GRAFANA_API_KEY_${ENVIRONMENT^^} is NOT set"
    echo ""
    echo "Available Grafana environment variables:"
    env | grep -i grafana || echo "   None found"
    echo ""
    echo "To fix, run:"
    echo "   export GRAFANA_API_KEY_${ENVIRONMENT^^}=your_token_here"
    exit 1
fi

echo ""

# Step 2: Basic connectivity
echo "2. Basic Connectivity Test:"
echo "---------------------------"
echo "Testing: curl -v $API_URL/health"
echo ""

HEALTH_RESPONSE=$(curl -v "$API_URL/health" 2>&1)
HEALTH_EXIT_CODE=$?

echo "Exit code: $HEALTH_EXIT_CODE"
echo "Response:"
echo "$HEALTH_RESPONSE"
echo ""

if [[ $HEALTH_EXIT_CODE -ne 0 ]]; then
    echo "❌ Basic connectivity failed"
    echo "This suggests network/DNS issues or the service is down"
    exit 1
else
    echo "✅ Basic connectivity works"
fi

echo ""

# Step 3: Test metrics endpoint without auth
echo "3. Metrics Endpoint Without Auth:"
echo "--------------------------------"
echo "Testing: curl -v $API_URL/metrics"
echo ""

NO_AUTH_RESPONSE=$(curl -v "$API_URL/metrics" 2>&1)
NO_AUTH_EXIT_CODE=$?

echo "Exit code: $NO_AUTH_EXIT_CODE"
echo "Response:"
echo "$NO_AUTH_RESPONSE"
echo ""

if echo "$NO_AUTH_RESPONSE" | grep -q "401"; then
    echo "✅ Correctly requires authentication (got 401)"
else
    echo "⚠️  Expected 401 Unauthorized"
fi

echo ""

# Step 4: Test metrics endpoint with auth
echo "4. Metrics Endpoint With Auth:"
echo "-----------------------------"
echo "Testing: curl -v -H 'Authorization: Bearer ***' $API_URL/metrics"
echo ""

AUTH_RESPONSE=$(curl -v -H "Authorization: Bearer $API_KEY" "$API_URL/metrics" 2>&1)
AUTH_EXIT_CODE=$?

echo "Exit code: $AUTH_EXIT_CODE"
echo "Response (first 1000 chars):"
echo "${AUTH_RESPONSE:0:1000}"
echo ""

if [[ $AUTH_EXIT_CODE -eq 0 ]] && echo "$AUTH_RESPONSE" | grep -q "# HELP"; then
    echo "✅ Metrics endpoint works with auth"
else
    echo "❌ Metrics endpoint failed with auth"
    echo "Full response:"
    echo "$AUTH_RESPONSE"
fi

echo ""

# Step 5: Test specific Prometheus query
echo "5. Prometheus Query Test:"
echo "------------------------"
QUERY_URL="$API_URL/metrics/api/v1/query?query=up"
echo "Testing: curl -v -H 'Authorization: Bearer ***' '$QUERY_URL'"
echo ""

QUERY_RESPONSE=$(curl -v -H "Authorization: Bearer $API_KEY" "$QUERY_URL" 2>&1)
QUERY_EXIT_CODE=$?

echo "Exit code: $QUERY_EXIT_CODE"
echo "Response:"
echo "$QUERY_RESPONSE"
echo ""

if [[ $QUERY_EXIT_CODE -eq 0 ]] && echo "$QUERY_RESPONSE" | grep -q '"status":"success"'; then
    echo "✅ Prometheus query API works"
else
    echo "❌ Prometheus query API failed"
fi

echo ""

# Step 6: Check if jq is available
echo "6. Tools Check:"
echo "--------------"
if command -v jq &> /dev/null; then
    echo "✅ jq is available"
    JQ_VERSION=$(jq --version)
    echo "   Version: $JQ_VERSION"
else
    echo "❌ jq is NOT available"
    echo "   This will cause JSON parsing to fail"
    echo "   Install with: sudo apt install jq  # or brew install jq"
fi

if command -v curl &> /dev/null; then
    echo "✅ curl is available"
    CURL_VERSION=$(curl --version | head -n1)
    echo "   Version: $CURL_VERSION"
else
    echo "❌ curl is NOT available"
fi

echo ""

# Step 7: Test JSON parsing if jq is available
if command -v jq &> /dev/null; then
    echo "7. JSON Parsing Test:"
    echo "--------------------"
    
    JSON_TEST='{"status":"success","data":{"result":[{"value":["123","1"]}]}}'
    echo "Testing JSON: $JSON_TEST"
    
    STATUS=$(echo "$JSON_TEST" | jq -r '.status' 2>/dev/null)
    VALUE=$(echo "$JSON_TEST" | jq -r '.data.result[0].value[1]' 2>/dev/null)
    
    echo "Parsed status: $STATUS"
    echo "Parsed value: $VALUE"
    
    if [[ "$STATUS" == "success" ]] && [[ "$VALUE" == "1" ]]; then
        echo "✅ JSON parsing works correctly"
    else
        echo "❌ JSON parsing failed"
    fi
    
    echo ""
fi

# Step 8: Test actual metric query with JSON parsing
if command -v jq &> /dev/null; then
    echo "8. End-to-End Metric Test:"
    echo "-------------------------"
    
    echo "Fetching 'up' metric..."
    UP_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_URL/metrics/api/v1/query?query=up" 2>/dev/null)
    
    if [[ -z "$UP_RESPONSE" ]]; then
        echo "❌ No response received"
    else
        echo "Raw response:"
        echo "$UP_RESPONSE"
        echo ""
        
        if echo "$UP_RESPONSE" | jq . >/dev/null 2>&1; then
            echo "✅ Valid JSON response"
            
            STATUS=$(echo "$UP_RESPONSE" | jq -r '.status' 2>/dev/null)
            RESULT_COUNT=$(echo "$UP_RESPONSE" | jq -r '.data.result | length' 2>/dev/null)
            
            echo "Status: $STATUS"
            echo "Result count: $RESULT_COUNT"
            
            if [[ "$STATUS" == "success" ]] && [[ "$RESULT_COUNT" -gt "0" ]]; then
                METRIC_VALUE=$(echo "$UP_RESPONSE" | jq -r '.data.result[0].value[1]' 2>/dev/null)
                echo "✅ Metric value: $METRIC_VALUE"
            else
                echo "❌ Unexpected status or empty results"
            fi
        else
            echo "❌ Invalid JSON response"
        fi
    fi
else
    echo "8. Skipping JSON test (jq not available)"
fi

echo ""
echo "🔍 Debug Summary:"
echo "================"
echo "If all steps above passed, the metrics-validation.sh script should work."
echo "If any step failed, that's where the issue is."
echo ""
echo "Common issues:"
echo "1. Missing GRAFANA_API_KEY_${ENVIRONMENT^^} environment variable"
echo "2. Invalid or expired API token"
echo "3. Missing jq command"
echo "4. Network connectivity issues"
echo "5. Service not deployed or not responding"
echo ""
echo "To run the full validation:"
echo "./scripts/metrics-validation.sh $ENVIRONMENT"