#!/bin/bash
# Complete Grafana Reset and Rebuild Script
# This script will completely remove and recreate the Grafana integration

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

GRAFANA_URL="https://throughputfocus.grafana.net"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

print_step() {
    echo -e "${PURPLE}[STEP]${NC} $1"
}

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

print_banner() {
    echo -e "${CYAN}"
    echo "================================================================"
    echo "  Newsletter Grafana Integration - Complete Reset & Rebuild"
    echo "================================================================"
    echo -e "${NC}"
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --skip-cleanup    Skip the cleanup phase"
    echo "  --cleanup-only    Only run cleanup, don't rebuild"
    echo "  --dry-run         Show what would be done without actually doing it"
    echo "  --help           Show this help message"
    echo ""
    echo "Environment Variables Required:"
    echo "  GRAFANA_API_KEY_STAGING      - Admin token for staging"
    echo "  GRAFANA_API_KEY_PRODUCTION   - Admin token for production"
    echo ""
    echo "Examples:"
    echo "  $0                           # Full reset and rebuild"
    echo "  $0 --cleanup-only           # Only cleanup existing setup"
    echo "  $0 --skip-cleanup           # Only rebuild (assume clean state)"
    echo ""
}

# Parse command line arguments
SKIP_CLEANUP=false
CLEANUP_ONLY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-cleanup)
            SKIP_CLEANUP=true
            shift
            ;;
        --cleanup-only)
            CLEANUP_ONLY=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Function to execute command (with dry-run support)
execute_command() {
    local description="$1"
    local command="$2"

    if [[ "$DRY_RUN" == true ]]; then
        print_status "[DRY RUN] $description"
        print_status "Would execute: $command"
        return 0
    else
        print_status "$description"
        eval "$command"
    fi
}

# Function to make authenticated Grafana API calls
grafana_api_call() {
    local method="$1"
    local endpoint="$2"
    local api_key="$3"
    local data="$4"
    local description="$5"

    local cmd="curl -s -w \"\\n%{http_code}\" -X $method \"$GRAFANA_URL$endpoint\" -H \"Authorization: Bearer $api_key\""

    if [[ -n "$data" ]]; then
        cmd="$cmd -H \"Content-Type: application/json\" -d '$data'"
    fi

    if [[ "$DRY_RUN" == true ]]; then
        print_status "[DRY RUN] $description"
        print_status "Would call: $method $GRAFANA_URL$endpoint"
        return 0
    fi

    print_status "$description"
    local response=$(eval "$cmd")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200|201|204)
            print_success "✓ Success (HTTP $http_code)"
            echo "$body"
            ;;
        404)
            print_warning "⚠ Not found (HTTP $http_code) - may already be deleted"
            echo "$body"
            ;;
        *)
            print_error "✗ Failed (HTTP $http_code)"
            echo "$body"
            return 1
            ;;
    esac
}

# Function to check if API key has required permissions
check_api_permissions() {
    local api_key="$1"
    local env_name="$2"

    print_status "Checking permissions for $env_name API key..."

    local response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $api_key" \
        "$GRAFANA_URL/api/user")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            local login=$(echo "$body" | grep -o '"login":"[^"]*"' | cut -d'"' -f4)
            local role=$(echo "$body" | grep -o '"orgRole":"[^"]*"' | cut -d'"' -f4)

            print_success "✓ $env_name token authenticated as: $login (role: $role)"

            # Check if it's a service account or admin
            if [[ "$login" =~ ^sa- ]] || [[ "$role" == "Admin" ]]; then
                print_success "✓ $env_name token has sufficient permissions"
                return 0
            else
                print_error "✗ $env_name token lacks admin permissions (role: $role)"
                return 1
            fi
            ;;
        401)
            print_error "✗ $env_name token authentication failed"
            return 1
            ;;
        403)
            print_error "✗ $env_name token access denied"
            return 1
            ;;
        *)
            print_error "✗ $env_name token check failed (HTTP $http_code)"
            return 1
            ;;
    esac
}

