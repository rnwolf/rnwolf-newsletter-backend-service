#!/bin/bash

# Newsletter Backend Service - Automated Deployment Script
# Usage: ./scripts/deploy.sh [staging|production] [--skip-tests] [--force] [--cleanup-only]

set -e  # Exit on any error



# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SMOKE_TEST_EMAILS_FILE="$PROJECT_DIR/smoke-test-emails.txt"
DEPLOYMENT_LOG_FILE="$PROJECT_DIR/deployment-$(date +%Y%m%d-%H%M%S).log"

# Default settings
ENVIRONMENT=""
SKIP_TESTS=false
FORCE_DEPLOY=false
CLEANUP_ONLY=false
RUN_SMOKE_TESTS=true
PRE_MIGRATION_BOOKMARK="" # Variable to store D1 time-travel bookmark

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
    echo -e "${PURPLE}[STEP]${NC} $1"
}

print_banner() {
    echo -e "${CYAN}"
    echo "======================================================"
    echo "  Newsletter Backend Service - Deployment Script"
    echo "======================================================"
    echo -e "${NC}"
}

# Function to log all output
log_output() {
    exec > >(tee -a "$DEPLOYMENT_LOG_FILE")
    exec 2>&1
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [staging|production] [OPTIONS]"
    echo ""
    echo "Environments:"
    echo "  staging      Deploy to staging environment"
    echo "  production   Deploy to production environment"
    echo ""
    echo "Options:"
    echo "  --skip-tests     Skip running tests before deployment"
    echo "  --force          Force deployment without confirmation"
    echo "  --cleanup-only   Only run cleanup, no deployment"
    echo "  --no-smoke       Skip smoke tests (staging only)"
    echo "  --help           Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 staging"
    echo "  $0 production --force"
    echo "  $0 staging --skip-tests"
    echo "  $0 production --cleanup-only"
    echo ""
}

# Function to parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            staging|production)
                ENVIRONMENT="$1"
                shift
                ;;
            --skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            --force)
                FORCE_DEPLOY=true
                shift
                ;;
            --cleanup-only)
                CLEANUP_ONLY=true
                shift
                ;;
            --no-smoke)
                RUN_SMOKE_TESTS=false
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

    if [[ -z "$ENVIRONMENT" && "$CLEANUP_ONLY" != true ]]; then
        print_error "Environment must be specified (staging or production)"
        show_usage
        exit 1
    fi
}

# Function to set all Cloudflare Worker secrets for the environment
setup_secrets() {
    print_step "Setting Cloudflare Worker secrets for $ENVIRONMENT environment..."

    # This npm script loads secrets from the appropriate .env file and puts them
    # into the Cloudflare Worker environment using wrangler secret put.
    if ! npm run "secrets:$ENVIRONMENT"; then
        print_error "Failed to set secrets for $ENVIRONMENT environment."
        print_status "Ensure all required secrets are defined in .env.$ENVIRONMENT and your Cloudflare API token is configured."
        exit 1
    else
        print_success "Secrets set successfully for $ENVIRONMENT"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    print_step "Checking prerequisites..."

    # Check if we're in the right directory
    if [[ ! -f "$PROJECT_DIR/package.json" ]]; then
        print_error "Not in a valid project directory. package.json not found."
        exit 1
    fi

    # Check if required commands exist
    local commands=("node" "npm" "npx" "curl" "git" "python3" "uv")
    for cmd in "${commands[@]}"; do
        if ! command -v "$cmd" &> /dev/null; then
            print_error "Required command '$cmd' not found. Please install it."
            exit 1
        fi
    done

    # Check if wrangler is available
    if ! npx wrangler --version &> /dev/null; then
        print_error "Wrangler CLI not available. Please install it."
        exit 1
    fi

    # Check git status
    if git status --porcelain | grep -q .; then
        print_warning "Working directory has uncommitted changes."
        if [[ "$FORCE_DEPLOY" != true ]]; then
            read -p "Continue anyway? (y/N): " -r
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                print_error "Deployment cancelled."
                exit 1
            fi
        fi
    fi

    print_success "Prerequisites check passed"
}

