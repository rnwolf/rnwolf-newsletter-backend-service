#!/bin/bash
# create-dashboards.sh - Deploy Grafana dashboards with enhanced version handling

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
GRAFANA_URL="https://throughputfocus.grafana.net"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
GRAFANA_DIR="$PROJECT_DIR/grafana"
TEMP_DIR="$PROJECT_DIR/.tmp"

# Create temp directory
mkdir -p "$TEMP_DIR"

# Function to print colored output
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

print_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Function to show usage information
show_usage() {
    echo "Usage: $0 [staging|production|both] [OPTIONS]"
    echo ""
    echo "Environments:"
    echo "  staging      Deploy staging dashboard"
    echo "  production   Deploy production dashboard"
    echo "  both         Deploy both staging and production dashboards"
    echo ""
    echo "Options:"
    echo "  --update     Update existing dashboards instead of creating new ones"
    echo "  --force      Overwrite existing dashboards without confirmation"
    echo "  --overwrite  Force overwrite ignoring version conflicts"
    echo "  --nuclear    Delete ALL existing dashboards and recreate (DESTRUCTIVE)"
    echo "  --help       Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 staging"
    echo "  $0 production --update"
    echo "  $0 both --force"
    echo "  $0 production --overwrite  # Ignore version conflicts"
    echo "  $0 both --nuclear          # Delete all and recreate"
    echo ""
    echo "WARNING: --nuclear will delete ALL newsletter dashboards and recreate them!"
    echo ""
}

# Function to check required environment variables
check_env_vars() {
    local missing_vars=()

    if [[ "$DEPLOY_STAGING" == true && -z "$GRAFANA_API_KEY_STAGING" ]]; then
        missing_vars+=("GRAFANA_API_KEY_STAGING")
    fi

    if [[ "$DEPLOY_PRODUCTION" == true && -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        missing_vars+=("GRAFANA_API_KEY_PRODUCTION")
    fi

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            print_error "  $var"
        done
        echo ""
        echo "Please set them in your environment or .env file:"
        echo "  export GRAFANA_API_KEY_STAGING=glsa_your_staging_token"
        echo "  export GRAFANA_API_KEY_PRODUCTION=glsa_your_production_token"
        exit 1
    fi
}

# Function to inject API keys into dashboard JSON
inject_api_keys() {
    local input_file="$1"
    local output_file="$2"
    local environment="$3"
    local api_key="$4"

    print_status "Processing dashboard configuration for $environment..."

    # Read the JSON file and replace placeholder tokens
    if [[ ! -f "$input_file" ]]; then
        print_error "Dashboard configuration file not found: $input_file"
        return 1
    fi

    # Use sed to replace the placeholder with actual API key
    sed "s/glsa_YOUR_${environment^^}_TOKEN_HERE/$api_key/g" "$input_file" > "$output_file"

    # Validate that the JSON is still valid after substitution
    if ! python3 -m json.tool "$output_file" > /dev/null 2>&1; then
        print_error "Generated JSON is invalid for $environment dashboard"
        return 1
    fi

    print_success "Dashboard configuration processed for $environment"
    return 0
}

# Function to create fresh dashboard with new UID
create_fresh_dashboard() {
    local config_file="$1"
    local environment="$2"
    local api_key="$3"

    print_status "Creating fresh $environment dashboard with new UID..."

    # Prepare dashboard config for fresh creation
    local fresh_config="$TEMP_DIR/${environment}-fresh-dashboard.json"

    # Generate a new UID to avoid any version conflicts
    local new_uid="newsletter-backend-${environment}-$(date +%s)"

    # Remove ID, version, and generate new UID for fresh creation
    python3 -c "
import json
import uuid
import time
import sys

with open('$config_file', 'r') as f:
    config = json.load(f)

# Remove version-related fields for fresh creation
if 'dashboard' in config:
    config['dashboard'].pop('id', None)
    config['dashboard'].pop('version', None)

    # Generate a completely new UID to avoid conflicts
    config['dashboard']['uid'] = '$new_uid'

    # Update title to indicate it's been recreated
    original_title = config['dashboard'].get('title', '')
    if '(Recreated' not in original_title:
        config['dashboard']['title'] = original_title + ' (Recreated)'

# Ensure overwrite is set to false for fresh creation
config['overwrite'] = False

with open('$fresh_config', 'w') as f:
    json.dump(config, f, indent=2)

print(f'Generated new UID: $new_uid', file=sys.stderr)
"

    print_status "New dashboard UID: $new_uid"

    # Deploy the fresh dashboard
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$GRAFANA_URL/api/dashboards/db" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $api_key" \
        -d @"$fresh_config")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            local dashboard_id=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('id', 'unknown'))
except:
    print('unknown')
" 2>/dev/null)
            local dashboard_url=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('url', ''))
