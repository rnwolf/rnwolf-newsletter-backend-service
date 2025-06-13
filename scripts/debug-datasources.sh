#!/bin/bash
# debug-datasources.sh - Debug Grafana datasource configuration

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

GRAFANA_URL="https://throughputfocus.grafana.net"

echo "Debugging Grafana Datasources"
echo "============================="
echo "Grafana URL: $GRAFANA_URL"
echo ""

# Check environment variables
if [[ -z "$GRAFANA_API_KEY_STAGING" ]]; then
    print_warning "GRAFANA_API_KEY_STAGING not set"
fi

if [[ -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
    print_warning "GRAFANA_API_KEY_PRODUCTION not set"
fi

# Function to test datasource with any available key
test_with_key() {
    local api_key="$1"
    local key_name="$2"

    if [[ -z "$api_key" ]]; then
        print_warning "Skipping test with $key_name (not set)"
        return 1
    fi

    print_status "Testing with $key_name..."

    # List all datasources
    print_status "Listing all datasources..."
    local response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $api_key" \
        "$GRAFANA_URL/api/datasources")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    if [[ $http_code == "200" ]]; then
        print_success "Successfully retrieved datasources"
        echo ""
        echo "=== EXISTING DATASOURCES ==="
        echo "$body" | python3 -c "
import json, sys
try:
    datasources = json.load(sys.stdin)
    print(f'Found {len(datasources)} datasources:')
    for ds in datasources:
        name = ds.get('name', 'Unknown')
        type_name = ds.get('type', 'Unknown')
        url = ds.get('url', 'Unknown')
        uid = ds.get('uid', 'Unknown')
        is_default = ds.get('isDefault', False)
        print(f'  - Name: {name}')
        print(f'    Type: {type_name}')
        print(f'    URL: {url}')
        print(f'    UID: {uid}')
        print(f'    Default: {is_default}')
        print()
except Exception as e:
    print(f'Error parsing datasources: {e}')
"
        echo ""

        # Look for Newsletter-specific datasources
        print_status "Looking for Newsletter API datasources..."
        echo "$body" | python3 -c "
import json, sys
try:
    datasources = json.load(sys.stdin)
    newsletter_datasources = [ds for ds in datasources if 'newsletter' in ds.get('name', '').lower()]

    if newsletter_datasources:
        print(f'Found {len(newsletter_datasources)} Newsletter datasources:')
        for ds in newsletter_datasources:
            print(f'  - {ds[\"name\"]} -> {ds[\"url\"]}')
    else:
        print('No Newsletter datasources found!')
        print('Available datasources:')
        for ds in datasources:
            print(f'  - {ds[\"name\"]} ({ds[\"type\"]}) -> {ds[\"url\"]}')
except Exception as e:
    print(f'Error: {e}')
"
        return 0
    else
        print_error "Failed to retrieve datasources (HTTP $http_code)"
        print_status "Response: $body"
        return 1
    fi
}

# Test with staging key first, then production
if test_with_key "$GRAFANA_API_KEY_STAGING" "STAGING"; then
    echo ""
elif test_with_key "$GRAFANA_API_KEY_PRODUCTION" "PRODUCTION"; then
    echo ""
else
    print_error "No valid API keys found"
    exit 1
fi

# Test datasource connectivity
print_status "Testing Newsletter datasource connectivity..."

# Use any available key for testing
API_KEY="$GRAFANA_API_KEY_STAGING"
if [[ -z "$API_KEY" ]]; then
    API_KEY="$GRAFANA_API_KEY_PRODUCTION"
fi

if [[ -n "$API_KEY" ]]; then
    # Test staging datasource
    print_status "Testing staging datasource connectivity..."
    STAGING_TEST=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        -X POST "$GRAFANA_URL/api/datasources/proxy/uid/STAGING_UID/api/v1/query?query=up" 2>/dev/null || echo "failed")

    if echo "$STAGING_TEST" | grep -q "200"; then
        print_success "Staging datasource is reachable"
    else
        print_warning "Staging datasource test failed"
    fi

    # Test production datasource
    print_status "Testing production datasource connectivity..."
    PROD_TEST=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $API_KEY" \
        -X POST "$GRAFANA_URL/api/datasources/proxy/uid/PROD_UID/api/v1/query?query=up" 2>/dev/null || echo "failed")

    if echo "$PROD_TEST" | grep -q "200"; then
        print_success "Production datasource is reachable"
    else
        print_warning "Production datasource test failed"
    fi
fi

echo ""
print_status "Recommendations:"
echo "1. If no Newsletter datasources found, run: ./scripts/create-datasources.sh"
echo "2. If datasources exist but point to wrong URLs, recreate them"
echo "3. If datasources exist with correct URLs, test them in Grafana UI"
echo "4. Check that dashboard panels are using the correct datasource"