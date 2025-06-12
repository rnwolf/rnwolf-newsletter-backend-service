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

# Function to extract dashboard info from JSON (FIXED VERSION)
extract_dashboard_info() {
    local json_response="$1"
    local temp_file="$TEMP_DIR/extract_info_$$.json"

    # Write JSON to temp file to avoid command line issues
    echo "$json_response" > "$temp_file"

    python3 -c "
import json
try:
    with open('$temp_file', 'r') as f:
        data = json.load(f)

    dashboard = data.get('dashboard', {})
    meta = data.get('meta', {})

    print('EXISTS=true')
    print('ID=' + str(dashboard.get('id', '')))
    print('VERSION=' + str(dashboard.get('version', '1')))
    print('UID=' + str(dashboard.get('uid', '')))
    print('SLUG=' + str(meta.get('slug', '')))
except Exception as e:
    print('EXISTS=false')
    print('ERROR=ParseError')
" 2>/dev/null

    # Clean up temp file
    rm -f "$temp_file"
}

# Function to prepare dashboard JSON with proper version handling (FIXED VERSION)
prepare_dashboard_json() {
    local config_file="$1"
    local dashboard_info="$2"
    local output_file="$3"
    local overwrite_mode="$4"

    if [[ "$overwrite_mode" == true && -n "$dashboard_info" ]]; then
        # Use Python to handle everything safely
        local temp_info_file="$TEMP_DIR/dashboard_info_$$.json"
        echo "$dashboard_info" > "$temp_info_file"

        python3 -c "
import json
import sys

# Read the dashboard info
dashboard_id = ''
new_version = 1
dashboard_uid = ''

try:
    with open('$temp_info_file', 'r') as f:
        dashboard_response = json.load(f)

    existing_dashboard = dashboard_response.get('dashboard', {})
    dashboard_id = existing_dashboard.get('id', '')
    dashboard_version = existing_dashboard.get('version', 1)
    dashboard_uid = existing_dashboard.get('uid', '')

    # Increment version
    new_version = int(dashboard_version) + 1

    print(f'Found existing dashboard: ID={dashboard_id}, Version={dashboard_version} -> {new_version}', file=sys.stderr)

except Exception as e:
    print(f'Error reading dashboard info, using defaults: {e}', file=sys.stderr)

# Read and update the config file
try:
    with open('$config_file', 'r') as f:
        config = json.load(f)

    # Update dashboard metadata for overwrite
    if 'dashboard' in config:
        if dashboard_id:
            config['dashboard']['id'] = int(dashboard_id)
        config['dashboard']['version'] = new_version
        if dashboard_uid:
            config['dashboard']['uid'] = dashboard_uid

        # Set overwrite flag
        config['overwrite'] = True

    with open('$output_file', 'w') as f:
        json.dump(config, f, indent=2)

    print(f'Dashboard prepared successfully with version {new_version}', file=sys.stderr)

except Exception as e:
    print(f'Error preparing dashboard: {e}', file=sys.stderr)
    # Fallback: just copy the original file
    import shutil
    shutil.copy('$config_file', '$output_file')
"

        # Clean up temp file
        rm -f "$temp_info_file"
    else
        # For normal mode, just copy the file
        cp "$config_file" "$output_file"
    fi
}

# Function to delete existing dashboard
delete_dashboard() {
    local dashboard_uid="$1"
    local api_key="$2"
    local environment="$3"

    print_status "Deleting existing $environment dashboard (UID: $dashboard_uid)..."

    local response=$(curl -s -w "\n%{http_code}" \
        -X DELETE "$GRAFANA_URL/api/dashboards/uid/$dashboard_uid" \
        -H "Authorization: Bearer $api_key")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            print_success "Successfully deleted existing $environment dashboard"
            return 0
            ;;
        404)
            print_warning "Dashboard not found (already deleted or doesn't exist)"
            return 0
            ;;
        403)
            print_error "Access denied when deleting $environment dashboard"
            return 1
            ;;
        *)
            print_error "Failed to delete $environment dashboard (HTTP $http_code)"
            print_status "Response: $(echo "$body" | head -c 200)"
            return 1
            ;;
    esac
}

# Function to create fresh dashboard with new UID (FIXED)
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
    local original_uid="$4"

    print_warning "Attempting complete dashboard reset for $environment..."

    # Try to delete by UID first
    if [[ -n "$original_uid" ]]; then
        print_status "Deleting dashboard with UID: $original_uid"
        curl -s -X DELETE "$GRAFANA_URL/api/dashboards/uid/$original_uid" \
            -H "Authorization: Bearer $api_key" > /dev/null
    fi

    # Wait for deletion to propagate
    sleep 3

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