# Function to delete all newsletter datasources
cleanup_datasources() {
    local api_key="$1"
    local env_name="$2"

    print_step "Cleaning up $env_name datasources..."

    # Get all datasources
    local datasources_response=$(grafana_api_call "GET" "/api/datasources" "$api_key" "" "Getting all datasources")
    if [[ $? -ne 0 ]]; then
        print_error "Failed to get datasources for $env_name"
        return 1
    fi

    # Find and delete newsletter-related datasources
    local newsletter_datasources=$(echo "$datasources_response" | grep -o '"uid":"[^"]*"[^}]*"name":"[^"]*Newsletter[^"]*"' || true)

    if [[ -n "$newsletter_datasources" ]]; then
        echo "$newsletter_datasources" | while read -r line; do
            local uid=$(echo "$line" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)
            local name=$(echo "$line" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)

            if [[ -n "$uid" && -n "$name" ]]; then
                grafana_api_call "DELETE" "/api/datasources/uid/$uid" "$api_key" "" "Deleting datasource: $name"
            fi
        done
    else
        print_status "No newsletter datasources found for $env_name"
    fi
}

# Function to delete all newsletter dashboards
cleanup_dashboards() {
    local api_key="$1"
    local env_name="$2"

    print_step "Cleaning up $env_name dashboards..."

    # Search for newsletter dashboards
    local search_response=$(grafana_api_call "GET" "/api/search?query=newsletter&type=dash-db" "$api_key" "" "Searching for newsletter dashboards")
    if [[ $? -ne 0 ]]; then
        print_error "Failed to search dashboards for $env_name"
        return 1
    fi

    # Parse and delete each dashboard
    local dashboard_uids=$(echo "$search_response" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4 || true)

    if [[ -n "$dashboard_uids" ]]; then
        echo "$dashboard_uids" | while read -r uid; do
            if [[ -n "$uid" ]]; then
                grafana_api_call "DELETE" "/api/dashboards/uid/$uid" "$api_key" "" "Deleting dashboard with UID: $uid"
            fi
        done
    else
        print_status "No newsletter dashboards found for $env_name"
    fi
}

