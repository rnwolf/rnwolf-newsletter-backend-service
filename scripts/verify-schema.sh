#!/bin/bash
# scripts/verify-schema.sh
# Verification script to ensure database schema is ready for verification features

set -e

ENVIRONMENT=${1:-local}

echo "🔍 Verifying database schema for $ENVIRONMENT environment..."
echo "============================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "success") echo -e "${GREEN}✅ $message${NC}" ;;
        "error") echo -e "${RED}❌ $message${NC}" ;;
        "warning") echo -e "${YELLOW}⚠️  $message${NC}" ;;
        "info") echo -e "${BLUE}ℹ️  $message${NC}" ;;
    esac
}

# Function to run SQL command based on environment
run_sql() {
    local sql=$1
    if [ "$ENVIRONMENT" = "local" ]; then
        npx wrangler d1 execute DB --env $ENVIRONMENT --command="$sql" 2>/dev/null
    else
        npx wrangler d1 execute DB --env $ENVIRONMENT --remote --command="$sql" 2>/dev/null
    fi
}

# Function to check if table exists
check_table_exists() {
    local table_name=$1
    local result=$(run_sql "SELECT name FROM sqlite_master WHERE type='table' AND name='$table_name';")

    if echo "$result" | grep -q "$table_name"; then
        print_status "success" "Table '$table_name' exists"
        return 0
    else
        print_status "error" "Table '$table_name' does not exist"
        return 1
    fi
}

# Function to check if column exists in table
check_column_exists() {
    local table_name=$1
    local column_name=$2
    local result=$(run_sql "PRAGMA table_info($table_name);")

    if echo "$result" | grep -q "$column_name"; then
        print_status "success" "Column '$table_name.$column_name' exists"
        return 0
    else
        print_status "error" "Column '$table_name.$column_name' does not exist"
        return 1
    fi
}

# Function to check if index exists
check_index_exists() {
    local index_name=$1
    local result=$(run_sql "SELECT name FROM sqlite_master WHERE type='index' AND name='$index_name';")

    if echo "$result" | grep -q "$index_name"; then
        print_status "success" "Index '$index_name' exists"
        return 0
    else
        print_status "error" "Index '$index_name' does not exist"
        return 1
    fi
}

# Function to get subscriber statistics
get_subscriber_stats() {
    local stats=$(run_sql "
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN email_verified = 0 THEN 1 ELSE 0 END) as unverified,
        SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as unsubscribed
    FROM subscribers;
    ")
    echo "$stats"
}

# Start verification process
print_status "info" "Starting database schema verification for environment: $ENVIRONMENT"
echo ""

# Check if base table exists
echo "📋 Checking base table structure..."
if ! check_table_exists "subscribers"; then
    print_status "error" "Base subscribers table missing. Run initial migration:"
    echo "  npm run db:migrate:$ENVIRONMENT"
    exit 1
fi

# Check base columns (from migration 001)
echo ""
echo "📊 Checking base columns..."
base_columns=("id" "email" "subscribed_at" "unsubscribed_at" "ip_address" "user_agent" "country" "city" "created_at" "updated_at")
base_missing=0

for column in "${base_columns[@]}"; do
    if ! check_column_exists "subscribers" "$column"; then
        base_missing=$((base_missing + 1))
    fi
done

if [ $base_missing -gt 0 ]; then
    print_status "error" "$base_missing base columns are missing. Run initial migration:"
    echo "  npm run db:migrate:$ENVIRONMENT"
    exit 1
fi

# Check verification columns (from migration 002)
echo ""
echo "🔐 Checking verification columns..."
verification_columns=("email_verified" "verification_token" "verification_sent_at" "verified_at")
verification_missing=0

for column in "${verification_columns[@]}"; do
    if ! check_column_exists "subscribers" "$column"; then
        verification_missing=$((verification_missing + 1))
    fi
done

if [ $verification_missing -gt 0 ]; then
    print_status "warning" "$verification_missing verification columns are missing. Run verification migration:"
    echo "  npm run db:migrate:verification:$ENVIRONMENT"
    echo ""
    print_status "info" "Verification features will not work until migration is run"
    VERIFICATION_READY=false
else
    VERIFICATION_READY=true
fi

# Check base indexes
echo ""
echo "📇 Checking base indexes..."
base_indexes=("idx_email" "idx_subscribed_at")
for index in "${base_indexes[@]}"; do
    check_index_exists "$index" || true  # Don't fail if missing, just warn
