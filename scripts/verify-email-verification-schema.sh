#!/bin/bash

# Script: verify-email-verification-schema.sh
# Purpose: Verify that the database schema is correctly set up for email verification
# Usage: ./scripts/verify-email-verification-schema.sh [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT=${1:-local}

echo -e "${BLUE}Email Verification Schema Verification${NC}"
echo -e "${BLUE}=====================================${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo ""

# Function to run SQL and capture output
run_sql() {
    local sql="$1"
    local description="$2"

    echo -n "Checking $description... "

    if [ "$ENVIRONMENT" = "local" ]; then
        # For local environment, we need to handle differently
        local result=$(npx wrangler d1 execute DB --env local --command="$sql" 2>/dev/null || echo "ERROR")
    else
        local result=$(npx wrangler d1 execute DB --env "$ENVIRONMENT" --remote --command="$sql" 2>/dev/null || echo "ERROR")
    fi

    if [[ "$result" == *"ERROR"* ]] || [[ -z "$result" ]]; then
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    else
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    fi
}

# Function to check table structure
check_table_structure() {
    echo ""
    echo -e "${BLUE}📋 Table Structure Verification${NC}"
    echo "================================"

    # Check if subscribers table exists
    if run_sql "SELECT name FROM sqlite_master WHERE type='table' AND name='subscribers';" "subscribers table exists"; then

        # Check required columns exist
        local columns=(
            "email"
            "subscribed_at"
            "unsubscribed_at"
            "email_verified"
            "verification_token"
            "verification_sent_at"
            "verified_at"
            "ip_address"
            "user_agent"
            "country"
            "city"
            "created_at"
            "updated_at"
        )

        echo ""
        echo "Checking required columns:"
        for col in "${columns[@]}"; do
            if run_sql "PRAGMA table_info(subscribers);" "column $col" | grep -q "$col" 2>/dev/null; then
                echo -e "  ${GREEN}✓${NC} $col"
            else
                # More thorough check
                if run_sql "SELECT $col FROM subscribers LIMIT 1;" "column $col" >/dev/null 2>&1; then
                    echo -e "  ${GREEN}✓${NC} $col"
                else
                    echo -e "  ${RED}✗${NC} $col - MISSING"
                fi
            fi
        done

    else
        echo -e "${RED}✗ Subscribers table does not exist!${NC}"
        return 1
    fi
}

# Function to check indexes
check_indexes() {
    echo ""
    echo -e "${BLUE}📇 Index Verification${NC}"
    echo "===================="

    local required_indexes=(
        "idx_email"
        "idx_subscribed_at"
        "idx_email_verified"
        "idx_verification_token"
        "idx_active_verified_subscribers"
        "idx_subscription_status"
    )

    local remote_flag=""
    if [[ "$ENVIRONMENT" != "local" ]]; then
        remote_flag="--remote"
    fi

    for idx in "${required_indexes[@]}"; do
        echo -n "Checking index $idx... "
        if npx wrangler d1 execute DB --env "$ENVIRONMENT" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='index' AND name='$idx';" 2>/dev/null | grep -q "$idx"; then
            echo -e "${GREEN}✓ OK${NC}"
        else
            echo -e "${YELLOW}! Missing (may be optional)${NC}"
        fi
    done
}

# Function to check other tables
check_other_tables() {
    echo ""
    echo -e "${BLUE}📑 Additional Tables${NC}"
    echo "==================="

    run_sql "SELECT name FROM sqlite_master WHERE type='table' AND name='version_sync_log';" "version_sync_log table"
    run_sql "SELECT name FROM sqlite_master WHERE type='table' AND name='email_verification_queue_log';" "email_verification_queue_log table"
}

# Function to check if triggers
check_triggers() {
    echo ""
    echo -e "${BLUE}⚡ Trigger Verification${NC}"
    echo "====================="

    local triggers=(
        "update_subscribers_timestamp"
        "check_verification_consistency"
        "clear_verification_token_on_verify"
    )

    local remote_flag=""
    if [[ "$ENVIRONMENT" != "local" ]]; then
        remote_flag="--remote"
    fi

    for trigger in "${triggers[@]}"; do
        echo -n "Checking trigger $trigger... "
        if npx wrangler d1 execute DB --env "$ENVIRONMENT" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='trigger' AND name='$trigger';" 2>/dev/null | grep -q "$trigger"; then
            echo -e "${GREEN}✓ OK${NC}"
        else
            echo -e "${YELLOW}! Missing (may be optional)${NC}"
        fi
    done
}