# Function to find and delete all newsletter dashboards
nuclear_cleanup() {
    local api_key="$1"
    local environment_name="$2"

    print_warning "🚨 NUCLEAR MODE: Finding and deleting ALL newsletter dashboards for $environment_name..."

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

# Enhanced deploy function with nuclear option
deploy_dashboard_enhanced() {
    local config_file="$1"
    local environment="$2"
    local api_key="$3"
    local update_mode="$4"

    print_step "Deploying $environment dashboard..."

    # Extract dashboard UID from config
    local dashboard_uid=$(python3 -c "
import json, sys
with open('$config_file', 'r') as f:
    config = json.load(f)
    print(config.get('dashboard', {}).get('uid', ''))
" 2>/dev/null)

    # NUCLEAR MODE: Clean slate approach
    if [[ "$NUCLEAR_MODE" == true ]]; then
        print_warning "🚨 NUCLEAR MODE ACTIVATED for $environment"

        # Delete ALL newsletter dashboards for this environment
        if nuclear_cleanup "$api_key" "$environment"; then
            print_status "Nuclear cleanup completed, creating fresh dashboard..."

            # Create completely fresh dashboard with nuclear reset
            if reset_dashboard_completely "$config_file" "$environment" "$api_key" "$dashboard_uid"; then
                return 0
            else
                print_error "Failed to create dashboard after nuclear cleanup"
                return 1
            fi
        else
            print_error "Nuclear cleanup failed"
            return 1
        fi
    fi

    # Check if dashboard exists (non-nuclear mode)
    local dashboard_info=""
    local dashboard_exists=false

    if [[ -n "$dashboard_uid" ]]; then
        dashboard_info=$(get_dashboard_info "$dashboard_uid" "$api_key" 2>/dev/null || echo "")
        if [[ -n "$dashboard_info" ]]; then
            dashboard_exists=true
        fi
    fi

    # If dashboard exists and we're in overwrite mode, delete and recreate
    if [[ "$dashboard_exists" == true && "$OVERWRITE_MODE" == true ]]; then
        print_warning "Dashboard exists, deleting and recreating to avoid version conflicts..."

        if delete_dashboard "$dashboard_uid" "$api_key" "$environment"; then
            # Wait a moment for deletion to propagate
            sleep 2

            # Create fresh dashboard
            if create_fresh_dashboard "$config_file" "$environment" "$api_key"; then
                return 0
            else
                return 1
            fi
        else
            print_error "Failed to delete existing dashboard, cannot proceed"
            return 1
        fi

    # If dashboard exists but not in overwrite mode, try normal update
    elif [[ "$dashboard_exists" == true ]]; then
        if [[ "$FORCE_MODE" == true ]]; then
            print_warning "Dashboard exists, attempting normal update..."
        else
            print_warning "Dashboard already exists with UID: $dashboard_uid"
            echo "Options:"
            echo "  1. Try normal update (may have version conflicts)"
            echo "  2. Delete and recreate (no version conflicts)"
            echo "  3. Nuclear option (delete ALL newsletter dashboards and recreate)"
            echo "  4. Skip this dashboard"
            read -p "Choose option (1/2/3/4): " -r choice

            case $choice in
                2)
                    print_status "Deleting and recreating dashboard..."
                    if delete_dashboard "$dashboard_uid" "$api_key" "$environment"; then
                        sleep 2
                        if create_fresh_dashboard "$config_file" "$environment" "$api_key"; then
                            return 0
                        else
                            return 1
                        fi
                    else
                        return 1
                    fi
                    ;;
                3)
                    print_warning "🚨 NUCLEAR OPTION SELECTED"
                    read -p "This will delete ALL newsletter dashboards. Are you sure? (yes/no): " -r confirm
                    if [[ "$confirm" == "yes" ]]; then
                        if nuclear_cleanup "$api_key" "$environment"; then
                            if reset_dashboard_completely "$config_file" "$environment" "$api_key" "$dashboard_uid"; then
                                return 0
                            else
                                return 1
                            fi
                        else
                            return 1
                        fi
                    else
                        print_status "Nuclear option cancelled"
                        return 1
                    fi
                    ;;
                4)
                    print_warning "Skipping $environment dashboard deployment"
                    return 0
                    ;;
                *)
                    print_status "Attempting normal update..."
                    ;;
            esac
        fi

        # Try normal update with version handling
        local final_config="$TEMP_DIR/${environment}-final-dashboard.json"
        prepare_dashboard_json "$config_file" "$dashboard_info" "$final_config" "false"

        local response=$(curl -s -w "\n%{http_code}" \
            -X POST "$GRAFANA_URL/api/dashboards/db" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $api_key" \
            -d @"$final_config")

        local http_code=$(echo "$response" | tail -n1)

        if [[ $http_code == "412" ]]; then
            print_error "Version conflict occurred. Use --nuclear for complete reset"
            return 1
        elif [[ $http_code == "200" ]]; then
            print_success "Successfully updated $environment dashboard"
            return 0
        else
            print_error "Update failed with HTTP $http_code"
            return 1
        fi

    # Dashboard doesn't exist, create fresh
    else
        print_status "Dashboard doesn't exist, creating new one..."
        if create_fresh_dashboard "$config_file" "$environment" "$api_key"; then
            return 0
        else
            return 1
        fi
    fi
}

