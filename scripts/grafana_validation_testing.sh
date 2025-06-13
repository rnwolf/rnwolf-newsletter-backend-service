#!/bin/bash
# Comprehensive Grafana Integration Validation and Testing Script

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

print_test() {
    echo -e "${CYAN}[TEST]${NC} $1"
}

print_banner() {
    echo -e "${CYAN}"
    echo "================================================================"
    echo "  Newsletter Grafana Integration - Validation & Testing"
    echo "================================================================"
    echo -e "${NC}"
}

# Test result tracking
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
TEST_RESULTS=()

# Function to run a test and track results
run_test() {
    local test_name="$1"
    local test_function="$2"
    
    ((TOTAL_TESTS++))
    print_test "Running: $test_name"
    
    if $test_function; then
        ((PASSED_TESTS++))
        TEST_RESULTS+=("✓ $test_name")
        print_success "✓ PASSED: $test_name"
    else
        ((FAILED_TESTS++))
        TEST_RESULTS+=("✗ $test_name")
        print_error "✗ FAILED: $test_name"
    fi
    echo ""
}

# Function to make authenticated API calls
api_call() {
    local method="$1"
    local url="$2"
    local headers="$3"
    local data="$4"
    local timeout="${5:-30}"
    
    local cmd="curl -s -w \"\\n%{http_code}\" -X $method \"$url\" --max-time $timeout"
    
    if [[ -n "$headers" ]]; then
        cmd="$cmd $headers"
    fi
    
    if [[ -n "$data" ]]; then
        cmd="$cmd -d '$data'"
    fi
    
    eval "$cmd"
}

# Test 1: API Health Check
test_api_health() {
    local env="$1"
    local api_url="$2"
    
    local response=$(api_call "GET" "$api_url/health" "" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code == "200" ]]; then
        if echo "$body" | grep -q '"success":true'; then
            print_status "API health check passed for $env"
            return 0
        else
            print_error "API health check returned success:false for $env"
            return 1
        fi
    else
        print_error "API health check failed for $env (HTTP $http_code)"
        return 1
    fi
}

# Test 2: Metrics Endpoint Authentication
test_metrics_auth() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    
    # Test without auth (should fail)
    local response_no_auth=$(api_call "GET" "$api_url/metrics" "" "" "10")
    local http_code_no_auth=$(echo "$response_no_auth" | tail -n1)
    
    if [[ $http_code_no_auth != "401" ]]; then
        print_error "Metrics endpoint should require authentication for $env (got HTTP $http_code_no_auth)"
        return 1
    fi
    
    # Test with auth (should succeed)
    local response_auth=$(api_call "GET" "$api_url/metrics" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code_auth=$(echo "$response_auth" | tail -n1)
    
    if [[ $http_code_auth == "200" ]]; then
        print_status "Metrics authentication working for $env"
        return 0
    else
        print_error "Metrics authentication failed for $env (HTTP $http_code_auth)"
        return 1
    fi
}

# Test 3: Metrics Content Validation
test_metrics_content() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    
    local response=$(api_call "GET" "$api_url/metrics" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code != "200" ]]; then
        print_error "Could not fetch metrics for $env (HTTP $http_code)"
        return 1
    fi
    
    # Check for required metrics
    local required_metrics=(
        "newsletter_subscribers_total"
        "newsletter_subscribers_active"
        "newsletter_subscriptions_24h"
        "newsletter_unsubscribes_24h"
        "database_status"
        "up"
    )
    
    local missing_metrics=()
    for metric in "${required_metrics[@]}"; do
        if ! echo "$body" | grep -q "$metric"; then
            missing_metrics+=("$metric")
        fi
    done
    
    if [[ ${#missing_metrics[@]} -eq 0 ]]; then
        print_status "All required metrics present for $env"
        return 0
    else
        print_error "Missing metrics for $env: ${missing_metrics[*]}"
        return 1
    fi
}

# Test 4: Prometheus API Compatibility
test_prometheus_api() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    
    # Test Prometheus /api/v1/query endpoint
    local query_url="$api_url/metrics/api/v1/query?query=newsletter_subscribers_total"
    local response=$(api_call "GET" "$query_url" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code != "200" ]]; then
        print_error "Prometheus API query failed for $env (HTTP $http_code)"
        return 1
    fi
    
    # Check response format
    if echo "$body" | grep -q '"status":"success"'; then
        print_status "Prometheus API compatibility working for $env"
        return 0
    else
        print_error "Prometheus API response format invalid for $env"
        return 1
    fi
}

