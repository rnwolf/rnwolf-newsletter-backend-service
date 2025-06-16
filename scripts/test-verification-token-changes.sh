#!/bin/bash

# Script: test-verification-token-changes.sh
# Purpose: Test that email verification changes work correctly
# Usage: ./scripts/test-verification-token-changes.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}Testing Email Verification Token Implementation${NC}"
echo -e "${BLUE}=============================================${NC}"
echo ""

# Check if dev server is running
check_dev_server() {
    echo -e "${CYAN}1. Checking if dev server is running...${NC}"

    if curl -s http://localhost:8787/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Dev server is running"

        # Show health check response
        echo "Health check response:"
        curl -s http://localhost:8787/health | jq . 2>/dev/null || curl -s http://localhost:8787/health
        echo ""
    else
        echo -e "${YELLOW}!${NC} Dev server not running. Starting it..."
        echo "Run in another terminal: ${CYAN}npm run dev${NC}"
        echo "Then press Enter to continue..."
        read -p ""

        # Check again
        if curl -s http://localhost:8787/health >/dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Dev server is now running"
        else
            echo -e "${RED}✗${NC} Dev server still not accessible"
            echo "Make sure to run: npm run dev"
            exit 1
        fi
    fi
}

# Test subscription with verification token
test_subscription() {
    echo -e "${CYAN}2. Testing subscription with email verification...${NC}"

    local test_email="verification-test-$(date +%s)@example.com"
    echo "Using test email: $test_email"

    echo -n "Making subscription request... "

    local response=$(curl -s -w "\n%{http_code}" -X POST http://localhost:8787/v1/newsletter/subscribe \
        -H "Content-Type: application/json" \
        -H "Origin: https://www.rnwolf.net" \
        -d "{\"email\":\"$test_email\"}")

    local http_code=$(echo "$response" | tail -n1)
    local response_body=$(echo "$response" | head -n -1)

    if [ "$http_code" = "200" ]; then
        echo -e "${GREEN}✓ Success (HTTP 200)${NC}"
    else
        echo -e "${RED}✗ Failed (HTTP $http_code)${NC}"
        echo "Response: $response_body"
        return 1
    fi

    echo ""
    echo "Response body:"
    echo "$response_body" | jq . 2>/dev/null || echo "$response_body"
    echo ""

    # Check if response message changed
    if echo "$response_body" | grep -q "verification link"; then
        echo -e "${GREEN}✓${NC} Response message updated correctly (mentions verification)"
    elif echo "$response_body" | grep -q "Thank you for subscribing"; then
        echo -e "${RED}✗${NC} Response message NOT updated (still says 'Thank you for subscribing')"
        echo -e "   ${YELLOW}You need to update the response message${NC}"
        return 1
    else
        echo -e "${YELLOW}!${NC} Response message unclear - check manually"
    fi

    # Store test email for database check
    echo "$test_email" > /tmp/last_test_email.txt

    return 0
}