done

# Check verification indexes (only if verification columns exist)
if [ "$VERIFICATION_READY" = true ]; then
    echo ""
    echo "🔍 Checking verification indexes..."
    verification_indexes=("idx_verification_token" "idx_email_verified")
    for index in "${verification_indexes[@]}"; do
        check_index_exists "$index" || true  # Don't fail if missing, just warn
    done
fi

# Check data integrity
echo ""
echo "🔒 Checking data integrity..."

# Check for duplicate emails
duplicates=$(run_sql "SELECT COUNT(*) - COUNT(DISTINCT email) as duplicates FROM subscribers;")
duplicate_count=$(echo "$duplicates" | grep -o '[0-9]*' | tail -1)

if [ "$duplicate_count" -gt 0 ]; then
    print_status "warning" "Found $duplicate_count duplicate email entries"
else
    print_status "success" "No duplicate email addresses found"
fi

# Check subscriber statistics
echo ""
echo "📈 Subscriber Statistics:"
echo "========================"

if [ "$VERIFICATION_READY" = true ]; then
    stats=$(get_subscriber_stats)

    # Parse stats (this is a bit fragile but works for our format)
    total=$(echo "$stats" | grep -o '[0-9]*' | sed -n '1p')
    verified=$(echo "$stats" | grep -o '[0-9]*' | sed -n '2p')
    unverified=$(echo "$stats" | grep -o '[0-9]*' | sed -n '3p')
    unsubscribed=$(echo "$stats" | grep -o '[0-9]*' | sed -n '4p')

    echo "  Total subscribers: $total"
    echo "  Verified: $verified"
    echo "  Unverified: $unverified"
    echo "  Unsubscribed: $unsubscribed"

    # Calculate verification rate
    if [ "$total" -gt 0 ]; then
        active_total=$((total - unsubscribed))
        if [ "$active_total" -gt 0 ]; then
            verification_rate=$((verified * 100 / active_total))
            echo "  Verification rate: $verification_rate%"

            if [ "$verification_rate" -lt 50 ] && [ "$ENVIRONMENT" = "production" ]; then
                print_status "warning" "Low verification rate in production: $verification_rate%"
            fi
        fi
    fi

    # Check for old unverified subscriptions (potential issue)
    if [ "$unverified" -gt 0 ]; then
        old_unverified=$(run_sql "
        SELECT COUNT(*)
        FROM subscribers
        WHERE email_verified = 0
          AND verification_sent_at < datetime('now', '-7 days')
          AND unsubscribed_at IS NULL;
        ")
        old_count=$(echo "$old_unverified" | grep -o '[0-9]*' | tail -1)

        if [ "$old_count" -gt 0 ]; then
            print_status "warning" "Found $old_count unverified subscriptions older than 7 days"
        fi
    fi
else
    # Basic stats without verification columns
    basic_stats=$(run_sql "SELECT COUNT(*) as total, SUM(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 ELSE 0 END) as unsubscribed FROM subscribers;")
    total=$(echo "$basic_stats" | grep -o '[0-9]*' | sed -n '1p')
    unsubscribed=$(echo "$basic_stats" | grep -o '[0-9]*' | sed -n '2p')
    active=$((total - unsubscribed))

    echo "  Total subscribers: $total"
    echo "  Active subscribers: $active"
    echo "  Unsubscribed: $unsubscribed"
fi

# Final summary
echo ""
echo "📋 Schema Verification Summary:"
echo "==============================="

if [ "$VERIFICATION_READY" = true ]; then
    print_status "success" "Database schema is ready for verification features!"
    echo ""
    echo "✅ Next steps:"
    echo "  1. Develop verification endpoints"
    echo "  2. Test verification flow: npm run test:verification"
    echo "  3. Deploy with feature flag: VERIFICATION_ENABLED=false"
    echo "  4. Gradually enable verification feature"
else
    print_status "warning" "Database schema needs verification migration"
    echo ""
    echo "🔧 Required actions:"
    echo "  1. Run verification migration: npm run db:migrate:verification:$ENVIRONMENT"
    echo "  2. Re-run schema verification: npm run db:verify:schema $ENVIRONMENT"
    echo "  3. Develop verification features"
fi

echo ""
print_status "info" "Schema verification completed for $ENVIRONMENT environment"

# Exit with appropriate code
if [ "$VERIFICATION_READY" = true ]; then
    exit 0
else
    exit 1
fi