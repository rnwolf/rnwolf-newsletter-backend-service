#!/bin/bash

# Script: inspect-database-schema.sh
# Purpose: Detailed inspection of the current database schema
# Usage: ./scripts/inspect-database-schema.sh [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

ENVIRONMENT=${1:-local}

echo -e "${BLUE}Database Schema Inspection${NC}"
echo -e "${BLUE}=========================${NC}"
echo -e "Environment: ${YELLOW}${ENVIRONMENT}${NC}"
echo ""

# Set remote flag based on environment
REMOTE_FLAG=""
if [[ "$ENVIRONMENT" != "local" ]]; then
    REMOTE_FLAG="--remote"
fi

# Function to run SQL and show results
show_query_results() {
    local description="$1"
    local sql="$2"

    echo -e "${CYAN}$description${NC}"
    echo "$(printf '=%.0s' {1..50})"

    npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="$sql" 2>/dev/null || echo "Query failed or returned no results"
    echo ""
}

# 1. Show all database objects
show_query_results "All Database Objects" "SELECT type, name FROM sqlite_master ORDER BY type, name;"

# 2. Show subscribers table structure
show_query_results "Subscribers Table Structure" "PRAGMA table_info(subscribers);"

# 3. Show subscribers table creation SQL
show_query_results "Subscribers Table Creation SQL" "SELECT sql FROM sqlite_master WHERE type='table' AND name='subscribers';"

# 4. Show all indexes
show_query_results "All Indexes" "SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name;"

# 5. Show all triggers
show_query_results "All Triggers" "SELECT name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name;"

# 6. Show indexes specifically for subscribers table
show_query_results "Indexes for Subscribers Table" "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';"

# 7. Show triggers specifically for subscribers table
show_query_results "Triggers for Subscribers Table" "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';"

# 8. Show version_sync_log table if it exists
echo -e "${CYAN}Version Sync Log Table${NC}"
echo "$(printf '=%.0s' {1..50})"
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT name FROM sqlite_master WHERE type='table' AND name='version_sync_log';" 2>/dev/null | grep -q "version_sync_log"; then
    echo "Table exists. Structure:"
    npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="PRAGMA table_info(version_sync_log);" 2>/dev/null || echo "Could not get table info"

    echo ""
    echo "Recent migration entries:"
    npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT action, api_version, timestamp FROM version_sync_log ORDER BY timestamp DESC LIMIT 5;" 2>/dev/null || echo "No entries found"
else
    echo "Table does not exist"
fi
echo ""

# 9. Sample data from subscribers table
echo -e "${CYAN}Sample Subscribers Data${NC}"
echo "$(printf '=%.0s' {1..50})"
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT COUNT(*) as total_subscribers FROM subscribers;" 2>/dev/null || echo "Could not count subscribers"
echo ""
echo "Sample records (if any):"
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT email, email_verified, verification_token IS NOT NULL as has_token, subscribed_at FROM subscribers LIMIT 3;" 2>/dev/null || echo "No sample data available"
echo ""

# 10. Check for common issues
echo -e "${CYAN}Schema Validation${NC}"
echo "$(printf '=%.0s' {1..50})"

# Check if email_verified column exists and has correct type
echo -n "email_verified column: "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT email_verified FROM subscribers LIMIT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Exists${NC}"
else
    echo -e "${RED}✗ Missing${NC}"
fi

# Check if verification_token column exists
echo -n "verification_token column: "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT verification_token FROM subscribers LIMIT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Exists${NC}"
else
    echo -e "${RED}✗ Missing${NC}"
fi

# Check if verification_sent_at column exists
echo -n "verification_sent_at column: "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT verification_sent_at FROM subscribers LIMIT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Exists${NC}"
else
    echo -e "${RED}✗ Missing${NC}"
fi

# Check if verified_at column exists
echo -n "verified_at column: "
if npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT verified_at FROM subscribers LIMIT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Exists${NC}"
else
    echo -e "${RED}✗ Missing${NC}"
fi

echo ""

# 11. Test email verification workflow query
echo -e "${CYAN}Email Verification Workflow Test${NC}"
echo "$(printf '=%.0s' {1..50})"

echo "Testing query for newsletter recipients (verified users):"
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT COUNT(*) as verified_subscribers FROM subscribers WHERE email_verified = TRUE AND unsubscribed_at IS NULL;" 2>/dev/null || echo "Query failed - email verification columns may be missing"

echo ""
echo "Testing query for unverified users:"
npx wrangler d1 execute DB --env "$ENVIRONMENT" $REMOTE_FLAG --command="SELECT COUNT(*) as unverified_subscribers FROM subscribers WHERE email_verified = FALSE;" 2>/dev/null || echo "Query failed - email verification columns may be missing"

echo ""
echo -e "${GREEN}📋 Schema inspection complete!${NC}"
echo ""
echo -e "${YELLOW}If you see missing columns or indexes, run:${NC}"
echo -e "  ${CYAN}./scripts/fix-missing-schema-components.sh $ENVIRONMENT${NC}"