# Function to delete service accounts (optional - be careful!)
cleanup_service_accounts() {
    local api_key="$1"
    local env_name="$2"

    print_step "Cleaning up $env_name service accounts..."

    # Search for newsletter service accounts
    local sa_response=$(grafana_api_call "GET" "/api/serviceaccounts/search?query=newsletter" "$api_key" "" "Searching for newsletter service accounts")
    if [[ $? -ne 0 ]]; then
        print_warning "Could not search for service accounts"
        return 0
    fi

    # Parse and delete each service account
    local sa_data=$(echo "$sa_response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    service_accounts = data.get('serviceAccounts', [])
    for sa in service_accounts:
        name = sa.get('name', '').lower()
        if 'newsletter' in name:
            print(f\"{sa.get('id', '')},{sa.get('name', '')}\")
except:
    pass
" 2>/dev/null)

    if [[ -n "$sa_data" ]]; then
        echo "$sa_data" | while IFS=',' read -r sa_id sa_name; do
            if [[ -n "$sa_id" && -n "$sa_name" ]]; then
                grafana_api_call "DELETE" "/api/serviceaccounts/$sa_id" "$api_key" "" "Deleting service account: $sa_name"
            fi
        done
    else
        print_status "No newsletter service accounts found for cleanup"
    fi
}

# Function to create new service account or use existing one
create_service_account() {
    local admin_api_key="$1"
    local env_name="$2"

    print_step "Creating or finding service account for $env_name..."

    local sa_name="newsletter-backend-metrics-$env_name"

    # First, search for existing service account using the exact same approach as debug script
    print_status "Searching for existing service account: $sa_name"

    local search_response=$(curl -s -H "Authorization: Bearer $admin_api_key" \
        "$GRAFANA_URL/api/serviceaccounts/search?query=$sa_name")

    if [[ $? -ne 0 ]]; then
        print_error "Failed to search for service accounts"
        return 1
    fi

    # Extract service account ID using the same method that worked in debug
    local sa_id=$(echo "$search_response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    service_accounts = data.get('serviceAccounts', [])
    for sa in service_accounts:
        if sa.get('name') == '$sa_name':
            print(str(sa.get('id', '')))
            break
except Exception:
    pass
" 2>/dev/null)

    # Clean up the extracted ID
    sa_id=$(echo "$sa_id" | tr -d '[:space:]' | head -n1)

    if [[ -n "$sa_id" && "$sa_id" =~ ^[0-9]+$ ]]; then
        print_success "✓ Found existing service account '$sa_name' with ID: $sa_id"
    else
        print_status "Service account '$sa_name' not found, trying to create new one..."

        # Try to create new service account
        local sa_data='{
            "name": "'$sa_name'",
            "displayName": "Newsletter Backend Metrics ('$env_name')",
            "role": "Admin"
        }'

        local create_response=$(curl -s -w "\n%{http_code}" \
            -X POST "$GRAFANA_URL/api/serviceaccounts" \
            -H "Authorization: Bearer $admin_api_key" \
            -H "Content-Type: application/json" \
            -d "$sa_data")

        local create_code=$(echo "$create_response" | tail -n1)
        local create_body=$(echo "$create_response" | head -n -1)

        if [[ $create_code == "200" || $create_code == "201" ]]; then
            sa_id=$(echo "$create_body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(str(data.get('id', '')))
except Exception:
    pass
" 2>/dev/null | tr -d '[:space:]' | head -n1)

            if [[ -n "$sa_id" && "$sa_id" =~ ^[0-9]+$ ]]; then
                print_success "✓ Created new service account with ID: $sa_id"
            else
                print_error "Could not extract service account ID from creation response"
                print_status "Response: $create_body"
                return 1
            fi
        elif [[ $create_code == "400" ]] && echo "$create_body" | grep -q "already exists"; then
            # Service account exists but our search didn't find it - try a broader search
            print_warning "Service account exists but wasn't found in search, trying broader search..."

            local broad_search=$(curl -s -H "Authorization: Bearer $admin_api_key" \
                "$GRAFANA_URL/api/serviceaccounts/search?query=newsletter")

            sa_id=$(echo "$broad_search" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    service_accounts = data.get('serviceAccounts', [])
    for sa in service_accounts:
        if sa.get('name') == '$sa_name':
            print(str(sa.get('id', '')))
            break
except Exception:
    pass
" 2>/dev/null | tr -d '[:space:]' | head -n1)

            if [[ -n "$sa_id" && "$sa_id" =~ ^[0-9]+$ ]]; then
                print_success "✓ Found existing service account with broader search, ID: $sa_id"
            else
                print_error "Could not find service account even with broader search"
                return 1
            fi
        else
            print_error "Failed to create service account (HTTP $create_code)"
            print_status "Response: $create_body"
            return 1
        fi
    fi

    # At this point we should have a valid sa_id
    if [[ -z "$sa_id" || ! "$sa_id" =~ ^[0-9]+$ ]]; then
        print_error "Invalid service account ID: '$sa_id'"
        return 1
    fi

    print_status "Working with service account ID: $sa_id"

    # Delete existing tokens for this service account
    print_status "Managing tokens for service account..."
    local tokens_response=$(curl -s -H "Authorization: Bearer $admin_api_key" \
        "$GRAFANA_URL/api/serviceaccounts/$sa_id/tokens")

    if [[ $? -eq 0 ]]; then
        # Parse and delete existing tokens
        echo "$tokens_response" | python3 -c "
import json, sys
try:
    tokens = json.load(sys.stdin)
    for token in tokens:
        token_id = token.get('id', '')
        if token_id:
            print(str(token_id))
except Exception:
    pass
" 2>/dev/null | while read -r token_id; do
            if [[ -n "$token_id" && "$token_id" =~ ^[0-9]+$ ]]; then
                print_status "Deleting existing token: $token_id"
                curl -s -X DELETE \
                    -H "Authorization: Bearer $admin_api_key" \
                    "$GRAFANA_URL/api/serviceaccounts/$sa_id/tokens/$token_id" > /dev/null
            fi
        done
    fi

    # Create new token for the service account
    local timestamp=$(date +%Y%m%d-%H%M%S)
    local token_data='{
        "name": "newsletter-'$env_name'-token-'$timestamp'"
    }'

    print_status "Creating new token for service account..."
    local token_response=$(curl -s -w "\n%{http_code}" \
        -X POST "$GRAFANA_URL/api/serviceaccounts/$sa_id/tokens" \
        -H "Authorization: Bearer $admin_api_key" \
        -H "Content-Type: application/json" \
        -d "$token_data")

    local token_code=$(echo "$token_response" | tail -n1)
    local token_body=$(echo "$token_response" | head -n -1)

    if [[ $token_code != "200" ]]; then
        print_error "Failed to create token (HTTP $token_code)"
        print_status "Response: $token_body"
        return 1
    fi

    # Parse the token from the response
    local new_token=$(echo "$token_body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    key = data.get('key', '')
    if key:
        print(key)
except Exception:
    pass
" 2>/dev/null | head -n1)

    if [[ -z "$new_token" || ${#new_token} -lt 20 ]]; then
        print_error "Could not extract valid token for $env_name"
        print_status "Token response: $token_body"
        return 1
    fi

    print_success "✓ Created new API token for $env_name"
    print_warning "⚠ IMPORTANT: Save this token for $env_name environment:"
    echo ""
    echo -e "${CYAN}GRAFANA_API_KEY_${env_name^^}=$new_token${NC}"
    echo ""

    # Store in temporary file for later use
    local token_file="$PROJECT_DIR/.grafana-tokens-new-$(date +%Y%m%d-%H%M%S).env"
    echo "GRAFANA_API_KEY_${env_name^^}=$new_token" >> "$token_file"

    # Store the token in a variable for later use in the script
    if [[ "$env_name" == "staging" ]]; then
        STAGING_NEW_TOKEN="$new_token"
    elif [[ "$env_name" == "production" ]]; then
        PRODUCTION_NEW_TOKEN="$new_token"
    fi

    return 0
}

# Function to create datasource
create_datasource() {
    local api_key="$1"
    local env_name="$2"
    local api_url="$3"

    print_step "Creating datasource for $env_name..."

    local is_default="false"
    if [[ "$env_name" == "production" ]]; then
        is_default="true"
    fi

    # Fix the datasource name formatting
    local capitalized_env_name=""
    case $env_name in
        staging)
            capitalized_env_name="Staging"
            ;;
        production)
            capitalized_env_name="Production"
            ;;
        *)
            capitalized_env_name="${env_name^}"
            ;;
    esac

    local ds_data='{
        "name": "Newsletter-API-'$capitalized_env_name'",
        "type": "prometheus",
        "access": "proxy",
        "url": "'$api_url'/metrics",
        "isDefault": '$is_default',
        "jsonData": {
            "timeInterval": "30s",
            "httpMethod": "GET",
            "httpHeaderName1": "Authorization"
        },
        "secureJsonData": {
            "httpHeaderValue1": "Bearer '$api_key'"
        },
        "editable": true
    }'

    local ds_response=$(grafana_api_call "POST" "/api/datasources" "$api_key" "$ds_data" "Creating $env_name datasource")
    if [[ $? -ne 0 ]]; then
        print_error "Failed to create datasource for $env_name"
        return 1
    fi

    local ds_id=$(echo "$ds_response" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('id', ''))
except:
    pass
" 2>/dev/null)

    if [[ -n "$ds_id" ]]; then
        print_success "✓ Created datasource for $env_name with ID: $ds_id"
    else
        print_success "✓ Created datasource for $env_name"
    fi

    return 0
}

# Function to test datasource connectivity
test_datasource() {
    local api_key="$1"
    local env_name="$2"
    local api_url="$3"

    print_step "Testing $env_name datasource connectivity..."

    # The API endpoint should already be tested by wait_and_test_api
    # So we just need to test Grafana datasource functionality
    print_status "Testing Grafana datasource connection for $env_name..."

    # Find the datasource UID
    local datasources_response=$(grafana_api_call "GET" "/api/datasources" "$api_key" "" "Getting datasources")
    if [[ $? -ne 0 ]]; then
        print_warning "⚠ Could not retrieve datasources for testing"
        return 1
    fi

    local ds_uid=$(echo "$datasources_response" | grep -B5 -A5 "Newsletter-API-${env_name^}" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)

    if [[ -n "$ds_uid" ]]; then
        print_success "✓ Found datasource UID: $ds_uid"
        # We could test the datasource further here, but the API test is more reliable
        return 0
    else
        print_warning "⚠ Could not find datasource UID for $env_name (this may be normal)"
        return 0  # Don't fail the whole process for this
    fi
}

# Function to create dashboard
create_dashboard() {
    local api_key="$1"
    local env_name="$2"

    print_step "Creating dashboard for $env_name..."

    local dashboard_file="$PROJECT_DIR/grafana/grafana-dashboard-config_${env_name}.json"

    if [[ ! -f "$dashboard_file" ]]; then
        print_error "Dashboard configuration file not found: $dashboard_file"
        return 1
    fi

    # Replace API key placeholder in dashboard config
    local temp_dashboard="/tmp/dashboard_${env_name}_$(date +%s).json"
    sed "s/glsa_YOUR_${env_name^^}_TOKEN_HERE/$api_key/g" "$dashboard_file" > "$temp_dashboard"

    # Validate JSON
    if ! python3 -m json.tool "$temp_dashboard" > /dev/null 2>&1; then
        print_error "Generated dashboard JSON is invalid for $env_name"
        rm -f "$temp_dashboard"
        return 1
    fi

    # Create dashboard
    local dashboard_data=$(cat "$temp_dashboard")
    local dashboard_response=$(grafana_api_call "POST" "/api/dashboards/db" "$api_key" "$dashboard_data" "Creating $env_name dashboard")

    rm -f "$temp_dashboard"

    if [[ $? -ne 0 ]]; then
        print_error "Failed to create dashboard for $env_name"
        return 1
    fi

    local dashboard_url=$(echo "$dashboard_response" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)

    if [[ -n "$dashboard_url" ]]; then
        print_success "✓ Created dashboard for $env_name"
        print_status "Dashboard URL: $GRAFANA_URL$dashboard_url"
    else
        print_success "✓ Created dashboard for $env_name (URL not extracted)"
    fi

    return 0
}

# Function to validate complete setup
validate_setup() {
    local env_name="$1"
    local api_key="$2"
    local api_url="$3"

    print_step "Validating complete setup for $env_name..."

    # Check datasource exists
    local datasources_response=$(grafana_api_call "GET" "/api/datasources" "$api_key" "" "Checking datasources")
    if [[ $? -eq 0 ]] && echo "$datasources_response" | grep -q "Newsletter-API-${env_name^}"; then
        print_success "✓ Datasource exists"
    else
        print_error "✗ Datasource not found"
        return 1
    fi

    # Check dashboard exists
    local search_response=$(grafana_api_call "GET" "/api/search?query=newsletter&type=dash-db" "$api_key" "" "Checking dashboards")
    if [[ $? -eq 0 ]] && echo "$search_response" | grep -q "$env_name"; then
        print_success "✓ Dashboard exists"
    else
        print_error "✗ Dashboard not found"
        return 1
    fi

    # API connectivity was already tested by wait_and_test_api
    print_success "✓ API connectivity confirmed"

    # Test Prometheus API compatibility
    print_status "Testing Prometheus API compatibility for $env_name..."
    local prom_response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $api_key" \
        "$api_url/metrics/api/v1/query?query=up" \
        --max-time 10)

    local prom_code=$(echo "$prom_response" | tail -n1)
    if [[ $prom_code == "200" ]]; then
        print_success "✓ Prometheus API compatibility working"
    else
        print_warning "⚠ Prometheus API test failed (HTTP $prom_code) - dashboard may still work"
    fi

    print_success "✓ Setup validation completed for $env_name"
    return 0
}

# Function to update Cloudflare secrets
update_cloudflare_secrets() {
    local env_name="$1"
    local api_key="$2"

    print_step "Updating Cloudflare secret for $env_name..."

    if [[ "$DRY_RUN" == true ]]; then
        print_status "[DRY RUN] Would update GRAFANA_API_KEY secret for $env_name"
        return 0
    fi

    echo "$api_key" | npx wrangler secret put GRAFANA_API_KEY --env "$env_name"

    if [[ $? -eq 0 ]]; then
        print_success "✓ Updated Cloudflare secret for $env_name"
    else
        print_error "✗ Failed to update Cloudflare secret for $env_name"
        return 1
    fi
}

# Function to wait for secrets to propagate and test API
wait_and_test_api() {
    local env_name="$1"
    local api_url="$2"
    local api_key="$3"
    local max_attempts="${4:-6}"

    print_step "Waiting for $env_name secrets to propagate and testing API..."

    if [[ "$DRY_RUN" == true ]]; then
        print_status "[DRY RUN] Would wait and test API for $env_name"
        return 0
    fi

    local attempt=1
    while [[ $attempt -le $max_attempts ]]; do
        print_status "Attempt $attempt/$max_attempts: Testing $env_name API endpoint..."

        local response=$(curl -s -w "\n%{http_code}" \
            -H "Authorization: Bearer $api_key" \
            "$api_url/metrics" \
            --max-time 10 \
            --connect-timeout 5)

        local http_code=$(echo "$response" | tail -n1)

        case $http_code in
            200)
                print_success "✓ $env_name API endpoint is accessible"

                local body=$(echo "$response" | head -n -1)
                if echo "$body" | grep -q "newsletter_subscribers_total"; then
                    print_success "✓ Newsletter metrics are being generated for $env_name"
                else
                    print_warning "⚠ Newsletter metrics not found in $env_name response (may be normal for new deployments)"
                fi
                return 0
                ;;
            401)
                if [[ $attempt -lt $max_attempts ]]; then
                    print_warning "⚠ $env_name API authentication failed (attempt $attempt/$max_attempts) - waiting for secret propagation..."
                    sleep 10
                else
                    print_error "✗ $env_name API authentication failed after $max_attempts attempts"
                    return 1
                fi
                ;;
            000)
                if [[ $attempt -lt $max_attempts ]]; then
                    print_warning "⚠ $env_name API connection failed (attempt $attempt/$max_attempts) - retrying..."
                    sleep 5
                else
                    print_error "✗ $env_name API connection failed after $max_attempts attempts"
                    return 1
                fi
                ;;
            *)
                print_error "✗ $env_name API test failed with HTTP $http_code"
                local body=$(echo "$response" | head -n -1)
                print_status "Response preview: $(echo "$body" | head -c 200)..."
                return 1
                ;;
        esac

        ((attempt++))
    done

    return 1
}