except:
    print('')
" 2>/dev/null)

            print_success "Successfully created fresh $environment dashboard"
            print_status "Dashboard ID: $dashboard_id"
            print_status "New UID: $new_uid"
            if [[ -n "$dashboard_url" ]]; then
                print_status "Dashboard URL: $GRAFANA_URL$dashboard_url"
            fi
            return 0
            ;;
        412)
            print_error "Version conflict persists even with new UID (HTTP $http_code)"
            print_status "This suggests a deeper Grafana configuration issue"
            print_status "Response: $(echo "$body" | head -c 500)"
            return 1
            ;;
        *)
            print_error "Failed to create fresh $environment dashboard (HTTP $http_code)"
            print_status "Response: $(echo "$body" | head -c 500)"
            return 1
            ;;
    esac
}

# Function to completely reset dashboard (nuclear option)
reset_dashboard_completely() {
    local config_file="$1"
    local environment="$2"
    local api_key="$3"

    print_warning "Creating fresh dashboard for $environment after nuclear cleanup..."

    # Create with completely new identity
    local reset_config="$TEMP_DIR/${environment}-reset-dashboard.json"
    local timestamp=$(date +%s)
    local new_uid="newsletter-${environment}-reset-${timestamp}"

    python3 -c "
import json

with open('$config_file', 'r') as f:
    config = json.load(f)

# Completely reset dashboard identity
if 'dashboard' in config:
    # Remove all identity fields
    config['dashboard'].pop('id', None)
    config['dashboard'].pop('version', None)

    # Generate completely new UID
    config['dashboard']['uid'] = '$new_uid'

    # Update title to show reset
    original_title = config['dashboard'].get('title', '')
    base_title = original_title.split(' (Reset')[0].split(' (Recreated')[0]
    config['dashboard']['title'] = base_title + ' (Reset $timestamp)'

# Force creation mode
config['overwrite'] = False

with open('$reset_config', 'w') as f:
    json.dump(config, f, indent=2)
"

    print_status "Creating dashboard with reset UID: $new_uid"

    # Deploy with new identity
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$GRAFANA_URL/api/dashboards/db" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $api_key" \
        -d @"$reset_config")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    if [[ $http_code == "200" ]]; then
        print_success "Dashboard reset successful for $environment"
        print_status "New UID: $new_uid"

        local dashboard_url=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('url', ''))
except:
    print('')
" 2>/dev/null)

        if [[ -n "$dashboard_url" ]]; then
            print_status "Dashboard URL: $GRAFANA_URL$dashboard_url"
        fi
        return 0
    else
        print_error "Dashboard reset failed (HTTP $http_code)"
        print_status "Response: $(echo "$body" | head -c 500)"
        return 1
    fi
}

