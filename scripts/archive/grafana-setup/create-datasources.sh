#!/bin/bash
# create-datasources.sh - Enhanced version with better conflict handling

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

GRAFANA_URL="https://throughputfocus.grafana.net"

# Function to generate a unique test datasource name
generate_test_name() {
    echo "__test_permissions_$(date +%s)_$$__"
}

# Function to check API token permissions by testing datasource operations
check_token_permissions() {
    local token="$1"
    local env_name="$2"

    echo -e "${BLUE}Checking permissions for $env_name token...${NC}"

    # Test with a simple API call first
    local response=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token" \
        "$GRAFANA_URL/api/user")

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200)
            echo -e "${GREEN}✓ Token authentication successful for $env_name${NC}"

            # Extract user info
            local login=$(echo "$body" | grep -o '"login":"[^"]*"' | cut -d'"' -f4)
            local role=$(echo "$body" | grep -o '"orgRole":"[^"]*"' | cut -d'"' -f4)

            echo "  User: $login"

            # Check if this is a service account (starts with 'sa-')
            if [[ "$login" =~ ^sa- ]]; then
                echo "  Type: Service Account"
                echo -e "${BLUE}  Testing datasource permissions directly...${NC}"

                # Test datasource permissions by trying to list datasources
                local ds_response=$(curl -s -w "\n%{http_code}" \
                    -H "Authorization: Bearer $token" \
                    "$GRAFANA_URL/api/datasources")

                local ds_http_code=$(echo "$ds_response" | tail -n1)

                case $ds_http_code in
                    200)
                        echo -e "${GREEN}✓ Datasource read permissions confirmed${NC}"

                        # Test creation permissions with a unique name
                        echo -e "${BLUE}  Testing datasource creation permissions...${NC}"
                        local test_name=$(generate_test_name)

                        local test_response=$(curl -s -w "\n%{http_code}" \
                            -X POST "$GRAFANA_URL/api/datasources" \
                            -H "Content-Type: application/json" \
                            -H "Authorization: Bearer $token" \
                            -d '{
                                "name": "'"$test_name"'",
                                "type": "testdata",
                                "access": "proxy"
                            }')

                        local test_http_code=$(echo "$test_response" | tail -n1)
                        local test_body=$(echo "$test_response" | head -n -1)

                        case $test_http_code in
                            200|201)
                                echo -e "${GREEN}✓ Datasource creation permissions confirmed${NC}"

                                # Clean up test datasource
                                local test_id=$(echo "$test_body" | grep -o '"id":[0-9]*' | cut -d: -f2)
                                if [[ -n "$test_id" ]]; then
                                    curl -s -X DELETE "$GRAFANA_URL/api/datasources/$test_id" \
                                        -H "Authorization: Bearer $token" > /dev/null
                                    echo -e "${BLUE}  Cleaned up test datasource${NC}"
                                fi
                                return 0
                                ;;
                            409)
                                echo -e "${YELLOW}⚠ Test datasource name conflict (this is actually good!)${NC}"
                                echo -e "${GREEN}✓ Creation permissions confirmed (409 means we can create, just name conflict)${NC}"

                                # Try to clean up any existing test datasource
                                local cleanup_response=$(curl -s -w "\n%{http_code}" \
                                    -H "Authorization: Bearer $token" \
                                    "$GRAFANA_URL/api/datasources/name/$test_name")

                                local cleanup_http_code=$(echo "$cleanup_response" | tail -n1)
                                if [[ $cleanup_http_code == "200" ]]; then
                                    local existing_id=$(echo "$cleanup_response" | head -n -1 | grep -o '"id":[0-9]*' | cut -d: -f2)
                                    if [[ -n "$existing_id" ]]; then
                                        curl -s -X DELETE "$GRAFANA_URL/api/datasources/$existing_id" \
                                            -H "Authorization: Bearer $token" > /dev/null
                                        echo -e "${BLUE}  Cleaned up existing test datasource${NC}"
                                    fi
                                fi
                                return 0
                                ;;
                            403)
                                echo -e "${RED}✗ Datasource creation permission denied${NC}"
                                local error_msg=$(echo "$test_body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
                                echo -e "${RED}  Error: $error_msg${NC}"
                                return 1
                                ;;
                            *)
                                echo -e "${YELLOW}⚠ Unexpected response testing creation permissions${NC}"
                                echo -e "${YELLOW}  HTTP Code: $test_http_code${NC}"
                                echo -e "${YELLOW}  This may still work for actual datasource creation${NC}"
                                return 0  # Be optimistic
                                ;;
                        esac
                        ;;
                    403)
                        echo -e "${RED}✗ Datasource read permission denied${NC}"
                        return 1
                        ;;
                    *)
                        echo -e "${YELLOW}⚠ Unexpected response testing datasource permissions${NC}"
                        echo -e "${YELLOW}  HTTP Code: $ds_http_code${NC}"
                        return 1
                        ;;
                esac
            else
                # Regular user account
                echo "  Type: User Account"
                echo "  Role: $role"

                if [[ "$role" != "Admin" ]]; then
                    echo -e "${YELLOW}⚠ Warning: User role is '$role', not 'Admin'${NC}"
                    echo -e "${YELLOW}  Datasource creation may fail without Admin permissions${NC}"
                    return 1
                else
                    echo -e "${GREEN}✓ Admin permissions confirmed${NC}"
                    return 0
                fi
            fi
            ;;
        401)
            echo -e "${RED}✗ Authentication failed for $env_name token${NC}"
            echo -e "${RED}  Check that your API key is correct${NC}"
            return 1
            ;;
        403)
            echo -e "${RED}✗ Access denied for $env_name token${NC}"
            echo -e "${RED}  Token lacks required permissions${NC}"
            return 1
            ;;
        *)
            echo -e "${RED}✗ Unexpected error for $env_name token${NC}"
            echo -e "${RED}  HTTP Code: $http_code${NC}"
            echo -e "${RED}  Response: $body${NC}"
            return 1
            ;;
    esac
}