# Function to verify environment configuration
verify_environment_config() {
    print_step "Verifying $ENVIRONMENT environment configuration..."

    # Check wrangler.jsonc
    if [[ ! -f "$PROJECT_DIR/wrangler.jsonc" ]]; then
        print_error "wrangler.jsonc not found"
        exit 1
    fi

    # Verify environment exists in wrangler.jsonc
    if ! grep -q "\"$ENVIRONMENT\":" "$PROJECT_DIR/wrangler.jsonc"; then
        print_error "Environment '$ENVIRONMENT' not found in wrangler.jsonc"
        exit 1
    fi

    # Check environment variables and secrets
    print_status "Checking required secrets for $ENVIRONMENT environment..."

    local required_secrets=("TURNSTILE_SECRET_KEY" "HMAC_SECRET_KEY")
    for secret in "${required_secrets[@]}"; do
        if ! npx wrangler secret list --env "$ENVIRONMENT" 2>/dev/null | grep -q "$secret"; then
            print_warning "Secret '$secret' not found for $ENVIRONMENT environment"
            print_status "You may need to set it with: npx wrangler secret put $secret --env $ENVIRONMENT"
        fi
    done

    print_success "Environment configuration verified"
}

# Function to run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_warning "Skipping tests as requested"
        return
    fi

    print_step "Running test suite..."

    # Run type checking
    print_status "Running type check..."
    if ! npm run type-check; then
        print_error "Type check failed"
        exit 1
    fi

    # Run unit tests
    print_status "Running unit tests..."
    if ! npm run test:unit; then
        print_error "Unit tests failed"
        exit 1
    fi

    # Run integration tests
    print_status "Running integration tests..."
    if ! npm run test:integration; then
        print_error "Integration tests failed"
        exit 1
    fi

    print_success "All tests passed"
}

# Function to backup current deployment
backup_current_deployment() {
    print_step "Creating backup of current deployment..."

    # Get current deployment info
    local backup_dir="$PROJECT_DIR/backups/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$backup_dir"

    # Save current wrangler configuration
    cp "$PROJECT_DIR/wrangler.jsonc" "$backup_dir/"

    # Save current source code
    tar -czf "$backup_dir/source-backup.tar.gz" -C "$PROJECT_DIR" src/ tests/ package.json package-lock.json tsconfig.json vitest.config.ts

    # Save deployment metadata
    cat > "$backup_dir/deployment-info.json" << EOF
{
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "environment": "$ENVIRONMENT",
    "git_commit": "$(git rev-parse HEAD 2>/dev/null || echo 'unknown')",
    "git_branch": "$(git branch --show-current 2>/dev/null || echo 'unknown')",
    "deployer": "$(whoami)",
    "hostname": "$(hostname)"
}
EOF

    print_success "Backup created at $backup_dir"
}

# Function to backup database data
backup_database() {
    print_step "Creating database backup for $ENVIRONMENT environment..."

    # Check if Python backup script exists
    if [[ -f "$PROJECT_DIR/scripts/db-backup-restore.py" ]]; then
        print_status "Using Python backup utility..."
        
        # Use the Python backup script which handles D1 properly
        if uv run "$PROJECT_DIR/scripts/db-backup-restore.py" backup "$ENVIRONMENT" --no-verify; then
            print_success "Database backup completed successfully"
        else
            print_warning "Database backup failed, but continuing deployment"
            print_status "You may want to create a manual backup before proceeding"
        fi
    else
        print_warning "Python backup script not found, using fallback method..."
        
        # Fallback: Create a simple backup using D1 commands
        local backup_file="$PROJECT_DIR/backup-${ENVIRONMENT}-$(date +%Y%m%d-%H%M%S).sql"
        
        # Create backup header
        cat > "$backup_file" << EOF
-- Database backup created by deploy.sh
-- Environment: $ENVIRONMENT
-- Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)

-- Create subscribers table if it doesn't exist
CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    verification_token TEXT,
    verified BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert existing data