# Function to check prerequisites
check_prerequisites() {
    print_step "Checking prerequisites..."

    # Check required tools
    local tools=("curl" "python3" "npx")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            print_error "Required tool not found: $tool"
            return 1
        fi
    done

    # Check wrangler
    if ! npx wrangler --version &> /dev/null; then
        print_error "Wrangler CLI not available"
        return 1
    fi

    # Check project structure
    if [[ ! -f "$PROJECT_DIR/wrangler.jsonc" ]]; then
        print_error "wrangler.jsonc not found in project root"
        return 1
    fi

    if [[ ! -d "$PROJECT_DIR/grafana" ]]; then
        print_error "grafana/ directory not found"
        return 1
    fi

    print_success "✓ Prerequisites check passed"
    return 0
}

# Main cleanup function
run_cleanup() {
    print_step "Starting cleanup phase..."

    # Use any available admin token for cleanup
    local cleanup_token=""
    if [[ -n "$GRAFANA_API_KEY_STAGING" ]]; then
        cleanup_token="$GRAFANA_API_KEY_STAGING"
        print_status "Using staging token for cleanup"
    elif [[ -n "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        cleanup_token="$GRAFANA_API_KEY_PRODUCTION"
        print_status "Using production token for cleanup"
    else
        print_error "No admin API token available for cleanup"
        print_status "Please set GRAFANA_API_KEY_STAGING or GRAFANA_API_KEY_PRODUCTION"
        return 1
    fi

    # Cleanup all environments using admin token
    cleanup_dashboards "$cleanup_token" "all"
    cleanup_datasources "$cleanup_token" "all"

    # Cleanup service accounts if nuclear mode
    if [[ "$NUCLEAR_MODE" == true ]]; then
        print_warning "🚨 NUCLEAR MODE: Deleting service accounts too!"
        cleanup_service_accounts "$cleanup_token" "all"
    else
        print_status "Service accounts preserved (use --nuclear to delete them too)"
    fi

    print_success "✓ Cleanup phase completed"
}

# Main setup function
run_setup() {
    print_step "Starting setup phase..."

    # Initialize token variables
    STAGING_NEW_TOKEN=""
    PRODUCTION_NEW_TOKEN=""

    # Create new service accounts and tokens
    if [[ -n "$GRAFANA_API_KEY_STAGING" ]] || [[ -n "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        local admin_token="${GRAFANA_API_KEY_STAGING:-$GRAFANA_API_KEY_PRODUCTION}"

        print_status "Creating new service accounts and tokens..."

        # Create staging service account and token
        if create_service_account "$admin_token" "staging"; then
            print_success "✓ Staging service account and token ready"
        else
            print_error "✗ Failed to set up staging service account"
            return 1
        fi

        # Create production service account and token
        if create_service_account "$admin_token" "production"; then
            print_success "✓ Production service account and token ready"
        else
            print_error "✗ Failed to set up production service account"
            return 1
        fi
    else
        print_error "No admin API tokens available for setup"
        print_status "Please provide GRAFANA_API_KEY_STAGING or GRAFANA_API_KEY_PRODUCTION"
        return 1
    fi

    # Update Cloudflare secrets and test APIs
    if [[ -n "$STAGING_NEW_TOKEN" ]]; then
        print_step "Setting up staging environment..."

        # Update Cloudflare secret
        update_cloudflare_secrets "staging" "$STAGING_NEW_TOKEN"

        # Wait for secret to propagate and test API
        wait_and_test_api "staging" "https://api-staging.rnwolf.net" "$STAGING_NEW_TOKEN"

        # Create Grafana resources
        create_datasource "$STAGING_NEW_TOKEN" "staging" "https://api-staging.rnwolf.net"
        test_datasource "$STAGING_NEW_TOKEN" "staging" "https://api-staging.rnwolf.net"
        create_dashboard "$STAGING_NEW_TOKEN" "staging"
        validate_setup "staging" "$STAGING_NEW_TOKEN" "https://api-staging.rnwolf.net"
    fi

    if [[ -n "$PRODUCTION_NEW_TOKEN" ]]; then
        print_step "Setting up production environment..."

        # Update Cloudflare secret
        update_cloudflare_secrets "production" "$PRODUCTION_NEW_TOKEN"

        # Wait for secret to propagate and test API
        wait_and_test_api "production" "https://api.rnwolf.net" "$PRODUCTION_NEW_TOKEN"

        # Create Grafana resources
        create_datasource "$PRODUCTION_NEW_TOKEN" "production" "https://api.rnwolf.net"
        test_datasource "$PRODUCTION_NEW_TOKEN" "production" "https://api.rnwolf.net"
        create_dashboard "$PRODUCTION_NEW_TOKEN" "production"
        validate_setup "production" "$PRODUCTION_NEW_TOKEN" "https://api.rnwolf.net"
    fi

    print_success "✓ Setup phase completed"

    # Show the tokens for user reference
    if [[ -n "$STAGING_NEW_TOKEN" || -n "$PRODUCTION_NEW_TOKEN" ]]; then
        print_step "New API Tokens (save these!):"

        if [[ -n "$STAGING_NEW_TOKEN" ]]; then
            print_warning "GRAFANA_API_KEY_STAGING=$STAGING_NEW_TOKEN"
        fi

        if [[ -n "$PRODUCTION_NEW_TOKEN" ]]; then
            print_warning "GRAFANA_API_KEY_PRODUCTION=$PRODUCTION_NEW_TOKEN"
        fi

        echo ""
        print_warning "⚠ Update your environment variables with these new tokens!"
        echo ""
    fi
}

# Main function
main() {
    print_banner

    # Check prerequisites first
    if ! check_prerequisites; then
        exit 1
    fi

    # Check environment variables
    if [[ -z "$GRAFANA_API_KEY_STAGING" && -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        print_error "No Grafana API tokens provided"
        print_status "Please set at least one of:"
        print_status "  GRAFANA_API_KEY_STAGING"
        print_status "  GRAFANA_API_KEY_PRODUCTION"
        exit 1
    fi

    # Check permissions
    local permission_errors=0

    if [[ -n "$GRAFANA_API_KEY_STAGING" ]]; then
        if ! check_api_permissions "$GRAFANA_API_KEY_STAGING" "staging"; then
            ((permission_errors++))
        fi
    fi

    if [[ -n "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        if ! check_api_permissions "$GRAFANA_API_KEY_PRODUCTION" "production"; then
            ((permission_errors++))
        fi
    fi

    if [[ $permission_errors -gt 0 ]]; then
        print_error "API token permission errors detected"
        print_status "Please ensure your tokens have Admin role or are proper service accounts"
        exit 1
    fi

    # Run cleanup phase
    if [[ "$SKIP_CLEANUP" != true ]]; then
        run_cleanup

        # Add option to clean up service accounts
        if [[ "$CLEANUP_ONLY" == true ]]; then
            print_warning "⚠ Cleanup-only mode selected"
            print_status "To also clean up service accounts, run with --nuclear option"
            print_success "Cleanup completed successfully!"
            exit 0
        fi
    fi

    # Run setup phase
    run_setup

    # Final summary
    print_step "Setup Summary:"
    print_success "✓ Grafana integration has been completely reset and rebuilt"
    print_status "Grafana URL: $GRAFANA_URL"
    print_status "Check your dashboards at: $GRAFANA_URL/dashboards"

    # Show token file location and final instructions
    local token_file=$(ls "$PROJECT_DIR/.grafana-tokens-"* 2>/dev/null | tail -n1)
    if [[ -f "$token_file" ]]; then
        print_warning "⚠ New API tokens saved to: $token_file"
        print_warning "⚠ IMPORTANT: Update your environment variables with the new tokens shown above"
        print_status "⚠ You can safely delete the token file after updating your environment"
        echo ""
        print_status "To update your environment, run:"
        echo ""
        if grep -q "GRAFANA_API_KEY_STAGING" "$token_file"; then
            local staging_token=$(grep "GRAFANA_API_KEY_STAGING" "$token_file" | cut -d'=' -f2)
            echo "export GRAFANA_API_KEY_STAGING=\"$staging_token\""
        fi
        if grep -q "GRAFANA_API_KEY_PRODUCTION" "$token_file"; then
            local production_token=$(grep "GRAFANA_API_KEY_PRODUCTION" "$token_file" | cut -d'=' -f2)
            echo "export GRAFANA_API_KEY_PRODUCTION=\"$production_token\""
        fi
        echo ""
    fi

    echo ""
    print_success "🎉 Grafana integration reset and rebuild completed successfully!"
    echo ""
    print_status "Next steps:"
    print_status "1. Update your environment variables with the new tokens (shown above)"
    print_status "2. Visit $GRAFANA_URL/dashboards to view your dashboards"
    print_status "3. Run validation: ./scripts/grafana-validation-testing.sh"
    print_status "4. Delete the token backup file: rm $token_file"
}

# Run main function
main "$@"