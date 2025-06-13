#!/bin/bash
# metrics-validation.sh - Quick validation script for all metrics

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

print_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

print_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Configuration
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

if [[ -z "$API_KEY" ]]; then
    print_fail "API key not set for $ENVIRONMENT environment"
    echo "Please set GRAFANA_API_KEY_${ENVIRONMENT^^}"
    exit 1
fi

echo "Validating Metrics for $ENVIRONMENT Environment"
echo "API URL: $API_URL"
echo "========================================"

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_pattern="$3"
    
    ((TOTAL_TESTS++))
    print_test "$test_name"
    
    local result
    if result=$(eval "$test_command" 2>&1); then
        if [[ -n "$expected_pattern" ]] && ! echo "$result" | grep -q "$expected_pattern"; then
            print_fail "$test_name - Expected pattern not found: $expected_pattern"
            echo "  Result: $result"
            ((FAILED_TESTS++))
            return 1
        else
            print_pass "$test_name"
            ((PASSED_TESTS++))
            return 0
        fi
    else
        print_fail "$test_name - Command failed"
        echo "  Error: $result"
        ((FAILED_TESTS++))
        return 1
    fi
}

# Test 1: Basic API Health
run_test "API Health Check" \
    "curl -s -f $API_URL/health | jq -r .success" \
    "true"

# Test 2: Prometheus Format Metrics
run_test "Prometheus Metrics Format" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics | head -5" \
    "# HELP"

# Test 3: Essential Metrics Present
print_test "Checking essential metrics presence..."
METRICS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_URL/metrics")

ESSENTIAL_METRICS=(
    "up{environment=\"$ENVIRONMENT\"}"
    "newsletter_subscribers_total{environment=\"$ENVIRONMENT\"}"
    "newsletter_subscribers_active{environment=\"$ENVIRONMENT\"}"
    "database_status{environment=\"$ENVIRONMENT\"}"
)

for metric in "${ESSENTIAL_METRICS[@]}"; do
    ((TOTAL_TESTS++))
    if echo "$METRICS_RESPONSE" | grep -q "$metric"; then
        print_pass "Metric present: $metric"
        ((PASSED_TESTS++))
    else
        print_fail "Metric missing: $metric"
        ((FAILED_TESTS++))
    fi
done

# Test 4: Prometheus Query API - Individual Metrics
QUERY_METRICS=(
    "up"
    "database_status"
    "newsletter_subscribers_total"
    "newsletter_subscribers_active"
)

for metric in "${QUERY_METRICS[@]}"; do
    ((TOTAL_TESTS++))
    print_test "Prometheus Query API: $metric"
    
    QUERY_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
        "$API_URL/metrics/api/v1/query?query=$metric")
    
    STATUS=$(echo "$QUERY_RESPONSE" | jq -r '.status')
    RESULT_COUNT=$(echo "$QUERY_RESPONSE" | jq -r '.data.result | length')
    
    if [[ "$STATUS" == "success" ]] && [[ "$RESULT_COUNT" == "1" ]]; then
        METRIC_VALUE=$(echo "$QUERY_RESPONSE" | jq -r '.data.result[0].value[1]')
        print_pass "Query API: $metric = $METRIC_VALUE"
        ((PASSED_TESTS++))
    else
        print_fail "Query API: $metric (status: $STATUS, results: $RESULT_COUNT)"
        ((FAILED_TESTS++))
    fi
done

# Test 5: Range Query API
((TOTAL_TESTS++))
print_test "Prometheus Range Query API"

NOW=$(date +%s)
START=$((NOW - 3600))  # 1 hour ago
END=$NOW
STEP=300  # 5 minutes

RANGE_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query_range?query=up&start=$START&end=$END&step=$STEP")

RANGE_STATUS=$(echo "$RANGE_RESPONSE" | jq -r '.status')
RANGE_TYPE=$(echo "$RANGE_RESPONSE" | jq -r '.data.resultType')
RANGE_VALUES=$(echo "$RANGE_RESPONSE" | jq -r '.data.result[0].values | length')

if [[ "$RANGE_STATUS" == "success" ]] && [[ "$RANGE_TYPE" == "matrix" ]] && [[ "$RANGE_VALUES" -gt "0" ]]; then
    print_pass "Range Query API: $RANGE_VALUES data points"
    ((PASSED_TESTS++))
else
    print_fail "Range Query API (status: $RANGE_STATUS, type: $RANGE_TYPE, values: $RANGE_VALUES)"
    ((FAILED_TESTS++))
fi

# Test 6: JSON Metrics Endpoint
run_test "JSON Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/json | jq -r '.database.database_status'" \
    "connected"

# Test 7: Database Metrics Endpoint
run_test "Database Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/database | jq -r '.database_status'" \
    "connected"

# Test 8: Health Metrics Endpoint
run_test "Health Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/health | jq -r '.overall_status'" \
    "healthy"

# Test 9: Grafana Test Query (1+1)
run_test "Grafana Test Query (1+1)" \
    "curl -s -H 'Authorization: Bearer $API_KEY' '$API_URL/metrics/api/v1/query?query=1%2B1' | jq -r '.data.result[1]'" \
    "2"

# Test 10: Metric Values Validation
print_test "Validating metric values are reasonable..."

UP_VALUE=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=up" | jq -r '.data.result[0].value[1]')

DB_STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=database_status" | jq -r '.data.result[0].value[1]')

SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=newsletter_subscribers_total" | jq -r '.data.result[0].value[1]')

((TOTAL_TESTS+=3))

# Validate 'up' metric
if [[ "$UP_VALUE" == "1" ]]; then
    print_pass "Up metric value: $UP_VALUE (service is up)"
    ((PASSED_TESTS++))
else
    print_fail "Up metric value: $UP_VALUE (should be 1)"
    ((FAILED_TESTS++))
