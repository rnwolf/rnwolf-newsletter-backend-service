#!/bin/bash
# debug-grafana-panels.sh - Test individual panel queries

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

API_URL="https://api.rnwolf.net"
API_KEY="$GRAFANA_API_KEY_PRODUCTION"

if [[ -z "$API_KEY" ]]; then
    print_error "GRAFANA_API_KEY_PRODUCTION not set"
    exit 1
fi

echo "Testing Individual Panel Queries"
echo "================================"
echo "API URL: $API_URL"
echo ""

# Test each query that the Database Status panel should use
QUERIES=(
    "up"
    "database_status"
    "newsletter_subscribers_total"
    "newsletter_subscriptions_24h"
    "newsletter_unsubscribes_24h"
)

for query in "${QUERIES[@]}"; do
    print_status "Testing query: $query"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "$API_URL/metrics/api/v1/query?query=$query")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)

    if [[ $http_code == "200" ]]; then
        # Parse the response to see if we got data
        result_count=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    result = data.get('data', {}).get('result', [])
    print(len(result))
except:
    print('0')
" 2>/dev/null)

        if [[ $result_count -gt 0 ]]; then
            print_success "✓ Query '$query' returned $result_count result(s)"

            # Show the actual values
            echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    results = data.get('data', {}).get('result', [])
    for result in results:
        metric = result.get('metric', {})
        value = result.get('value', [None, 'unknown'])
        metric_name = metric.get('__name__', 'unknown')
        environment = metric.get('environment', 'unknown')
        print(f'    {metric_name}{{environment=\"{environment}\"}} = {value[1]}')
except Exception as e:
    print(f'    Error parsing result: {e}')
"
        else
            print_warning "⚠ Query '$query' returned 0 results"
            print_status "Response: $body"
        fi
    else
        print_error "✗ Query '$query' failed with HTTP $http_code"
        print_status "Response: $body"
    fi
    echo ""
done

print_status "Testing Prometheus range queries (for time series panels)..."
echo ""

# Test range queries (what time series panels use)
RANGE_QUERIES=(
    "up"
    "database_status"
    "newsletter_subscriptions_24h"
)

END_TIME=$(date +%s)
START_TIME=$((END_TIME - 3600))  # 1 hour ago

for query in "${RANGE_QUERIES[@]}"; do
    print_status "Testing range query: $query"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        "$API_URL/metrics/api/v1/query_range?query=$query&start=$START_TIME&end=$END_TIME&step=60")

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)

    if [[ $http_code == "200" ]]; then
        result_count=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    result = data.get('data', {}).get('result', [])
    print(len(result))
except:
    print('0')
" 2>/dev/null)

        if [[ $result_count -gt 0 ]]; then
            print_success "✓ Range query '$query' returned $result_count series"

            # Show sample data points
            echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    results = data.get('data', {}).get('result', [])
    for result in results:
        metric = result.get('metric', {})
        values = result.get('values', [])
        metric_name = metric.get('__name__', 'unknown')
        environment = metric.get('environment', 'unknown')
        print(f'    {metric_name}{{environment=\"{environment}\"}} has {len(values)} data points')
        if values:
            print(f'      Latest value: {values[-1][1]} at {values[-1][0]}')
except Exception as e:
    print(f'    Error parsing result: {e}')
"
        else
            print_warning "⚠ Range query '$query' returned 0 series"
        fi
    else
        print_error "✗ Range query '$query' failed with HTTP $http_code"
    fi
    echo ""
done

echo ""
print_status "If all queries work here but panels show 'No data', the issue is likely:"
echo "1. Dashboard panels using wrong datasource"
echo "2. Dashboard panels using wrong query syntax"
echo "3. Time range issues in the dashboard"
echo "4. Grafana datasource configuration issues"
echo ""
print_status "Next steps:"
echo "1. Check the Database Status panel configuration in Grafana"
echo "2. Verify it's using the correct datasource (Newsletter-API-Production)"
echo "3. Check the panel query matches what we tested here"
echo "4. Check the dashboard time range (try 'Last 1 hour' or 'Last 6 hours')"