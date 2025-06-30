#!/bin/bash
# Debug script to understand grafana service account issues

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

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

GRAFANA_URL="https://throughputfocus.grafana.net"

echo "Debugging Grafana Service Accounts"
echo "=================================="
echo ""

# Check environment variables
if [[ -z "$GRAFANA_API_KEY_STAGING" ]]; then
    print_error "GRAFANA_API_KEY_STAGING not set"
    exit 1
fi

if [[ -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
    print_error "GRAFANA_API_KEY_PRODUCTION not set"
    exit 1
fi

API_KEY="$GRAFANA_API_KEY_STAGING"

# Function to make API calls with full debugging
debug_api_call() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local description="$4"

    print_status "$description"
    print_status "URL: $GRAFANA_URL$endpoint"
    print_status "Method: $method"

    if [[ -n "$data" ]]; then
        print_status "Data: $data"
    fi

    local cmd="curl -s -w \"\\n%{http_code}\" -X $method \"$GRAFANA_URL$endpoint\" -H \"Authorization: Bearer $API_KEY\""

    if [[ -n "$data" ]]; then
        cmd="$cmd -H \"Content-Type: application/json\" -d '$data'"
    fi

    print_status "Command: $cmd"
    echo ""

    local response=$(eval "$cmd")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    echo "HTTP Code: $http_code"
    echo "Response Body:"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
    echo ""
    echo "----------------------------------------"
    echo ""

    return 0
}

# 1. List all existing service accounts
print_status "1. Listing all service accounts..."
debug_api_call "GET" "/api/serviceaccounts/search" "" "Getting all service accounts"

# 2. Search for newsletter service accounts
print_status "2. Searching for newsletter service accounts..."
debug_api_call "GET" "/api/serviceaccounts/search?query=newsletter" "" "Searching newsletter service accounts"

# 3. Try to create a new service account (this should fail)
print_status "3. Trying to create staging service account..."
sa_data='{
    "name": "newsletter-backend-metrics-staging",
    "displayName": "Newsletter Backend Metrics (staging)",
    "role": "Admin"
}'
debug_api_call "POST" "/api/serviceaccounts" "$sa_data" "Creating staging service account"

# 4. Try to find existing service account by exact name
print_status "4. Searching for exact staging service account..."
debug_api_call "GET" "/api/serviceaccounts/search?query=newsletter-backend-metrics-staging" "" "Finding exact staging service account"

# 5. Get details of any existing service account (if we can find one)
print_status "5. Looking for any service account with 'staging' in name..."
search_response=$(curl -s -H "Authorization: Bearer $API_KEY" "$GRAFANA_URL/api/serviceaccounts/search?query=staging")

echo "Search response:"
echo "$search_response" | python3 -m json.tool 2>/dev/null || echo "$search_response"
echo ""

# Try to extract service account ID
sa_id=$(echo "$search_response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    service_accounts = data.get('serviceAccounts', [])
    for sa in service_accounts:
        name = sa.get('name', '')
        if 'staging' in name.lower():
            print(f'Found SA: {name} with ID: {sa.get(\"id\", \"\")}')
            print(sa.get('id', ''))
            break
except Exception as e:
    print(f'Error: {e}', file=sys.stderr)
" 2>/dev/null)

echo "Extracted SA ID: '$sa_id'"
echo ""

if [[ -n "$sa_id" ]]; then
    print_status "6. Getting tokens for service account ID: $sa_id"
    debug_api_call "GET" "/api/serviceaccounts/$sa_id/tokens" "" "Getting tokens for service account"
else
    print_error "Could not find service account ID"
fi

echo ""
print_status "Debug complete!"
echo ""
print_status "Summary of findings will help fix the main script."