# Function to test email verification workflow
test_verification_workflow() {
    echo ""
    echo -e "${BLUE}🧪 Email Verification Workflow Test${NC}"
    echo "==================================="

    local test_email="schema-test-$(date +%s)@example.com"
    local test_token="test_token_$(date +%s)"

    echo "Testing with email: $test_email"

    # Test 1: Insert unverified subscriber
    echo -n "1. Insert unverified subscriber... "
    if run_sql "INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token, verification_sent_at) VALUES ('$test_email', datetime('now'), FALSE, '$test_token', datetime('now'));" "insert unverified"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi

    # Test 2: Query unverified subscriber
    echo -n "2. Query unverified subscriber... "
    if run_sql "SELECT email FROM subscribers WHERE email='$test_email' AND email_verified=FALSE;" "query unverified"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi

    # Test 3: Update to verified
    echo -n "3. Update to verified status... "
    if run_sql "UPDATE subscribers SET email_verified=TRUE, verified_at=datetime('now') WHERE email='$test_email';" "update verified"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi

    # Test 4: Query verified subscriber
    echo -n "4. Query verified subscriber... "
    if run_sql "SELECT email FROM subscribers WHERE email='$test_email' AND email_verified=TRUE;" "query verified"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi

    # Test 5: Newsletter recipient query
    echo -n "5. Newsletter recipient query... "
    if run_sql "SELECT email FROM subscribers WHERE email_verified=TRUE AND unsubscribed_at IS NULL;" "newsletter query"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${RED}✗ FAILED${NC}"
        return 1
    fi

    # Cleanup
    echo -n "6. Cleanup test data... "
    if run_sql "DELETE FROM subscribers WHERE email='$test_email';" "cleanup"; then
        echo -e "${GREEN}✓ OK${NC}"
    else
        echo -e "${YELLOW}! Could not cleanup${NC}"
    fi

    echo ""
    echo -e "${GREEN}🎉 Email verification workflow test completed successfully!${NC}"
}

# Function to show schema summary
show_schema_summary() {
    echo ""
    echo -e "${BLUE}📊 Schema Summary${NC}"
    echo "================="

    # Count tables (using a simpler approach without --output json)
    echo "Querying database objects..."
    local remote_flag=""
    if [[ "$ENVIRONMENT" != "local" ]]; then
        remote_flag="--remote"
    fi

    # Show table details using a single query
    echo ""
    echo "Database objects:"
    npx wrangler d1 execute DB --env "$ENVIRONMENT" $remote_flag --command="SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') ORDER BY type, name;" 2>/dev/null || echo "Could not retrieve database details"
}

# Function to provide recommendations
show_recommendations() {
    echo ""
    echo -e "${BLUE}💡 Recommendations${NC}"
    echo "=================="
    echo ""
    echo "✅ Schema verification complete! Your database is ready for email verification."
    echo ""
    echo "Next steps:"
    echo "1. Run the TDD test suite:"
    echo -e "   ${YELLOW}./scripts/run-email-verification-tdd.sh${NC}"
    echo ""
    echo "2. Update your subscription worker to use the new schema:"
    echo "   • Set email_verified = FALSE for new subscriptions"
    echo "   • Generate verification_token"
    echo "   • Set verification_sent_at timestamp"
    echo "   • Queue verification email"
    echo ""
    echo "3. Implement email verification endpoint:"
    echo -e "   ${YELLOW}GET /v1/newsletter/verify?token=...&email=...${NC}"
    echo ""
    echo "4. Update newsletter sender script to only send to verified subscribers:"
    echo -e "   ${YELLOW}WHERE email_verified = TRUE AND unsubscribed_at IS NULL${NC}"
    echo ""
    echo "5. If this is staging/production, deploy the updated worker code"
}

# Main execution
main() {
    echo "Starting schema verification for $ENVIRONMENT environment..."
    echo ""

    # Run all checks
    local failed=0

    check_table_structure || failed=1
    check_indexes || failed=1
    check_other_tables || failed=1
    check_triggers || failed=1
    test_verification_workflow || failed=1
    show_schema_summary

    echo ""
    if [ $failed -eq 0 ]; then
        echo -e "${GREEN}🎉 All schema verification checks passed!${NC}"
        show_recommendations
    else
        echo -e "${RED}❌ Some schema verification checks failed.${NC}"
        echo ""
        echo "This likely means:"
        echo "1. The migration hasn't been applied yet"
        echo "2. The migration was partially applied"
        echo "3. The database is in an inconsistent state"
        echo ""
        echo "Recommended action:"
        echo -e "${YELLOW}./scripts/apply-reset-migration.sh $ENVIRONMENT${NC}"
        exit 1
    fi
}

# Run main function
main