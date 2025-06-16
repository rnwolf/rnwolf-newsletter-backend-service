#!/bin/bash

# Script: simple-schema-check.sh
# Purpose: Simple verification that email verification schema is in place
# Usage: ./scripts/simple-schema-check.sh [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-local}

echo -e "${BLUE}Simple Email Verification Schema Check${NC}"
echo -e "${BLUE}=====================================${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo ""

# Set remote flag based on environment
REMOTE_FLAG=""
if [[ "$ENVIRONMENT" != "local" ]]; then
    REMOTE_FLAG="--remote"
fi

# Function to run SQL command
run_check() {
    local description="$1"
    local sql="$2"

    echo -n "✓ $description... "

    if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="$sql" >/dev/null 2>&1; then
        echo -e "${GREEN}OK${NC}"
        return 0
    else
        echo -e "${RED}FAILED${NC}"
        return 1
    fi
}

echo -e "${BLUE}Core Schema Checks${NC}"
echo "=================="

# Basic table checks
run_check "Subscribers table exists" "SELECT name FROM sqlite_master WHERE type='table' AND name='subscribers';"
run_check "Version sync log table exists" "SELECT name FROM sqlite_master WHERE type='table' AND name='version_sync_log';"

echo ""
echo -e "${BLUE}Email Verification Column Checks${NC}"
echo "================================="

# Check for email verification columns by trying to select them
run_check "email_verified column exists" "SELECT email_verified FROM subscribers LIMIT 1;"
run_check "verification_token column exists" "SELECT verification_token FROM subscribers LIMIT 1;"
run_check "verification_sent_at column exists" "SELECT verification_sent_at FROM subscribers LIMIT 1;"
run_check "verified_at column exists" "SELECT verified_at FROM subscribers LIMIT 1;"

echo ""
echo -e "${BLUE}Basic Functionality Tests${NC}"
echo "========================="

# Test inserting an unverified subscriber
TEST_EMAIL="schema-test-$(date +%s)@example.com"

run_check "Can insert unverified subscriber" "INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token, verification_sent_at) VALUES ('$TEST_EMAIL', datetime('now'), FALSE, 'test_token_123', datetime('now'));"

run_check "Can query unverified subscribers" "SELECT email FROM subscribers WHERE email_verified = FALSE AND email = '$TEST_EMAIL';"

run_check "Can update to verified" "UPDATE subscribers SET email_verified = TRUE, verified_at = datetime('now') WHERE email = '$TEST_EMAIL';"

run_check "Can query verified subscribers" "SELECT email FROM subscribers WHERE email_verified = TRUE AND email = '$TEST_EMAIL';"

# Newsletter query test
run_check "Newsletter recipient query works" "SELECT email FROM subscribers WHERE email_verified = TRUE AND unsubscribed_at IS NULL;"

# Cleanup
run_check "Can cleanup test data" "DELETE FROM subscribers WHERE email = '$TEST_EMAIL';"

echo ""
echo -e "${BLUE}Index and Object Summary${NC}"
echo "========================"

echo "Database objects found:"
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT type, name FROM sqlite_master ORDER BY type, name;" 2>/dev/null || echo "Could not retrieve object list"

echo ""
echo -e "${GREEN}🎉 Schema verification complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Run TDD tests: ${YELLOW}npm run test:email-verification${NC}"
echo "2. Update subscription handler to create unverified users"
echo "3. Implement verification endpoint"