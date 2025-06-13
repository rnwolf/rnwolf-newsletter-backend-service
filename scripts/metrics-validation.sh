#!/bin/bash
# metrics-validation.sh - Enhanced version with better error handling and debugging

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

print_debug() {
    echo -e "${YELLOW}[DEBUG]${NC} $1"
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

echo "Validating Metrics for $ENVIRONMENT Environment"
echo "API URL: $API_URL"
echo "========================================"

# Check if API key is set
if [[ -z "$API_KEY" ]]; then
    print_fail "API key not set for $ENVIRONMENT environment"
    echo "Please set GRAFANA_API_KEY_${ENVIRONMENT^^}"
    echo ""
    echo "Expected environment variable:"
    echo "  export GRAFANA_API_KEY_${ENVIRONMENT^^}=glsa_your_token_here"
    echo ""
    echo "Available environment variables:"
    env | grep -i grafana || echo "  No Grafana-related environment variables found"
    exit 1
fi

print_debug "Using API key: ${API_KEY:0:10}... (showing first 10 chars)"
echo ""

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
    local exit_code=0

    # Use bash to execute the command properly
    if ! result=$(bash -c "$test_command" 2>&1); then
        exit_code=$?
        print_fail "$test_name - Command failed (exit code: $exit_code)"
        print_debug "Command: $test_command"
        print_debug "Output: $result"
        ((FAILED_TESTS++))
        return 1
    fi

    # Check if we got any result
    if [[ -z "$result" ]]; then
        print_fail "$test_name - No output received"
        print_debug "Command: $test_command"
        ((FAILED_TESTS++))
        return 1
    fi

    # Check expected pattern if provided
    if [[ -n "$expected_pattern" ]] && ! echo "$result" | grep -q "$expected_pattern"; then
        print_fail "$test_name - Expected pattern not found: $expected_pattern"
        print_debug "Command: $test_command"
        print_debug "Result: $result"
        ((FAILED_TESTS++))
        return 1
    else
        print_pass "$test_name"
        if [[ -n "$expected_pattern" ]]; then
            print_debug "Found expected pattern: $expected_pattern"
        fi
        print_debug "Result: $result"
        ((PASSED_TESTS++))
        return 0
    fi
}

# Helper function to test API endpoints with better error handling
test_api_endpoint() {
    local endpoint="$1"
    local description="$2"
    local expected_status="${3:-200}"
    local auth_required="${4:-false}"

    print_test "$description"

    local curl_args=(-s -w "%{http_code}" --max-time 10)

    if [[ "$auth_required" == "true" ]]; then
        curl_args+=(-H "Authorization: Bearer $API_KEY")
    fi

    curl_args+=("$API_URL$endpoint")

    print_debug "Running: curl ${curl_args[*]}"

    local response
    if ! response=$(curl "${curl_args[@]}" 2>&1); then
        print_fail "$description - Curl command failed"
        print_debug "Error: $response"
        ((TOTAL_TESTS++))
        ((FAILED_TESTS++))
        return 1
    fi

    # Extract HTTP code (last 3 characters) and body (everything else)
    local http_code="${response: -3}"
    local body="${response%???}"

    ((TOTAL_TESTS++))

    if [[ "$http_code" == "$expected_status" ]]; then
        print_pass "$description (HTTP $http_code)"
        print_debug "Response body: ${body:0:200}..." # Show first 200 chars
        ((PASSED_TESTS++))
        return 0
    else
        print_fail "$description (HTTP $http_code, expected $expected_status)"
        print_debug "Response body: $body"
        ((FAILED_TESTS++))
        return 1
    fi
}

# Test 1: Basic API Health (no auth required)
print_test "=== Basic Connectivity Tests ==="
test_api_endpoint "/health" "API Health Check" "200" "false"

# Test 2: Metrics endpoints (auth required)
print_test ""
print_test "=== Metrics Authentication Tests ==="
test_api_endpoint "/metrics" "Metrics endpoint (no auth)" "401" "false"
test_api_endpoint "/metrics" "Metrics endpoint (with auth)" "200" "true"

# Test 3: Prometheus Format Metrics
print_test ""
print_test "=== Prometheus Format Tests ==="
run_test "Prometheus Metrics Format" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics | head -5" \
    "# HELP"