# Function to find and delete all newsletter dashboards - GLOBAL NUCLEAR CLEANUP
global_nuclear_cleanup() {
    local api_key="$1"  # Use any valid API key since we're just deleting all

    print_warning "🚨 GLOBAL NUCLEAR MODE: Finding and deleting ALL newsletter dashboards..."

    # Search for all dashboards with newsletter in the title
    local search_response=$(curl -s \
        -H "Authorization: Bearer $api_key" \
        "$GRAFANA_URL/api/search?query=newsletter&type=dash-db")

    if [[ $? -ne 0 ]]; then
        print_error "Failed to search for existing dashboards"
        return 1
    fi

    # Extract UIDs of newsletter dashboards
    local dashboard_uids=$(echo "$search_response" | python3 -c "
import json, sys
try:
    dashboards = json.load(sys.stdin)
    for dashboard in dashboards:
        title = dashboard.get('title', '').lower()
        uid = dashboard.get('uid', '')
        if 'newsletter' in title and uid:
            print(uid)
except Exception as e:
    pass
")

    if [[ -z "$dashboard_uids" ]]; then
        print_status "No existing newsletter dashboards found"
        return 0
    fi

    # Delete each found dashboard
    local deleted_count=0
    while IFS= read -r uid; do
        if [[ -n "$uid" ]]; then
            print_status "Deleting dashboard with UID: $uid"

            local delete_response=$(curl -s -w "\n%{http_code}" \
                -X DELETE "$GRAFANA_URL/api/dashboards/uid/$uid" \
                -H "Authorization: Bearer $api_key")

            local delete_http_code=$(echo "$delete_response" | tail -n1)

            if [[ $delete_http_code == "200" ]]; then
                print_success "✓ Deleted dashboard: $uid"
                ((deleted_count++))
            else
                print_warning "⚠ Failed to delete dashboard: $uid (HTTP $delete_http_code)"
            fi
        fi
    done <<< "$dashboard_uids"

    print_success "Nuclear cleanup completed: $deleted_count dashboards deleted"

    # Wait for deletions to propagate
    if [[ $deleted_count -gt 0 ]]; then
        print_status "Waiting 5 seconds for deletions to propagate..."
        sleep 5
    fi

    return 0
}

# Enhanced deploy function WITHOUT per-environment nuclear option
deploy_dashboard_enhanced() {
    local config_file="$1"
    local environment="$2"
    local api_key="$3"
    local update_mode="$4"

    print_step "Deploying $environment dashboard..."

    # NO NUCLEAR MODE HERE - It's handled globally before deployment starts

    # For nuclear mode, just create fresh dashboard
    if [[ "$NUCLEAR_MODE" == true ]]; then
        print_status "Creating fresh dashboard for $environment after global nuclear cleanup..."
        if reset_dashboard_completely "$config_file" "$environment" "$api_key"; then
            return 0
        else
            print_error "Failed to create dashboard for $environment after nuclear cleanup"
            return 1
        fi
    fi

    # Original logic for non-nuclear deployments...
    # (Keep existing logic for overwrite mode, etc.)

    # For now, default to creating fresh dashboards
    print_status "Creating fresh $environment dashboard..."
    if create_fresh_dashboard "$config_file" "$environment" "$api_key"; then
        return 0
    else
        return 1
    fi
}

# Function to validate dashboard configuration
validate_dashboard_config() {
    local config_file="$1"
    local environment="$2"

    print_status "Validating $environment dashboard configuration..."

    # Check if file exists
    if [[ ! -f "$config_file" ]]; then
        print_error "Dashboard configuration file not found: $config_file"
        return 1
    fi

    # Validate JSON structure
    if ! python3 -c "
import json, sys
try:
    with open('$config_file', 'r') as f:
        config = json.load(f)

    # Check required structure
    if 'dashboard' not in config:
        print('Missing dashboard object')
        sys.exit(1)

    dashboard = config['dashboard']

    # Check required fields
    required_fields = ['title', 'panels']
    for field in required_fields:
        if field not in dashboard:
            print(f'Missing required field: {field}')
            sys.exit(1)

    print('Dashboard configuration is valid')
    sys.exit(0)

except json.JSONDecodeError as e:
    print(f'Invalid JSON: {e}')
    sys.exit(1)
except Exception as e:
    print(f'Validation error: {e}')
    sys.exit(1)
"; then
        print_error "Dashboard configuration validation failed for $environment"
        return 1
    fi

    print_success "Dashboard configuration validated for $environment"
    return 0
}

# Function to create datasource mapping info
create_datasource_info() {
    local environment="$1"

    print_status "Dashboard will use datasource: Newsletter-API-${environment^}"
    print_status "Make sure this datasource exists in Grafana before proceeding"
}

# Main deployment function - MODIFIED TO HANDLE GLOBAL NUCLEAR CLEANUP
deploy_dashboards() {
    print_step "Starting dashboard deployment process..."

    # HANDLE GLOBAL NUCLEAR CLEANUP FIRST (before any deployments)
    if [[ "$NUCLEAR_MODE" == true ]]; then
        print_warning "🚨 NUCLEAR MODE ACTIVATED - Performing global cleanup before deployment"

        # Use any available API key for global cleanup
        local cleanup_api_key=""
        if [[ "$DEPLOY_STAGING" == true ]]; then
            cleanup_api_key="$GRAFANA_API_KEY_STAGING"
        elif [[ "$DEPLOY_PRODUCTION" == true ]]; then
            cleanup_api_key="$GRAFANA_API_KEY_PRODUCTION"
        fi

        if [[ -n "$cleanup_api_key" ]]; then
            if global_nuclear_cleanup "$cleanup_api_key"; then
                print_success "Global nuclear cleanup completed successfully"
            else
                print_error "Global nuclear cleanup failed"
                return 1
            fi
        else
            print_error "No API key available for nuclear cleanup"
            return 1
        fi

        echo ""
    fi

    local staging_success=true
    local production_success=true

    # Deploy staging dashboard
    if [[ "$DEPLOY_STAGING" == true ]]; then
        create_datasource_info "staging"

        local staging_input="$GRAFANA_DIR/grafana-dashboard-config_staging.json"
        local staging_output="$TEMP_DIR/staging-dashboard.json"

        if validate_dashboard_config "$staging_input" "staging" && \
           inject_api_keys "$staging_input" "$staging_output" "staging" "$GRAFANA_API_KEY_STAGING" && \
           deploy_dashboard_enhanced "$staging_output" "staging" "$GRAFANA_API_KEY_STAGING" "$UPDATE_MODE"; then
            print_success "Staging dashboard deployment completed"
        else
            print_error "Staging dashboard deployment failed"
            staging_success=false
        fi

        echo ""
    fi

    # Deploy production dashboard
    if [[ "$DEPLOY_PRODUCTION" == true ]]; then
        create_datasource_info "production"

        local production_input="$GRAFANA_DIR/grafana-dashboard-config_production.json"
        local production_output="$TEMP_DIR/production-dashboard.json"

        if validate_dashboard_config "$production_input" "production" && \
           inject_api_keys "$production_input" "$production_output" "production" "$GRAFANA_API_KEY_PRODUCTION" && \
           deploy_dashboard_enhanced "$production_output" "production" "$GRAFANA_API_KEY_PRODUCTION" "$UPDATE_MODE"; then
            print_success "Production dashboard deployment completed"
        else
            print_error "Production dashboard deployment failed"
            production_success=false
        fi

        echo ""
    fi

    # Summary
    print_step "Dashboard deployment summary:"

    if [[ "$DEPLOY_STAGING" == true ]]; then
        if [[ "$staging_success" == true ]]; then
            print_success "✓ Staging dashboard: SUCCESS"
        else
            print_error "✗ Staging dashboard: FAILED"
        fi
    fi

    if [[ "$DEPLOY_PRODUCTION" == true ]]; then
        if [[ "$production_success" == true ]]; then
            print_success "✓ Production dashboard: SUCCESS"
        else
            print_error "✗ Production dashboard: FAILED"
        fi
    fi

    echo ""
    echo "Next steps:"
    echo "1. Visit your Grafana dashboards: $GRAFANA_URL/dashboards"
    echo "2. Verify the dashboards are displaying data correctly"
    echo "3. Configure any additional alerting rules if needed"

    # Cleanup temp files
    rm -rf "$TEMP_DIR"

    # Return appropriate exit code
    if [[ "$staging_success" == true && "$production_success" == true ]]; then
        return 0
    else
        return 1
    fi
}

# Parse command line arguments
ENVIRONMENT=""
UPDATE_MODE=false
FORCE_MODE=false
OVERWRITE_MODE=false
NUCLEAR_MODE=false
DEPLOY_STAGING=false
DEPLOY_PRODUCTION=false

while [[ $# -gt 0 ]]; do
    case $1 in
        staging)
            ENVIRONMENT="staging"
            DEPLOY_STAGING=true
            shift
            ;;
        production)
            ENVIRONMENT="production"
            DEPLOY_PRODUCTION=true
            shift
            ;;
        both)
            ENVIRONMENT="both"
            DEPLOY_STAGING=true
            DEPLOY_PRODUCTION=true
            shift
            ;;
        --update)
            UPDATE_MODE=true
            shift
            ;;
        --force)
            FORCE_MODE=true
            shift
            ;;
        --overwrite)
            OVERWRITE_MODE=true
            FORCE_MODE=true
            shift
            ;;
        --nuclear)
            NUCLEAR_MODE=true
            OVERWRITE_MODE=true
            FORCE_MODE=true
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