EOF

        # Try to export data
        if npx wrangler d1 execute DB --env "$ENVIRONMENT" --remote --command="SELECT COUNT(*) FROM subscribers;" > /dev/null 2>&1; then
            print_status "Exporting subscriber data..."
            
            # Export data as INSERT statements
            npx wrangler d1 execute DB --env "$ENVIRONMENT" --remote --command="SELECT 'INSERT INTO subscribers (id, email, verification_token, verified, created_at, updated_at) VALUES (' || id || ', ''' || email || ''', ' || CASE WHEN verification_token IS NULL THEN 'NULL' ELSE '''' || verification_token || '''' END || ', ' || verified || ', ''' || created_at || ''', ''' || updated_at || ''');' FROM subscribers;" --json 2>/dev/null | \
            python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if 'results' in data and len(data['results']) > 0:
        for result in data['results']:
            if 'results' in result:
                for row in result['results']:
                    if len(row) > 0:
                        print(row[0])
except:
    pass
" >> "$backup_file" 2>/dev/null || true

            if grep -q "INSERT INTO subscribers" "$backup_file"; then
                print_success "Database backup saved to: $backup_file"
            else
                echo "-- No data found in subscribers table" >> "$backup_file"
                print_warning "No data to backup (empty table)"
            fi
        else
            echo "-- Could not connect to database or table does not exist" >> "$backup_file"
            print_warning "Could not export data - database may be empty or inaccessible"
        fi
    fi
}

# Function to create a D1 time-travel bookmark before migration
create_d1_bookmark() {
    local env=$1
    # Only run for remote environments where time-travel is most useful
    if [[ "$env" != "staging" && "$env" != "production" ]]; then
        print_status "Skipping D1 time-travel bookmark for local environment."
        return
    fi

    print_step "Creating D1 time-travel bookmark for $env..."

    # Get the current bookmark
    local bookmark_info
    bookmark_info=$(npx wrangler d1 time-travel info DB --env "$env")

    if [[ $? -ne 0 ]]; then
        print_warning "Could not retrieve D1 time-travel info. Skipping bookmark creation."
        return
    fi

    # Extract the bookmark ID using grep and cut
    PRE_MIGRATION_BOOKMARK=$(echo "$bookmark_info" | grep "current bookmark is" | cut -d"'" -f2)

    if [[ -n "$PRE_MIGRATION_BOOKMARK" ]]; then
        print_success "D1 time-travel bookmark saved: $PRE_MIGRATION_BOOKMARK"
    else
        print_warning "Failed to extract D1 time-travel bookmark."
    fi
}

# Function to deploy to environment
deploy_to_environment() {
    print_step "Deploying to $ENVIRONMENT environment..."

    # Create a D1 time-travel bookmark before running migrations
    create_d1_bookmark "$ENVIRONMENT"

    # Run database migrations
    print_status "Running database migrations for $ENVIRONMENT..."
    if ! npm run "db:migrate:$ENVIRONMENT"; then
        print_error "Database migration failed"
        exit 1
    fi

    # Deploy the worker
    print_status "Deploying worker..."
    if ! npm run "deploy:$ENVIRONMENT"; then
        print_error "Worker deployment failed"
        exit 1
    fi

    print_success "Deployment completed successfully"
}

# Function to verify deployment
verify_deployment() {
    print_step "Verifying $ENVIRONMENT deployment..."

    # Determine the API URL based on environment
    local api_url
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        api_url="https://api-staging.rnwolf.net"
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        api_url="https://api.rnwolf.net"
    else
        print_error "Unknown environment: $ENVIRONMENT"
        exit 1
    fi

    # Wait a moment for deployment to propagate
    print_status "Waiting for deployment to propagate..."
    sleep 10

    # Test health endpoint
    print_status "Testing health endpoint..."
    local health_response
    if ! health_response=$(curl -s -f "$api_url/health" --max-time 30); then
        print_error "Health check failed - API not responding"
        exit 1
    fi

    # Parse health response
    if ! echo "$health_response" | grep -q '"success":true'; then
        print_error "Health check failed - API reporting unhealthy"
        echo "Response: $health_response"
        exit 1
    fi

    # Verify environment in response
    if ! echo "$health_response" | grep -q "\"environment\":\"$ENVIRONMENT\""; then
        print_warning "Environment mismatch in health response"
        echo "Response: $health_response"
    fi

    print_success "Deployment verification passed"
}

