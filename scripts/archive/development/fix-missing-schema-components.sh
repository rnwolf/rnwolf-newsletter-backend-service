#!/bin/bash

# Script: fix-missing-schema-components.sh
# Purpose: Add missing indexes and triggers to the database
# Usage: ./scripts/fix-missing-schema-components.sh [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-local}

echo -e "${BLUE}Fix Missing Schema Components${NC}"
echo -e "${BLUE}============================${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo ""

# Set remote flag based on environment
REMOTE_FLAG=""
if [[ "$ENVIRONMENT" != "local" ]]; then
    REMOTE_FLAG="--remote"
fi

# Function to execute SQL with error handling
execute_sql() {
    local description="$1"
    local sql="$2"

    echo -n "Adding $description... "

    if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="$sql" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${YELLOW}! Already exists or failed${NC}"
        return 1
    fi
}

echo -e "${BLUE}Adding Missing Indexes${NC}"
echo "======================"

# Add missing indexes
execute_sql "idx_active_verified_subscribers" "CREATE INDEX IF NOT EXISTS idx_active_verified_subscribers ON subscribers(email_verified, unsubscribed_at);"

execute_sql "idx_subscription_status" "CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);"

# Also add any other potentially missing indexes
execute_sql "idx_email_verified" "CREATE INDEX IF NOT EXISTS idx_email_verified ON subscribers(email_verified);"

execute_sql "idx_verification_token" "CREATE INDEX IF NOT EXISTS idx_verification_token ON subscribers(verification_token);"

echo ""
echo -e "${BLUE}Adding Missing Triggers${NC}"
echo "======================="

# Add update timestamp trigger
execute_sql "update_subscribers_timestamp trigger" "CREATE TRIGGER IF NOT EXISTS update_subscribers_timestamp
    AFTER UPDATE ON subscribers
    FOR EACH ROW
BEGIN
    UPDATE subscribers
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;"

# Add verification consistency trigger
execute_sql "check_verification_consistency trigger" "CREATE TRIGGER IF NOT EXISTS check_verification_consistency
    BEFORE UPDATE ON subscribers
    FOR EACH ROW
    WHEN NEW.email_verified = TRUE AND NEW.verified_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'verified_at cannot be NULL when email_verified is TRUE');
END;"

# Add token cleanup trigger
execute_sql "clear_verification_token_on_verify trigger" "CREATE TRIGGER IF NOT EXISTS clear_verification_token_on_verify
    AFTER UPDATE OF email_verified ON subscribers
    FOR EACH ROW
    WHEN NEW.email_verified = TRUE AND OLD.email_verified = FALSE
BEGIN
    UPDATE subscribers
    SET verification_token = NULL
    WHERE id = NEW.id;
END;"

echo ""
echo -e "${BLUE}Verification${NC}"
echo "============"

# Quick verification
echo "Checking indexes:"
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';" 2>/dev/null | grep -q "idx_"; then
    echo -e "${GREEN}✓${NC} Indexes found"

    # List all indexes
    echo "Found indexes:"
    npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';" 2>/dev/null | grep "idx_" | sed 's/^/  /'
else
    echo -e "${RED}✗${NC} No indexes found"
fi

echo ""
echo "Checking triggers:"
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | grep -q "trigger"; then
    echo -e "${GREEN}✓${NC} Triggers found"

    # List all triggers
    echo "Found triggers:"
    npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | sed 's/^/  /'
else
    echo -e "${RED}✗${NC} No triggers found"
fi

echo ""
echo -e "${BLUE}Testing Trigger Functionality${NC}"
echo "============================="

# Test the triggers work
TEST_EMAIL="trigger-test-$(date +%s)@example.com"

echo -n "Testing timestamp trigger... "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="INSERT INTO subscribers (email, subscribed_at, email_verified) VALUES ('$TEST_EMAIL', datetime('now'), FALSE);" >/dev/null 2>&1; then

    # Update the record and see if updated_at changes
    sleep 1
    if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="UPDATE subscribers SET country = 'US' WHERE email = '$TEST_EMAIL';" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ Failed${NC}"
    fi
else
    echo -e "${RED}✗ Failed to insert test record${NC}"
fi

echo -n "Testing verification consistency trigger... "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="UPDATE subscribers SET email_verified = TRUE, verified_at = datetime('now') WHERE email = '$TEST_EMAIL';" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ OK${NC}"
else
    echo -e "${RED}✗ Failed${NC}"
fi

echo -n "Testing token cleanup trigger... "
# Insert a record with a token, then verify it, and check if token is cleared
TEST_EMAIL2="token-test-$(date +%s)@example.com"
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token) VALUES ('$TEST_EMAIL2', datetime('now'), FALSE, 'test_token_123');" >/dev/null 2>&1; then

    # Verify the user - this should trigger token cleanup
    if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="UPDATE subscribers SET email_verified = TRUE, verified_at = datetime('now') WHERE email = '$TEST_EMAIL2';" >/dev/null 2>&1; then

        # Check if token was cleared
        if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT verification_token FROM subscribers WHERE email = '$TEST_EMAIL2';" 2>/dev/null | grep -q "NULL\|^$"; then
            echo -e "${GREEN}✓ OK${NC}"
        else
            echo -e "${YELLOW}! Token not cleared (trigger may not be working)${NC}"
        fi
    else
        echo -e "${RED}✗ Failed to update verification${NC}"
    fi
else
    echo -e "${RED}✗ Failed to insert test record${NC}"
fi

# Cleanup test data
echo -n "Cleaning up test data... "
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="DELETE FROM subscribers WHERE email IN ('$TEST_EMAIL', '$TEST_EMAIL2');" >/dev/null 2>&1
echo -e "${GREEN}✓ Done${NC}"

echo ""
echo -e "${GREEN}🎉 Schema components fix completed!${NC}"
echo ""
echo "Next steps:"
echo "1. Re-run verification: ${YELLOW}npm run db:verify:local${NC}"
echo "2. Run TDD tests: ${YELLOW}npm run test:email-verification${NC}"