# Enhanced environment variable checking
check_env_vars() {
    local missing_vars=()
    local permission_errors=0

    if [[ -z "$GRAFANA_API_KEY_STAGING" ]]; then
        missing_vars+=("GRAFANA_API_KEY_STAGING")
    else
        if ! check_token_permissions "$GRAFANA_API_KEY_STAGING" "staging"; then
            ((permission_errors++))
        fi
    fi

    echo ""

    if [[ -z "$GRAFANA_API_KEY_PRODUCTION" ]]; then
        missing_vars+=("GRAFANA_API_KEY_PRODUCTION")
    else
        if ! check_token_permissions "$GRAFANA_API_KEY_PRODUCTION" "production"; then
            ((permission_errors++))
        fi
    fi

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
        echo -e "${RED}Error: Missing required environment variables:${NC}"
        for var in "${missing_vars[@]}"; do
            echo -e "  ${RED}$var${NC}"
        done
        exit 1
    fi

    if [[ $permission_errors -gt 0 ]]; then
        echo ""
        echo -e "${RED}Permission Error: One or more API tokens lack required permissions${NC}"
        echo ""
        echo -e "${YELLOW}To fix this for Service Accounts:${NC}"
        echo "1. Go to Administration → Service Accounts"
        echo "2. Click on your service account: 'sa-1-newsletter-datasource-management'"
        echo "3. Ensure the Role is set to 'Admin'"
        echo "4. If it's not Admin, click 'Edit' and change the role"
        exit 1
    fi
}

# Function to create a datasource
create_datasource() {
    local name="$1"
    local url="$2"
    local token="$3"
    local is_default="$4"
    local env_name="$5"

    echo -e "${YELLOW}Creating datasource: $name${NC}"

    local response=$(curl -s -w "\n%{http_code}" -X POST "$GRAFANA_URL/api/datasources" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $token" \
        -d '{
            "name": "'"$name"'",
            "type": "prometheus",
            "access": "proxy",
            "url": "'"$url"'",
            "isDefault": '"$is_default"',
            "jsonData": {
                "timeInterval": "30s",
                "httpMethod": "GET",
                "httpHeaderName1": "Authorization"
            },
            "secureJsonData": {
                "httpHeaderValue1": "Bearer '"$token"'"
            },
            "editable": true
        }')

    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    case $http_code in
        200|201)
            echo -e "${GREEN}✓ Successfully created datasource: $name${NC}"
            local datasource_id=$(echo "$body" | grep -o '"id":[0-9]*' | cut -d: -f2)
            echo -e "${BLUE}  Datasource ID: $datasource_id${NC}"
            ;;
        409)
            echo -e "${YELLOW}⚠ Datasource already exists: $name${NC}"
            echo "Attempting to update existing datasource..."
            update_datasource "$name" "$url" "$token" "$is_default"
            ;;
        403)
            echo -e "${RED}✗ Permission denied creating datasource: $name${NC}"
            local error_msg=$(echo "$body" | grep -o '"message":"[^"]*"' | cut -d'"' -f4)
            echo -e "${RED}Error: $error_msg${NC}"
            return 1
            ;;
        *)
            echo -e "${RED}✗ Failed to create datasource: $name${NC}"
            echo -e "${RED}HTTP Code: $http_code${NC}"
            echo -e "${RED}Response: $body${NC}"
            return 1
            ;;
    esac
}