# Function to run environment-specific tests
run_environment_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_warning "Skipping environment tests as requested"
        return
    fi

    print_step "Running $ENVIRONMENT environment tests..."

    if [[ "$ENVIRONMENT" == "staging" ]]; then
        # Run integration tests against the deployed staging environment
        # This ensures tests use the correct CORS origin and base URL from staging config
        if ! npm run test:staging:workers; then
            print_error "Staging integration tests failed"
            exit 1
        fi
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        if [[ "$RUN_SMOKE_TESTS" == true ]]; then
            print_status "Running production smoke tests..."

            # Run smoke tests and capture emails that need cleanup
            if npm run test:smoke:production 2>&1 | tee /tmp/smoke-test-output.log; then
                print_success "Production smoke tests passed"

                # Extract test emails for cleanup
                if grep -o 'smoke-test-[0-9]*@smoke-test\.example\.com' /tmp/smoke-test-output.log > "$SMOKE_TEST_EMAILS_FILE" 2>/dev/null; then
                    print_status "Test emails saved to $SMOKE_TEST_EMAILS_FILE"
                fi
            else
                print_error "Production smoke tests failed"
                exit 1
            fi
        else
            print_warning "Skipping smoke tests as requested"
        fi
    fi

    print_success "Environment tests completed"
}

# Function to cleanup test data
cleanup_test_data() {
    if [[ ! -f "$SMOKE_TEST_EMAILS_FILE" ]]; then
        print_status "No test emails to clean up"
        return
    fi

    print_step "Cleaning up test data..."

    local email_count=$(wc -l < "$SMOKE_TEST_EMAILS_FILE" 2>/dev/null || echo "0")
    if [[ "$email_count" -gt 0 ]]; then
        print_status "Found $email_count test emails to clean up"

        # Run cleanup script
        if node "$PROJECT_DIR/tests/cleanup-smoke-tests.js" --from-file "$SMOKE_TEST_EMAILS_FILE"; then
            print_success "Test data cleanup completed"
            rm -f "$SMOKE_TEST_EMAILS_FILE"
        else
            print_warning "Some test data cleanup failed. Manual cleanup may be required."
            print_status "Test emails list saved at: $SMOKE_TEST_EMAILS_FILE"
        fi
    else
        print_status "No test emails found to clean up"
    fi
}

# Function to send deployment notification
send_deployment_notification() {
    print_step "Sending deployment notification..."

    local commit_hash=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')
    local commit_message=$(git log -1 --pretty=%B 2>/dev/null || echo 'unknown')
    local deployer=$(whoami)
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Create deployment summary
    cat > "$PROJECT_DIR/deployment-summary.txt" << EOF
Newsletter Backend Service Deployment Summary
============================================

Environment: $ENVIRONMENT
Timestamp: $timestamp
Deployer: $deployer
Git Commit: $commit_hash
Commit Message: $commit_message

Deployment Status: SUCCESS
Log File: $DEPLOYMENT_LOG_FILE

API Endpoints:
EOF

    if [[ "$ENVIRONMENT" == "staging" ]]; then
        echo "- Health: https://api-staging.rnwolf.net/health" >> "$PROJECT_DIR/deployment-summary.txt"
        echo "- Subscribe: https://api-staging.rnwolf.net/v1/newsletter/subscribe" >> "$PROJECT_DIR/deployment-summary.txt"
        echo "- Unsubscribe: https://api-staging.rnwolf.net/v1/newsletter/unsubscribe" >> "$PROJECT_DIR/deployment-summary.txt"
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        echo "- Health: https://api.rnwolf.net/health" >> "$PROJECT_DIR/deployment-summary.txt"
        echo "- Subscribe: https://api.rnwolf.net/v1/newsletter/subscribe" >> "$PROJECT_DIR/deployment-summary.txt"
        echo "- Unsubscribe: https://api.rnwolf.net/v1/newsletter/unsubscribe" >> "$PROJECT_DIR/deployment-summary.txt"
    fi

    print_success "Deployment summary saved to deployment-summary.txt"

    # TODO: Add integrations for notifications
    # - Slack webhook
    # - Email notification
    # - Discord webhook
    # Example:
    # if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
    #     curl -X POST -H 'Content-type: application/json' \
    #         --data "{\"text\":\"✅ Newsletter API deployed to $ENVIRONMENT successfully\"}" \
    #         "$SLACK_WEBHOOK_URL"
    # fi
}