# Test 4: Essential Metrics Present
print_test ""
print_test "=== Essential Metrics Presence ==="

METRICS_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" "$API_URL/metrics" 2>/dev/null)
if [[ -z "$METRICS_RESPONSE" ]]; then
    print_fail "Could not fetch metrics response"
    METRICS_RESPONSE=""
fi

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
        print_debug "Searched for: $metric"
        print_debug "In response: ${METRICS_RESPONSE:0:500}..."
        ((FAILED_TESTS++))
    fi
done

# Test 5: Prometheus Query API - Individual Metrics
print_test ""
print_test "=== Prometheus Query API Tests ==="

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
        "$API_URL/metrics/api/v1/query?query=$metric" 2>/dev/null)

    if [[ -z "$QUERY_RESPONSE" ]]; then
        print_fail "Query API: $metric - No response"
        print_debug "URL: $API_URL/metrics/api/v1/query?query=$metric"
        ((FAILED_TESTS++))
        continue
    fi

    # Check if response is valid JSON
    if ! echo "$QUERY_RESPONSE" | jq . >/dev/null 2>&1; then
        print_fail "Query API: $metric - Invalid JSON response"
        print_debug "Response: $QUERY_RESPONSE"
        ((FAILED_TESTS++))
        continue
    fi

    STATUS=$(echo "$QUERY_RESPONSE" | jq -r '.status' 2>/dev/null)
    RESULT_COUNT=$(echo "$QUERY_RESPONSE" | jq -r '.data.result | length' 2>/dev/null)

    if [[ "$STATUS" == "success" ]] && [[ "$RESULT_COUNT" == "1" ]]; then
        METRIC_VALUE=$(echo "$QUERY_RESPONSE" | jq -r '.data.result[0].value[1]' 2>/dev/null)
        print_pass "Query API: $metric = $METRIC_VALUE"
        ((PASSED_TESTS++))
    else
        print_fail "Query API: $metric (status: $STATUS, results: $RESULT_COUNT)"
        print_debug "Response: $QUERY_RESPONSE"
        ((FAILED_TESTS++))
    fi
done

# Test 6: Range Query API
print_test ""
print_test "=== Range Query API Test ==="
((TOTAL_TESTS++))
print_test "Prometheus Range Query API"

NOW=$(date +%s)
START=$((NOW - 3600))  # 1 hour ago
END=$NOW
STEP=300  # 5 minutes

RANGE_RESPONSE=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query_range?query=up&start=$START&end=$END&step=$STEP" 2>/dev/null)

if [[ -z "$RANGE_RESPONSE" ]]; then
    print_fail "Range Query API - No response"
    ((FAILED_TESTS++))
else
    if ! echo "$RANGE_RESPONSE" | jq . >/dev/null 2>&1; then
        print_fail "Range Query API - Invalid JSON response"
        print_debug "Response: $RANGE_RESPONSE"
        ((FAILED_TESTS++))
    else
        RANGE_STATUS=$(echo "$RANGE_RESPONSE" | jq -r '.status' 2>/dev/null)
        RANGE_TYPE=$(echo "$RANGE_RESPONSE" | jq -r '.data.resultType' 2>/dev/null)
        RANGE_VALUES=$(echo "$RANGE_RESPONSE" | jq -r '.data.result[0].values | length' 2>/dev/null)

        if [[ "$RANGE_STATUS" == "success" ]] && [[ "$RANGE_TYPE" == "matrix" ]] && [[ "$RANGE_VALUES" -gt "0" ]]; then
            print_pass "Range Query API: $RANGE_VALUES data points"
            ((PASSED_TESTS++))
        else
            print_fail "Range Query API (status: $RANGE_STATUS, type: $RANGE_TYPE, values: $RANGE_VALUES)"
            print_debug "Response: $RANGE_RESPONSE"
            ((FAILED_TESTS++))
        fi
    fi
fi

# Test 7: JSON Metrics Endpoint
print_test ""
print_test "=== JSON Endpoints Tests ==="
run_test "JSON Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/json | jq -r '.database.database_status'" \
    "connected"

# Test 8: Database Metrics Endpoint
run_test "Database Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/database | jq -r '.database_status'" \
    "connected"