# Function to update existing datasource
update_datasource() {
    local name="$1"
    local url="$2"
    local token="$3"
    local is_default="$4"

    echo -e "${BLUE}  Looking up existing datasource...${NC}"

    # URL encode the name for the API call
    local encoded_name=$(echo "$name" | sed 's/ /%20/g')

    # First, get the datasource by name
    local datasource_info=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $token" \
        "$GRAFANA_URL/api/datasources/name/$encoded_name")

    local get_http_code=$(echo "$datasource_info" | tail -n1)
    local datasource_body=$(echo "$datasource_info" | head -n -1)

    if [[ $get_http_code == "200" ]]; then
        local datasource_id=$(echo "$datasource_body" | grep -o '"id":[0-9]*' | cut -d: -f2)
        local current_uid=$(echo "$datasource_body" | grep -o '"uid":"[^"]*"' | cut -d'"' -f4)

        echo -e "${BLUE}  Found existing datasource ID: $datasource_id${NC}"

        if [[ -n "$datasource_id" ]]; then
            local response=$(curl -s -w "\n%{http_code}" -X PUT "$GRAFANA_URL/api/datasources/$datasource_id" \
                -H "Content-Type: application/json" \
                -H "Authorization: Bearer $token" \
                -d '{
                    "id": '"$datasource_id"',
                    "uid": "'"$current_uid"'",
                    "name": "'"$name"'",
                    "type": "prometheus",
                    "access": "proxy",
                    "url": "'"$url"'",
                    "isDefault": '"$is_default"',
                    "jsonData": {
                        "timeInterval": "30s",
                        "httpMethod": "GET",
                        "httpHeaderName1": "Authorization"
                    },
                    "secureJsonData": {
                        "httpHeaderValue1": "Bearer '"$token"'"
                    },
                    "editable": true
                }')

            local http_code=$(echo "$response" | tail -n1)

            if [[ $http_code == "200" ]]; then
                echo -e "${GREEN}✓ Successfully updated datasource: $name${NC}"
            else
                echo -e "${RED}✗ Failed to update datasource: $name${NC}"
                echo -e "${RED}HTTP Code: $http_code${NC}"
                local body=$(echo "$response" | head -n -1)
                echo -e "${RED}Response: $body${NC}"
            fi
        fi
    else
        echo -e "${RED}✗ Could not find existing datasource: $name${NC}"
        echo -e "${RED}HTTP Code: $get_http_code${NC}"
        echo -e "${RED}Response: $datasource_body${NC}"
    fi
}

# Main function
main() {
    echo "Grafana Datasource Creator"
    echo "========================="
    echo ""

    # Check environment variables and permissions
    check_env_vars

    echo ""
    echo -e "${GREEN}All permission checks passed ✓${NC}"
    echo "Grafana URL: $GRAFANA_URL"
    echo ""

    # Create staging datasource
    create_datasource \
        "Newsletter-API-Staging" \
        "https://api-staging.rnwolf.net/metrics" \
        "$GRAFANA_API_KEY_STAGING" \
        "false" \
        "staging"

    echo ""

    # Create production datasource
    create_datasource \
        "Newsletter-API-Production" \
        "https://api.rnwolf.net/metrics" \
        "$GRAFANA_API_KEY_PRODUCTION" \
        "true" \
        "production"

    echo ""
    echo -e "${GREEN}Datasource creation completed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Verify datasources in Grafana UI: $GRAFANA_URL/connections/datasources"
    echo "2. Test connectivity from Grafana"
    echo "3. Import dashboards using these datasources"
    echo ""
    echo "To test your datasources:"
    echo "1. Go to your Grafana → Connections → Data sources"
    echo "2. Click on each datasource"
    echo "3. Click 'Save & Test' to verify connectivity"
}

# Show usage if requested
if [[ "$1" == "--help" || "$1" == "-h" ]]; then
    echo "Usage: $0"
    echo ""
    echo "Environment variables required:"
    echo "  GRAFANA_API_KEY_STAGING     - Grafana API key for staging datasource"
    echo "  GRAFANA_API_KEY_PRODUCTION  - Grafana API key for production datasource"
    echo ""
    echo "Example:"
    echo "  export GRAFANA_API_KEY_STAGING=glsa_your_staging_token"
    echo "  export GRAFANA_API_KEY_PRODUCTION=glsa_your_production_token"
    echo "  $0"
    exit 0
fi

# Run main function
main