# Function to handle deployment rollback
handle_rollback() {
    print_error "Deployment failed. Would you like to rollback?"

    # If a D1 time-travel bookmark was created, suggest restoring it
    if [[ -n "$PRE_MIGRATION_BOOKMARK" ]]; then
        print_warning "A database migration may have failed."
        print_status "A D1 time-travel bookmark was created before the migration: ${YELLOW}$PRE_MIGRATION_BOOKMARK${NC}"
        print_status "To restore the database to its pre-migration state, run:"
        echo -e "${CYAN}npx wrangler d1 time-travel restore DB --env \"$ENVIRONMENT\" --remote --bookmark=\"$PRE_MIGRATION_BOOKMARK\"${NC}"
    fi

    if [[ "$FORCE_DEPLOY" != true ]]; then
        read -p "Rollback to previous version? (y/N): " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_step "Rolling back deployment..."

            # Rollback using wrangler
            if npx wrangler rollback --env "$ENVIRONMENT"; then
                print_success "Rollback completed successfully"
            else
                print_error "Rollback failed. Manual intervention required."
            fi
        fi
    fi
}

# Function to show deployment summary
show_deployment_summary() {
    print_banner
    echo -e "${GREEN}🎉 Deployment Completed Successfully!${NC}"
    echo ""
    echo "Environment: $ENVIRONMENT"
    echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Log File: $DEPLOYMENT_LOG_FILE"
    echo ""

    if [[ "$ENVIRONMENT" == "staging" ]]; then
        echo "Staging URLs:"
        echo "  Health: https://api-staging.rnwolf.net/health"
        echo "  API: https://api-staging.rnwolf.net/v1/newsletter/"
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        echo "Production URLs:"
        echo "  Health: https://api.rnwolf.net/health"
        echo "  API: https://api.rnwolf.net/v1/newsletter/"
    fi

    echo ""
    echo "Next steps:"
    echo "  1. Test the deployment manually"
    echo "  2. Monitor logs for any issues"
    echo "  3. Update any dependent services"
    echo ""
}