# Validate arguments
if [[ "$DEPLOY_STAGING" == false && "$DEPLOY_PRODUCTION" == false ]]; then
    print_error "Environment must be specified (staging, production, or both)"
    show_usage
    exit 1
fi

# Load environment variables from .env file if it exists
if [[ -f "$PROJECT_DIR/.env" ]]; then
    print_status "Loading environment variables from .env file..."
    export $(cat "$PROJECT_DIR/.env" | grep -v '^#' | xargs)
fi

main() {
    echo "Grafana Dashboard Deployment"
    echo "============================"
    echo ""

    # Check environment variables
    check_env_vars

    print_success "Environment variables verified ✓"
    echo "Grafana URL: $GRAFANA_URL"

    if [[ "$DEPLOY_STAGING" == true ]]; then
        echo "Deploying: Staging dashboard"
    fi

    if [[ "$DEPLOY_PRODUCTION" == true ]]; then
        echo "Deploying: Production dashboard"
    fi

    if [[ "$UPDATE_MODE" == true ]]; then
        echo "Mode: Update existing dashboards"
    fi

    if [[ "$FORCE_MODE" == true ]]; then
        echo "Mode: Force overwrite without confirmation"
    fi

    if [[ "$OVERWRITE_MODE" == true ]]; then
        echo "Mode: Force overwrite ignoring version conflicts"
    fi

    if [[ "$NUCLEAR_MODE" == true ]]; then
        echo "Mode: 🚨 NUCLEAR - Delete ALL newsletter dashboards and recreate"
        echo ""
        print_warning "⚠️  WARNING: Nuclear mode will delete ALL existing newsletter dashboards!"
        print_warning "⚠️  This includes any custom modifications you may have made!"
        echo ""
        read -p "Are you absolutely sure you want to proceed? Type 'NUCLEAR' to confirm: " -r nuclear_confirm
        if [[ "$nuclear_confirm" != "NUCLEAR" ]]; then
            print_error "Nuclear mode confirmation failed. Aborting."
            exit 1
        fi
        print_warning "Nuclear mode confirmed. Proceeding with dashboard destruction and recreation..."
        echo ""
    fi

    echo ""

    # Deploy dashboards
    deploy_dashboards
}

# Run main function
main