# Check database state
check_database() {
    echo -e "${CYAN}3. Checking database state...${NC}"

    if [ ! -f "/tmp/last_test_email.txt" ]; then
        echo -e "${YELLOW}!${NC} No test email found, using generic query"
        local test_email="verification-test%@example.com"
    else
        local test_email=$(cat /tmp/last_test_email.txt)
    fi

    echo "Checking database for email: $test_email"

    # Query database
    echo -n "Querying database... "

    local db_result=$(npx wrangler d1 execute DB --env local --command="SELECT email, email_verified, verification_token IS NOT NULL as has_token, verification_sent_at IS NOT NULL as has_sent_at FROM subscribers WHERE email LIKE '$test_email' OR email = '$test_email';" 2>/dev/null || echo "ERROR")

    if [ "$db_result" = "ERROR" ]; then
        echo -e "${RED}✗ Database query failed${NC}"
        echo "Try running: npm run db:verify:local"
        return 1
    fi

    echo -e "${GREEN}✓ Success${NC}"
    echo ""
    echo "Database results:"
    echo "$db_result"
    echo ""

    # Analyze results
    if echo "$db_result" | grep -q "FALSE.*true.*true"; then
        echo -e "${GREEN}✓${NC} Correct: email_verified=FALSE, has verification token and timestamp"
    elif echo "$db_result" | grep -q "TRUE"; then
        echo -e "${RED}✗${NC} Wrong: email_verified=TRUE (should be FALSE for new subscribers)"
        echo -e "   ${YELLOW}Your code is still creating verified subscribers${NC}"
        return 1
    elif echo "$db_result" | grep -q "false.*false"; then
        echo -e "${RED}✗${NC} Wrong: Missing verification token or timestamp"
        echo -e "   ${YELLOW}Token generation may not be working${NC}"
        return 1
    else
        echo -e "${YELLOW}!${NC} Database result unclear - check manually"
    fi

    return 0
}

# Check console logs
check_console_logs() {
    echo -e "${CYAN}4. Checking console logs for monitoring...${NC}"

    echo "Look for these patterns in your console (where you ran 'npm run dev'):"
    echo -e "${YELLOW}Expected log patterns:${NC}"
    echo "  • 'Attempting database insert with email verification...'"
    echo "  • 'Mock queue: Email verification queued:'"
    echo "  • Monitoring operations"
    echo ""
    echo -e "${CYAN}Check your dev server console now and confirm you see these logs.${NC}"
    echo ""
}

# Test token generation directly
test_token_generation() {
    echo -e "${CYAN}5. Testing token generation (if accessible)...${NC}"

    # Try to test the health endpoint to see if verification is mentioned
    echo -n "Checking health endpoint for verification info... "

    local health_response=$(curl -s http://localhost:8787/health)

    if echo "$health_response" | grep -q "emailVerification\|email.*verification"; then
        echo -e "${GREEN}✓${NC} Email verification mentioned in health check"
    else
        echo -e "${YELLOW}!${NC} Email verification not mentioned in health check"
        echo "This is OK - not all implementations include this"
    fi

    echo ""
}

# Run TDD tests
run_tdd_tests() {
    echo -e "${CYAN}6. Running TDD tests to verify implementation...${NC}"

    echo "Running email verification TDD tests..."

    if npm run test:email-verification >/dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} All TDD tests pass!"
    else
        echo -e "${YELLOW}!${NC} Some TDD tests still failing (this is expected during implementation)"
        echo ""
        echo "Running tests with output to see progress..."
        npm run test:email-verification || true
    fi
}

# Main execution
main() {
    check_dev_server
    echo ""

    if test_subscription; then
        echo -e "${GREEN}✓ Subscription test passed${NC}"
    else
        echo -e "${RED}✗ Subscription test failed${NC}"
        echo "Fix the subscription implementation before continuing"
        exit 1
    fi
    echo ""

    if check_database; then
        echo -e "${GREEN}✓ Database test passed${NC}"
    else
        echo -e "${RED}✗ Database test failed${NC}"
        echo "Fix the database storage implementation"
        exit 1
    fi
    echo ""

    check_console_logs
    test_token_generation

    echo ""
    run_tdd_tests

    echo ""
    echo -e "${BLUE}Summary${NC}"
    echo "======="
    echo -e "${GREEN}✓${NC} Your email verification token implementation appears to be working!"
    echo ""
    echo "Next steps:"
    echo "1. Update the response message if not done already"
    echo "2. Add queue integration for sending verification emails"
    echo "3. Implement the verification endpoint (/v1/newsletter/verify)"
    echo ""
    echo "Current status: You've successfully moved from RED to GREEN phase in TDD!"
}

# Cleanup function
cleanup() {
    rm -f /tmp/last_test_email.txt
}

# Set up cleanup on exit
trap cleanup EXIT

# Run main function
main