# Test 5: Database Connectivity
test_database_metrics() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    
    local response=$(api_call "GET" "$api_url/metrics/database" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code != "200" ]]; then
        print_error "Database metrics endpoint failed for $env (HTTP $http_code)"
        return 1
    fi
    
    # Check for database status
    if echo "$body" | grep -q '"database_status"'; then
        print_status "Database metrics working for $env"
        return 0
    else
        print_error "Database status not found in metrics for $env"
        return 1
    fi
}

# Test 6: Grafana Datasource Connectivity
test_grafana_datasource() {
    local env="$1"
    local api_key="$2"
    
    # Get all datasources
    local response=$(api_call "GET" "$GRAFANA_URL/api/datasources" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code != "200" ]]; then
        print_error "Could not fetch Grafana datasources for $env (HTTP $http_code)"
        return 1
    fi
    
    # Find newsletter datasource
    local ds_found=$(echo "$body" | grep -o "Newsletter-API-${env^}" || true)
    
    if [[ -n "$ds_found" ]]; then
        print_status "Grafana datasource found for $env"
        return 0
    else
        print_error "Grafana datasource not found for $env"
        return 1
    fi
}

# Test 7: Dashboard Existence
test_grafana_dashboard() {
    local env="$1"
    local api_key="$2"
    
    # Search for dashboards
    local response=$(api_call "GET" "$GRAFANA_URL/api/search?query=newsletter&type=dash-db" "-H 'Authorization: Bearer $api_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)
    
    if [[ $http_code != "200" ]]; then
        print_error "Could not search Grafana dashboards for $env (HTTP $http_code)"
        return 1
    fi
    
    # Check for environment-specific dashboard
    if echo "$body" | grep -q "$env"; then
        print_status "Grafana dashboard found for $env"
        return 0
    else
        print_error "Grafana dashboard not found for $env"
        return 1
    fi
}

# Test 8: End-to-End Metric Flow
test_e2e_metric_flow() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    local grafana_key="$4"
    
    print_status "Testing end-to-end metric flow for $env..."
    
    # Step 1: Generate some data by calling the health endpoint
    local health_response=$(api_call "GET" "$api_url/health" "" "" "10")
    local health_code=$(echo "$health_response" | tail -n1)
    
    if [[ $health_code != "200" ]]; then
        print_error "Could not generate test data for $env"
        return 1
    fi
    
    # Step 2: Wait a moment for metrics to be generated
    sleep 2
    
    # Step 3: Check metrics are available
    local metrics_response=$(api_call "GET" "$api_url/metrics" "-H 'Authorization: Bearer $api_key'" "" "10")
    local metrics_code=$(echo "$metrics_response" | tail -n1)
    
    if [[ $metrics_code != "200" ]]; then
        print_error "Metrics not available after test data generation for $env"
        return 1
    fi
    
    # Step 4: Test Grafana can query the data
    local query_url="$api_url/metrics/api/v1/query?query=up"
    local query_response=$(api_call "GET" "$query_url" "-H 'Authorization: Bearer $grafana_key'" "" "10")
    local query_code=$(echo "$query_response" | tail -n1)
    
    if [[ $query_code == "200" ]]; then
        print_status "End-to-end metric flow working for $env"
        return 0
    else
        print_error "End-to-end metric flow failed for $env"
        return 1
    fi
}