# Function to test metrics endpoint after deployment
test_metrics_endpoint() {
    print_step "Testing metrics endpoint..."

    local api_url
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        api_url="https://api-staging.rnwolf.net"
    elif [[ "$ENVIRONMENT" == "production" ]]; then
        api_url="https://api.rnwolf.net"
    else
        print_error "Unknown environment: $ENVIRONMENT"
        return 1
    fi

    if [[ -z "$GRAFANA_API_KEY" ]]; then
        print_warning "No Grafana API key available for $ENVIRONMENT environment"
        print_status "Skipping metrics endpoint test"
        return 0
    fi

    # Test both the main metrics endpoint (for Grafana) and health endpoint
    print_status "Testing Grafana metrics endpoint: $api_url/metrics"

    local response
    local http_code

    # Test the main metrics endpoint that Grafana will use
    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $GRAFANA_API_KEY" \
        "$api_url/metrics" \
        --max-time 30 \
        --connect-timeout 10)

    http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            print_success "Main metrics endpoint is accessible"
            # Check if response looks like Prometheus format
            if echo "$body" | grep -q "^# TYPE\|^[a-zA-Z_][a-zA-Z0-9_]*{.*}"; then
                print_success "Response appears to be valid Prometheus format"
            else
                print_warning "Response doesn't look like Prometheus format"
                print_status "First 200 chars: $(echo "$body" | head -c 200)"
            fi
            ;;
        401)
            print_error "Metrics endpoint authentication failed"
            print_status "Check that GRAFANA_API_KEY_${ENVIRONMENT^^} is set correctly"
            return 1
            ;;
        403)
            print_error "Metrics endpoint access denied"
            print_status "API key may lack required permissions"
            return 1
            ;;
        404)
            print_error "Metrics endpoint not found at $api_url/metrics"
            print_status "Check that the metrics handler is properly deployed"
            return 1
            ;;
        000)
            print_error "Could not connect to metrics endpoint"
            print_status "Check that the API is deployed and accessible"
            return 1
            ;;
        *)
            print_error "Metrics endpoint test failed with HTTP $http_code"
            print_status "Response: $(echo "$body" | head -c 500)"
            return 1
            ;;
    esac

    # Also test the health endpoint for additional validation
    print_status "Testing metrics health endpoint: $api_url/metrics/health"

    response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $GRAFANA_API_KEY" \
        "$api_url/metrics/health" \
        --max-time 30 \
        --connect-timeout 10)

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            print_success "Health metrics endpoint is accessible"
            # Try to parse as JSON
            if echo "$body" | python3 -m json.tool > /dev/null 2>&1; then
                print_success "Health response is valid JSON"
                # Show health status
                local overall_status=$(echo "$body" | grep -o '"overall_status":"[^"]*"' | cut -d'"' -f4)
                if [[ "$overall_status" == "healthy" ]]; then
                    print_success "System reports healthy status"
                else
                    print_warning "System reports status: $overall_status"
                fi
            else
                print_warning "Health response is not valid JSON"
            fi
            return 0
            ;;
        *)
            print_warning "Health endpoint returned HTTP $http_code"
            print_status "This is not critical, main metrics endpoint is working"
            return 0  # Don't fail deployment for health endpoint issues
            ;;
    esac
}


# Main deployment function
main() {
    # Start logging
    log_output

    print_banner
    print_status "Starting deployment process..."
    print_status "Deployment log: $DEPLOYMENT_LOG_FILE"

    # Change to project directory
    cd "$PROJECT_DIR"

    # Load environment variables from the correct .env.<environment> file
    if [[ -n "$ENVIRONMENT" ]]; then
        local env_file="$PROJECT_DIR/.env.$ENVIRONMENT"
        if [[ -f "$env_file" ]]; then
            print_status "Loading environment variables from $env_file..."
            export $(cat "$env_file" | grep -v '^#' | xargs)
        else
            print_warning "Environment file not found: $env_file. Relying on exported variables."
        fi
    else
        # For cleanup-only mode without an environment
        print_status "No environment specified, relying on exported variables."
    fi

    # Handle cleanup-only mode
    if [[ "$CLEANUP_ONLY" == true ]]; then
        print_step "Running cleanup-only mode..."
        cleanup_test_data
        print_success "Cleanup completed"
        exit 0
    fi

    # Confirmation for production
    if [[ "$ENVIRONMENT" == "production" && "$FORCE_DEPLOY" != true ]]; then
        print_warning "You are about to deploy to PRODUCTION!"
        read -p "Are you sure you want to continue? (y/N): " -r
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_error "Deployment cancelled."
            exit 1
        fi
    fi

    # Set up error handling
    trap 'handle_rollback' ERR

    # Execute deployment steps
    check_prerequisites
    setup_secrets
    verify_environment_config
    run_tests
    backup_current_deployment
    backup_database
    deploy_to_environment
    verify_deployment
    run_environment_tests
    cleanup_test_data
    send_deployment_notification

    # To this (make it non-blocking):
    if ! test_metrics_endpoint; then
        print_warning "Metrics endpoint test failed, but continuing deployment"
        print_status "You can test metrics manually later"
    fi

    # Show success summary
    show_deployment_summary

    print_success "Deployment process completed successfully! 🚀"
}

# Parse arguments and run main function
parse_args "$@"
main