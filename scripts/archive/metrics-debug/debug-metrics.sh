#!/bin/bash
# debug-metrics.sh - Debug Grafana metrics issues

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Environment selection
ENVIRONMENT=${1:-production}
if [[ "$ENVIRONMENT" == "staging" ]]; then
    API_URL="https://api-staging.rnwolf.net"
    API_KEY="$GRAFANA_API_KEY_STAGING"
elif [[ "$ENVIRONMENT" == "production" ]]; then
    API_URL="https://api.rnwolf.net"
    API_KEY="$GRAFANA_API_KEY_PRODUCTION"
else
    print_error "Invalid environment. Use 'staging' or 'production'"
    exit 1
fi

echo "Debugging Metrics for $ENVIRONMENT Environment"
echo "=============================================="
echo "API URL: $API_URL"
echo ""

# Step 1: Test basic connectivity
print_status "Step 1: Testing basic API connectivity..."
if curl -s -f "$API_URL/health" > /dev/null; then
    print_success "API is reachable"
else
    print_error "API is not reachable"
    exit 1
fi

# Step 2: Test metrics endpoint authentication
print_status "Step 2: Testing metrics endpoint authentication..."
if [[ -z "$API_KEY" ]]; then
    print_error "API key not set for $ENVIRONMENT"
    print_status "Please set GRAFANA_API_KEY_${ENVIRONMENT^^}"
    exit 1
fi

METRICS_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics")

HTTP_CODE=$(echo "$METRICS_RESPONSE" | tail -n1)
BODY=$(echo "$METRICS_RESPONSE" | head -n -1)

case $HTTP_CODE in
    200)
        print_success "Metrics endpoint authentication successful"
        ;;
    401)
        print_error "Authentication failed (401)"
        print_status "Check that GRAFANA_API_KEY_${ENVIRONMENT^^} is correct"
        exit 1
        ;;
    403)
        print_error "Access forbidden (403)"
        print_status "API key may lack required permissions"
        exit 1
        ;;
    404)
        print_error "Metrics endpoint not found (404)"
        print_status "Check that metrics handler is deployed"
        exit 1
        ;;
    *)
        print_error "Unexpected HTTP response: $HTTP_CODE"
        echo "Response body: $BODY"
        exit 1
        ;;
esac

# Step 3: Analyze available metrics
print_status "Step 3: Analyzing available metrics..."
echo ""
echo "=== PROMETHEUS FORMAT METRICS ==="
if echo "$BODY" | grep -E "^[a-zA-Z_][a-zA-Z0-9_]*\{.*\}|^# TYPE" | head -20; then
    print_success "Found Prometheus format metrics"
else
    print_warning "No Prometheus format metrics found"
fi

echo ""
echo "=== SEARCHING FOR SPECIFIC METRICS ==="

# Check for newsletter-specific metrics
METRICS_FOUND=()
METRICS_MISSING=()

EXPECTED_METRICS=(
    "up"
    "newsletter_subscribers_total"
    "newsletter_subscribers_active"
    "newsletter_subscriptions_24h"
    "newsletter_unsubscribes_24h"
    "database_status"
)

for metric in "${EXPECTED_METRICS[@]}"; do
    if echo "$BODY" | grep -q "$metric"; then
        METRICS_FOUND+=("$metric")
        print_success "✓ Found: $metric"
    else
        METRICS_MISSING+=("$metric")
        print_warning "✗ Missing: $metric"
    fi
done

echo ""
print_status "Metrics Summary:"
print_success "Found: ${#METRICS_FOUND[@]} metrics"
print_warning "Missing: ${#METRICS_MISSING[@]} metrics"

# Step 4: Test JSON endpoint
print_status "Step 4: Testing JSON metrics endpoint..."
JSON_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/json")

JSON_HTTP_CODE=$(echo "$JSON_RESPONSE" | tail -n1)
JSON_BODY=$(echo "$JSON_RESPONSE" | head -n -1)

if [[ $JSON_HTTP_CODE == "200" ]]; then
    print_success "JSON endpoint accessible"
    echo ""
    echo "=== JSON METRICS SAMPLE ==="
    echo "$JSON_BODY" | python3 -m json.tool 2>/dev/null | head -30 || echo "$JSON_BODY" | head -30
else
    print_warning "JSON endpoint returned HTTP $JSON_HTTP_CODE"
fi

# Step 5: Test database connectivity
print_status "Step 5: Testing database metrics..."
DB_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/database")

DB_HTTP_CODE=$(echo "$DB_RESPONSE" | tail -n1)
DB_BODY=$(echo "$DB_RESPONSE" | head -n -1)

if [[ $DB_HTTP_CODE == "200" ]]; then
    print_success "Database metrics accessible"
    echo ""
    echo "=== DATABASE METRICS ==="
    echo "$DB_BODY" | python3 -m json.tool 2>/dev/null || echo "$DB_BODY"
else
    print_warning "Database metrics returned HTTP $DB_HTTP_CODE"
    echo "Response: $DB_BODY"
fi

# Step 6: Test Prometheus API compatibility
print_status "Step 6: Testing Prometheus API compatibility..."
PROM_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $API_KEY" \
    "$API_URL/metrics/api/v1/query?query=newsletter_subscribers_total")

PROM_HTTP_CODE=$(echo "$PROM_RESPONSE" | tail -n1)
PROM_BODY=$(echo "$PROM_RESPONSE" | head -n -1)

if [[ $PROM_HTTP_CODE == "200" ]]; then
    print_success "Prometheus API compatibility working"
    echo ""
    echo "=== PROMETHEUS API RESPONSE ==="
    echo "$PROM_BODY" | python3 -m json.tool 2>/dev/null || echo "$PROM_BODY"
else
    print_warning "Prometheus API returned HTTP $PROM_HTTP_CODE"
    echo "Response: $PROM_BODY"
fi

# Step 7: Generate sample data if database is empty
print_status "Step 7: Checking if database has data..."
if echo "$DB_BODY" | grep -q '"newsletter_subscribers_total": 0\|"newsletter_subscribers_total":0'; then
    print_warning "Database appears to be empty (0 subscribers)"
    echo ""
    print_status "To generate test data, you can:"
    echo "1. Add some test subscribers:"
    echo "   curl -X POST $API_URL/v1/newsletter/subscribe \\"
    echo "     -H 'Content-Type: application/json' \\"
    echo "     -H 'Origin: https://www.rnwolf.net' \\"
    echo "     -d '{\"email\":\"test@example.com\"}'"
    echo ""
    echo "2. Check the database:"
    echo "   npx wrangler d1 execute DB --env $ENVIRONMENT --remote --command=\"SELECT COUNT(*) FROM subscribers;\""
fi

echo ""
print_status "Debugging complete!"
echo ""
print_status "Next steps to fix 'No data' panels:"
echo "1. If metrics are missing, check your Worker deployment"
echo "2. If database is empty, add some test subscribers"
echo "3. Check Grafana datasource configuration"
echo "4. Verify panel queries match available metrics"