# Test 9: Health Metrics Endpoint
run_test "Health Metrics Endpoint" \
    "curl -s -f -H 'Authorization: Bearer $API_KEY' $API_URL/metrics/health | jq -r '.overall_status'" \
    "healthy"

# Test 10: Grafana Test Query (1+1)
print_test ""
print_test "=== Grafana Compatibility Test ==="
run_test "Grafana Test Query (1+1)" \
    "curl -s -H 'Authorization: Bearer $API_KEY' '$API_URL/metrics/api/v1/query?query=1%2B1' | jq -r '.data.result[1]'" \
    "2"

# Test 11: Metric Values Validation
print_test ""
print_test "=== Metric Values Validation ==="

UP_VALUE=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=up" 2>/dev/null | jq -r '.data.result[0].value[1]' 2>/dev/null)

DB_STATUS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=database_status" 2>/dev/null | jq -r '.data.result[0].value[1]' 2>/dev/null)

SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=newsletter_subscribers_total" 2>/dev/null | jq -r '.data.result[0].value[1]' 2>/dev/null)

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

# Test 12: Authentication Tests
print_test ""
print_test "=== Authentication Security Tests ==="

((TOTAL_TESTS+=2))

# Test without auth (should fail)
print_test "Metrics endpoint requires authentication"
NO_AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL/metrics" 2>/dev/null)
if [[ "$NO_AUTH_STATUS" == "401" ]]; then
    print_pass "Metrics endpoint properly requires authentication"
    ((PASSED_TESTS++))
else
    print_fail "Metrics endpoint authentication check (got HTTP $NO_AUTH_STATUS, expected 401)"
    ((FAILED_TESTS++))
fi

# Test with invalid auth (should fail)
print_test "Invalid token rejection"
INVALID_AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "Authorization: Bearer invalid-token" "$API_URL/metrics" 2>/dev/null)
if [[ "$INVALID_AUTH_STATUS" == "401" ]]; then
    print_pass "Invalid token properly rejected"
    ((PASSED_TESTS++))
else
    print_fail "Invalid token check (got HTTP $INVALID_AUTH_STATUS, expected 401)"
    ((FAILED_TESTS++))
fi

# Test 13: Response Time Check
print_test ""
print_test "=== Performance Tests ==="

((TOTAL_TESTS++))
print_test "Response time check"

START_TIME=$(date +%s%3N)
curl -s -H "Authorization: Bearer $API_KEY" --max-time 10 "$API_URL/metrics" > /dev/null 2>&1
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

# Test 14: Prometheus API Compatibility Endpoints
print_test ""
print_test "=== Prometheus API Compatibility ==="

PROMETHEUS_ENDPOINTS=(
    "/metrics/api/v1/status/buildinfo"
    "/metrics/api/v1/label/__name__/values"
    "/metrics/api/v1/labels"
)

for endpoint in "${PROMETHEUS_ENDPOINTS[@]}"; do
    ((TOTAL_TESTS++))
    print_test "Prometheus API: $endpoint"

    ENDPOINT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        -H "Authorization: Bearer $API_KEY" "$API_URL$endpoint" 2>/dev/null)

    if [[ "$ENDPOINT_STATUS" == "200" ]]; then
        print_pass "Prometheus API: $endpoint"
        ((PASSED_TESTS++))
    else
        print_fail "Prometheus API: $endpoint (HTTP $ENDPOINT_STATUS)"
        ((FAILED_TESTS++))
    fi
done

# Test 15: Data Consistency Check
print_test ""
print_test "=== Data Consistency Tests ==="

((TOTAL_TESTS++))

# Get subscriber count from different endpoints
PROM_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=newsletter_subscribers_total" 2>/dev/null | \
    jq -r '.data.result[0].value[1]' 2>/dev/null)

JSON_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/json" 2>/dev/null | jq -r '.database.newsletter_subscribers_total' 2>/dev/null)

DB_SUBSCRIBERS=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/database" 2>/dev/null | jq -r '.newsletter_subscribers_total' 2>/dev/null)

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
    echo "5. Ensure GRAFANA_API_KEY_${ENVIRONMENT^^} is set correctly"
    exit 1
fi