# Test 9: Performance Test
test_metrics_performance() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    
    print_status "Testing metrics endpoint performance for $env..."
    
    local total_time=0
    local successful_requests=0
    local test_count=5
    
    for i in $(seq 1 $test_count); do
        local start_time=$(date +%s%3N)
        local response=$(api_call "GET" "$api_url/metrics" "-H 'Authorization: Bearer $api_key'" "" "5")
        local end_time=$(date +%s%3N)
        local http_code=$(echo "$response" | tail -n1)
        
        if [[ $http_code == "200" ]]; then
            ((successful_requests++))
            local request_time=$((end_time - start_time))
            total_time=$((total_time + request_time))
        fi
    done
    
    if [[ $successful_requests -eq $test_count ]]; then
        local avg_time=$((total_time / test_count))
        print_status "Performance test passed for $env (avg: ${avg_time}ms)"
        
        if [[ $avg_time -lt 2000 ]]; then  # Less than 2 seconds
            return 0
        else
            print_warning "Performance test slow for $env (avg: ${avg_time}ms)"
            return 1
        fi
    else
        print_error "Performance test failed for $env ($successful_requests/$test_count successful)"
        return 1
    fi
}

# Test 10: Cloudflare Secret Validation
test_cloudflare_secrets() {
    local env="$1"
    
    print_status "Testing Cloudflare secret for $env..."
    
    # Check if we can query the secret (indirectly by testing the API)
    local api_url=""
    case $env in
        staging)
            api_url="https://api-staging.rnwolf.net"
            ;;
        production)
            api_url="https://api.rnwolf.net"
            ;;
        *)
            print_error "Unknown environment: $env"
            return 1
            ;;
    esac
    
    # This is an indirect test - we check if the deployed service has the right secret
    # by testing if our API key works against the metrics endpoint
    local test_key=""
    case $env in
        staging)
            test_key="$GRAFANA_API_KEY_STAGING"
            ;;
        production)
            test_key="$GRAFANA_API_KEY_PRODUCTION"
            ;;
    esac
    
    if [[ -z "$test_key" ]]; then
        print_warning "No API key available to test Cloudflare secret for $env"
        return 1
    fi
    
    local response=$(api_call "GET" "$api_url/metrics" "-H 'Authorization: Bearer $test_key'" "" "10")
    local http_code=$(echo "$response" | tail -n1)
    
    if [[ $http_code == "200" ]]; then
        print_status "Cloudflare secret working for $env"
        return 0
    else
        print_error "Cloudflare secret test failed for $env (HTTP $http_code)"
        return 1
    fi
}

# Function to run all tests for an environment
run_environment_tests() {
    local env="$1"
    local api_url="$2"
    local api_key="$3"
    local grafana_key="$4"
    
    print_step "Running tests for $env environment..."
    
    # Basic API tests
    run_test "$env: API Health Check" "test_api_health $env $api_url"
    run_test "$env: Metrics Authentication" "test_metrics_auth $env $api_url $api_key"
    run_test "$env: Metrics Content" "test_metrics_content $env $api_url $api_key"
    run_test "$env: Prometheus API" "test_prometheus_api $env $api_url $api_key"
    run_test "$env: Database Metrics" "test_database_metrics $env $api_url $api_key"
    
    # Grafana tests
    run_test "$env: Grafana Datasource" "test_grafana_datasource $env $grafana_key"
    run_test "$env: Grafana Dashboard" "test_grafana_dashboard $env $grafana_key"
    
    # Integration tests
    run_test "$env: End-to-End Flow" "test_e2e_metric_flow $env $api_url $api_key $grafana_key"
    run_test "$env: Performance" "test_metrics_performance $env $api_url $api_key"
    run_test "$env: Cloudflare Secrets" "test_cloudflare_secrets $env"
}

# Function to generate test data
generate_test_data() {
    local env="$1"
    local api_url="$2"
    
    print_step "Generating test data for $env..."
    
    # Generate some test subscribers if this is staging
    if [[ "$env" == "staging" ]]; then
        local test_email="validation-test-$(date +%s)@test.example.com"
        
        print_status "Creating test subscription..."
        local sub_response=$(api_call "POST" "$api_url/v1/newsletter/subscribe" \
            "-H 'Content-Type: application/json' -H 'Origin: https://www.rnwolf.net'" \
            "{\"email\":\"$test_email\"}" "10")
        
        local sub_code=$(echo "$sub_response" | tail -n1)
        if [[ $sub_code == "200" ]]; then
            print_status "Test subscription created: $test_email"
        else
            print_warning "Could not create test subscription (HTTP $sub_code)"
        fi
    fi
    
    # Hit the health endpoint a few times to generate metrics
    for i in {1..3}; do
        api_call "GET" "$api_url/health" "" "" "5" > /dev/null
        sleep 1
    done
    
    print_status "Test data generation completed for $env"
}