fi

# Validate database status
if [[ "$DB_STATUS" == "1" ]]; then
    print_pass "Database status: $DB_STATUS (connected)"
    ((PASSED_TESTS++))
elif [[ "$DB_STATUS" == "0" ]]; then
    print_warn "Database status: $DB_STATUS (disconnected)"
    ((FAILED_TESTS++))
else
    print_fail "Database status: $DB_STATUS (invalid value)"
    ((FAILED_TESTS++))
fi

# Validate subscriber count
if [[ "$SUBSCRIBERS" =~ ^[0-9]+$ ]] && [[ "$SUBSCRIBERS" -ge 0 ]]; then
    print_pass "Subscriber count: $SUBSCRIBERS (valid)"
    ((PASSED_TESTS++))
else
    print_fail "Subscriber count: $SUBSCRIBERS (invalid)"
    ((FAILED_TESTS++))
fi

# Test 11: Authentication Tests
print_test "Testing authentication requirements..."

((TOTAL_TESTS+=2))

# Test without auth (should fail)
NO_AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/metrics")
if [[ "$NO_AUTH_STATUS" == "401" ]]; then
    print_pass "Metrics endpoint properly requires authentication"
    ((PASSED_TESTS++))
else
    print_fail "Metrics endpoint authentication check (got HTTP $NO_AUTH_STATUS, expected 401)"
    ((FAILED_TESTS++))
fi

# Test with invalid auth (should fail)
INVALID_AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer invalid-token" "$API_URL/metrics")
if [[ "$INVALID_AUTH_STATUS" == "401" ]]; then
    print_pass "Invalid token properly rejected"
    ((PASSED_TESTS++))
else
    print_fail "Invalid token check (got HTTP $INVALID_AUTH_STATUS, expected 401)"
    ((FAILED_TESTS++))
fi

# Test 12: Response Time Check
print_test "Testing response time performance..."

((TOTAL_TESTS++))

START_TIME=$(date +%s%3N)
curl -s -H "Authorization: Bearer $API_KEY" "$API_URL/metrics" > /dev/null
END_TIME=$(date +%s%3N)
RESPONSE_TIME=$((END_TIME - START_TIME))

if [[ "$RESPONSE_TIME" -lt 2000 ]]; then
    print_pass "Response time: ${RESPONSE_TIME}ms (good)"
    ((PASSED_TESTS++))
elif [[ "$RESPONSE_TIME" -lt 5000 ]]; then
    print_warn "Response time: ${RESPONSE_TIME}ms (acceptable)"
    ((PASSED_TESTS++))
else
    print_fail "Response time: ${RESPONSE_TIME}ms (too slow)"
    ((FAILED_TESTS++))
fi

# Test 13: Prometheus API Compatibility Endpoints
PROMETHEUS_ENDPOINTS=(
    "/metrics/api/v1/status/buildinfo"
    "/metrics/api/v1/label/__name__/values"
    "/metrics/api/v1/labels"
)

for endpoint in "${PROMETHEUS_ENDPOINTS[@]}"; do
    ((TOTAL_TESTS++))
    print_test "Prometheus API: $endpoint"
    
    ENDPOINT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer $API_KEY" "$API_URL$endpoint")
    
    if [[ "$ENDPOINT_STATUS" == "200" ]]; then
        print_pass "Prometheus API: $endpoint"
        ((PASSED_TESTS++))
    else
        print_fail "Prometheus API: $endpoint (HTTP $ENDPOINT_STATUS)"
        ((FAILED_TESTS++))
    fi
done

# Test 14: Data Consistency Check
print_test "Checking data consistency across endpoints..."

((TOTAL_TESTS++))

# Get subscriber count from different endpoints
PROM_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=newsletter_subscribers_total" | \
    jq -r '.data.result[0].value[1]')

JSON_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/json" | jq -r '.database.newsletter_subscribers_total')

DB_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/database" | jq -r '.newsletter_subscribers_total')

if [[ "$PROM_SUBSCRIBERS" == "$JSON_SUBSCRIBERS" ]] && [[ "$JSON_SUBSCRIBERS" == "$DB_SUBSCRIBERS" ]]; then
    print_pass "Data consistency: All endpoints report same subscriber count ($PROM_SUBSCRIBERS)"
    ((PASSED_TESTS++))
else
    print_fail "Data consistency: Prom=$PROM_SUBSCRIBERS, JSON=$JSON_SUBSCRIBERS, DB=$DB_SUBSCRIBERS"
    ((FAILED_TESTS++))
fi

# Summary
echo ""
echo "========================================"
echo "Metrics Validation Summary"
echo "========================================"
echo "Environment: $ENVIRONMENT"
echo "Total Tests: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $FAILED_TESTS"

if [[ "$FAILED_TESTS" -eq 0 ]]; then
    print_pass "🎉 All metrics tests passed!"
    echo ""
    echo "✅ Your metrics system is working correctly!"
    echo "✅ Grafana should be able to scrape and display all metrics"
    echo "✅ All Prometheus API endpoints are functional"
    echo ""
    echo "Next steps:"
    echo "1. Check your Grafana dashboards: https://throughputfocus.grafana.net/dashboards"
    echo "2. Verify datasource connectivity in Grafana UI"
    echo "3. Test dashboard panels show data"
    exit 0
else
    print_fail "❌ Some metrics tests failed!"
    echo ""
    echo "Issues found:"
    echo "- $FAILED_TESTS out of $TOTAL_TESTS tests failed"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check the failed tests above"
    echo "2. Verify your deployment includes the latest metrics code"
    echo "3. Check Cloudflare Worker logs: npx wrangler tail --env $ENVIRONMENT"
    echo "4. Verify database connectivity"
    exit 1
fi