# Function to deploy dashboard with enhanced version handling
deploy_dashboard() {
    local config_file="$1"
    local environment="$2"
    local api_key="$3"
    local update_mode="$4"

    print_step "Deploying $environment dashboard..."

    # Extract dashboard UID from config for existence check
    local dashboard_uid=$(python3 -c "
import json, sys
with open('$config_file', 'r') as f:
    config = json.load(f)
    print(config.get('dashboard', {}).get('uid', ''))
" 2>/dev/null)

    # Check if dashboard already exists and get its info
    local dashboard_info=""
    local dashboard_exists=false

    if [[ -n "$dashboard_uid" ]]; then
        dashboard_info=$(get_dashboard_info "$dashboard_uid" "$api_key" 2>/dev/null || echo "")
        if [[ -n "$dashboard_info" ]]; then
            dashboard_exists=true
        fi
    fi

    # Handle existing dashboard
    if [[ "$dashboard_exists" == true ]]; then
        if [[ "$update_mode" == true ]]; then
            print_warning "Dashboard exists, updating with version handling..."
        elif [[ "$FORCE_MODE" == true ]]; then
            print_warning "Dashboard exists, overwriting due to --force flag..."
        elif [[ "$OVERWRITE_MODE" == true ]]; then
            print_warning "Dashboard exists, force overwriting (ignoring version conflicts)..."
        else
            print_warning "Dashboard already exists with UID: $dashboard_uid"
            read -p "Overwrite existing dashboard? (y/N): " -r
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                print_warning "Skipping $environment dashboard deployment"
                return 0
            fi
        fi
    fi

    # Prepare the final JSON with proper version handling
    local final_config="$TEMP_DIR/${environment}-final-dashboard.json"
    prepare_dashboard_json "$config_file" "$dashboard_info" "$final_config" "$OVERWRITE_MODE"

    # Deploy the dashboard
    local response=$(curl -s -w "\n%{http_code}" \
        -X POST "$GRAFANA_URL/api/dashboards/db" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $api_key" \
        -d @"$final_config")

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

            print_success "Successfully deployed $environment dashboard"
            print_status "Dashboard ID: $dashboard_id"
            if [[ -n "$dashboard_url" ]]; then
                print_status "Dashboard URL: $GRAFANA_URL$dashboard_url"
            fi
            ;;
        400)
            print_error "Bad request deploying $environment dashboard"
            local error_msg=$(echo "$body" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('message', 'Unknown error'))
except:
    print('Invalid JSON response')
" 2>/dev/null)
            print_error "Error: $error_msg"
            print_status "Response body (first 500 chars): $(echo "$body" | head -c 500)"
            return 1
            ;;
        401)
            print_error "Authentication failed for $environment dashboard"
            print_error "Check that GRAFANA_API_KEY_${environment^^} is correct"
            return 1
            ;;
        403)
            print_error "Access denied for $environment dashboard"
            print_error "API key may lack dashboard creation permissions"
            return 1
            ;;
        412)
            if [[ "$OVERWRITE_MODE" == true ]]; then
                print_error "Version conflict persists even with overwrite mode for $environment"
                print_error "Manual intervention may be required"
            else
                print_error "Dashboard version conflict for $environment"
                print_error "The dashboard has been modified since you last loaded it"
                print_warning "Try using --overwrite flag to force overwrite"
                print_status "Command: $0 $environment --overwrite"
            fi
            return 1
            ;;
        *)
            print_error "Failed to deploy $environment dashboard"
            print_error "HTTP Code: $http_code"
            print_error "Response: $(echo "$body" | head -c 500)"
            return 1
            ;;
    esac
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

# Main deployment function
deploy_dashboards() {
    print_step "Starting dashboard deployment process..."

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
# Parse command line arguments
ENVIRONMENT=""
UPDATE_MODE=false
FORCE_MODE=false
OVERWRITE_MODE=false
NUCLEAR_MODE=false  # Add this line
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
        --nuclear)  # Add this option
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