# Function to show detailed test results
show_test_results() {
    print_step "Test Results Summary"
    
    echo ""
    echo "Total Tests: $TOTAL_TESTS"
    echo "Passed: $PASSED_TESTS"
    echo "Failed: $FAILED_TESTS"
    echo ""
    
    if [[ $FAILED_TESTS -eq 0 ]]; then
        print_success "🎉 All tests passed!"
    else
        print_error "❌ Some tests failed"
    fi
    
    echo ""
    print_status "Detailed Results:"
    for result in "${TEST_RESULTS[@]}"; do
        echo "  $result"
    done
    echo ""
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS] [ENVIRONMENT]"
    echo ""
    echo "Environments:"
    echo "  staging      Test staging environment only"
    echo "  production   Test production environment only"
    echo "  all          Test all environments (default)"
    echo ""
    echo "Options:"
    echo "  --generate-data  Generate test data before running tests"
    echo "  --skip-perf     Skip performance tests"
    echo "  --help          Show this help message"
    echo ""
    echo "Environment Variables Required:"
    echo "  GRAFANA_API_KEY_STAGING      - For staging tests"
    echo "  GRAFANA_API_KEY_PRODUCTION   - For production tests"
    echo ""
    echo "Examples:"
    echo "  $0                          # Test all environments"
    echo "  $0 staging                  # Test staging only"
    echo "  $0 --generate-data staging  # Generate test data and test staging"
    echo ""
}

# Parse command line arguments
ENVIRONMENT="all"
GENERATE_DATA=false
SKIP_PERF=false

while [[ $# -gt 0 ]]; do
    case $1 in
        staging|production|all)
            ENVIRONMENT="$1"
            shift
            ;;
        --generate-data)
            GENERATE_DATA=true
            shift
            ;;
        --skip-perf)
            SKIP_PERF=true
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

# Main function
main() {
    print_banner
    
    # Check prerequisites
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed"
        exit 1
    fi
    
    # Check environment variables
    local missing_vars=()
    
    if [[ "$ENVIRONMENT" == "all" || "$ENVIRONMENT" == "staging" ]]; then
        if [[ -z "$GRAFANA_API_KEY_STAGING" ]]; then
            missing_vars+=("GRAFANA_API_KEY_STAGING")
        fi
    fi
    
    if [[ "$ENVIRONMENT" == "all" || "$ENVIRONMENT" == "production" ]]; then
        if [[ -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
            missing_vars+=("GRAFANA_API_KEY_PRODUCTION")
        fi
    fi
    
    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        print_error "Missing required environment variables:"
        for var in "${missing_vars[@]}"; do
            print_error "  $var"
        done
        exit 1
    fi
    
    # Generate test data if requested
    if [[ "$GENERATE_DATA" == true ]]; then
        if [[ "$ENVIRONMENT" == "all" || "$ENVIRONMENT" == "staging" ]]; then
            generate_test_data "staging" "https://api-staging.rnwolf.net"
        fi
        
        # Don't generate test data in production
        if [[ "$ENVIRONMENT" == "production" ]]; then
            print_warning "Skipping test data generation for production environment"
        fi
        
        print_status "Waiting for metrics to propagate..."
        sleep 5
    fi
    
    # Run tests for requested environments
    if [[ "$ENVIRONMENT" == "all" || "$ENVIRONMENT" == "staging" ]]; then
        run_environment_tests "staging" "https://api-staging.rnwolf.net" \
            "$GRAFANA_API_KEY_STAGING" "$GRAFANA_API_KEY_STAGING"
    fi
    
    if [[ "$ENVIRONMENT" == "all" || "$ENVIRONMENT" == "production" ]]; then
        run_environment_tests "production" "https://api.rnwolf.net" \
            "$GRAFANA_API_KEY_PRODUCTION" "$GRAFANA_API_KEY_PRODUCTION"
    fi
    
    # Show results
    show_test_results
    
    # Exit with appropriate code
    if [[ $FAILED_TESTS -eq 0 ]]; then
        exit 0
    else
        exit 1
    fi
}

# Run main function
main "$@"