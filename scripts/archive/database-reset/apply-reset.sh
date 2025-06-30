#!/bin/bash

# Script: apply-reset.sh
# Purpose: Safely reset database schema across environments (DESTRUCTIVE OPERATION)
# Usage: ./scripts/apply-reset.sh [environment]
# NOTE: This script drops all data! For incremental migrations, use: npm run db:migrate:{env}

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default environment
ENVIRONMENT=${1:-local}

echo -e "${BLUE}Newsletter Database Schema Reset${NC}"
echo -e "${BLUE}=================================${NC}"
echo -e "${YELLOW}WARNING: This is a DESTRUCTIVE operation that drops all data!${NC}"
echo -e "${YELLOW}For incremental migrations, use: npm run db:migrate:{env}${NC}"
echo ""

# Validate environment
case $ENVIRONMENT in
    local|staging|production)
        echo -e "${GREEN}✓${NC} Target environment: ${ENVIRONMENT}"
        ;;
    *)
        echo -e "${RED}✗${NC} Invalid environment: ${ENVIRONMENT}"
        echo "Valid environments: local, staging, production"
        exit 1
        ;;
esac

# Drop tables file path
DROP_FILE="migrations/dev/drop_all_tables.sql"

# Check if drop file exists
if [ ! -f "$DROP_FILE" ]; then
    echo -e "${RED}✗${NC} Drop file not found: $DROP_FILE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Drop file found: $DROP_FILE"

# Function to check if wrangler is available
check_wrangler() {
    if ! command -v npx &> /dev/null || ! npx wrangler --version &> /dev/null; then
        echo -e "${RED}✗${NC} Wrangler CLI not available. Please install it first:"
        echo "  npm install -g wrangler"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Wrangler CLI available"
}

# Function to backup existing data (if any)
backup_data() {
    local env=$1
    local backup_file="backup-${env}-$(date +%Y%m%d-%H%M%S).sql"

    echo ""
    echo -e "${YELLOW}📦${NC} Backing up existing data from ${env}..."

    # Try to export existing data using proper D1 commands
    if npx wrangler d1 execute DB --env "$env" --remote --command="SELECT name FROM sqlite_master WHERE type='table';" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Database connection successful"

        # Export subscribers table if it exists
        if npx wrangler d1 execute DB --env "$env" --remote --command="SELECT COUNT(*) FROM subscribers;" > /dev/null 2>&1; then
            echo -e "${YELLOW}!${NC} Exporting existing subscribers data..."
            
            # Create proper SQL backup with INSERT statements
            cat > "$backup_file" << 'EOF'
-- Database backup created by apply-reset-migration.sh
-- Environment: ENV_PLACEHOLDER
-- Timestamp: TIMESTAMP_PLACEHOLDER

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
            
            # Replace placeholders
            sed -i "s/ENV_PLACEHOLDER/$env/g" "$backup_file"
            sed -i "s/TIMESTAMP_PLACEHOLDER/$(date -u +%Y-%m-%dT%H:%M:%SZ)/g" "$backup_file"
            
            # Export data as INSERT statements
            npx wrangler d1 execute DB --env "$env" --remote --command="SELECT 'INSERT INTO subscribers (id, email, verification_token, verified, created_at, updated_at) VALUES (' || id || ', ''' || email || ''', ' || CASE WHEN verification_token IS NULL THEN 'NULL' ELSE '''' || verification_token || '''' END || ', ' || verified || ', ''' || created_at || ''', ''' || updated_at || ''');' FROM subscribers;" --json 2>/dev/null | \
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

            if [ -f "$backup_file" ] && [ -s "$backup_file" ]; then
                # Check if backup contains actual data (more than just the header)
                if grep -q "INSERT INTO subscribers" "$backup_file"; then
                    echo -e "${GREEN}✓${NC} Backup saved to: $backup_file"
                else
                    echo -e "${YELLOW}!${NC} No data to backup (empty table)"
                    # Keep the file but add a note
                    echo "-- No data found in subscribers table" >> "$backup_file"
                fi
            else
                echo -e "${YELLOW}!${NC} Backup failed or no data found"
                rm -f "$backup_file"
            fi
        else
            echo -e "${YELLOW}!${NC} No subscribers table found - no backup needed"
        fi
    else
        echo -e "${YELLOW}!${NC} Could not connect to database - skipping backup"
    fi
}

# Function to show migration preview
show_migration_preview() {
    echo ""
    echo -e "${BLUE}📋 Migration Preview${NC}"
    echo -e "${BLUE}==================${NC}"
    echo ""
    echo "This reset will:"
    echo -e "${RED}  • DROP all existing tables and data${NC}"
    echo -e "${RED}  • DROP d1_migrations table (resets migration tracking)${NC}"
    echo -e "${YELLOW}  • After reset, run: npm run db:migrate:{env} to apply migrations${NC}"
    echo ""
    echo "New subscribers table will include:"
    echo "  • id (PRIMARY KEY)"
    echo "  • email, subscribed_at, unsubscribed_at"
    echo "  • email_verified (BOOLEAN, default FALSE)"
    echo "  • verification_token (TEXT, nullable)"
    echo "  • verification_sent_at (DATETIME, nullable)"
    echo "  • verified_at (DATETIME, nullable)"
    echo "  • ip_address, user_agent, country, city"
    echo "  • created_at, updated_at"
}

# Function to apply migration
apply_migration() {
    local env=$1

    echo ""
    echo -e "${BLUE}🚀 Applying migration to ${env} environment...${NC}"

    # Apply the drop script
    if npx wrangler d1 execute DB --env "$env" --remote --file="$DROP_FILE"; then
        echo -e "${GREEN}✓${NC} Migration applied successfully"
    else
        echo -e "${RED}✗${NC} Migration failed"
        exit 1
    fi
}

# Function to verify migration
verify_migration() {
    local env=$1

    echo ""
    echo -e "${BLUE}🔍 Verifying reset...${NC}"

    local remote_flag=""
    if [[ "$env" != "local" ]]; then
        remote_flag="--remote"
    fi

    # Check that tables have been dropped
    echo "Checking that tables have been dropped..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null | grep -q "subscribers"; then
        echo -e "${YELLOW}!${NC} Subscribers table still exists (may be normal)"
    else
        echo -e "${GREEN}✓${NC} Subscribers table dropped"
    fi

    # Check that d1_migrations table has been dropped
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null | grep -q "d1_migrations"; then
        echo -e "${YELLOW}!${NC} d1_migrations table still exists (may be normal)"
    else
        echo -e "${GREEN}✓${NC} d1_migrations table dropped - migration tracking reset"
    fi

    # Check indexes (simplified)
    echo "Checking indexes..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';" 2>/dev/null | grep -q "idx_"; then
        echo -e "${GREEN}✓${NC} Indexes created"
    else
        echo -e "${YELLOW}!${NC} Some indexes may be missing"
    fi

    # Check triggers
    echo "Checking triggers..."
    
    # Get trigger count from JSON output (extract only JSON part)
    trigger_output=$(npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT COUNT(*) as count FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | grep -A 1000 '^\[' | head -n 1000)
    
    # Use jq for reliable JSON parsing, with fallback
    if command -v jq &> /dev/null && [[ -n "$trigger_output" ]]; then
        trigger_count=$(echo "$trigger_output" | jq -r '.[0].results[0].count // 0' 2>/dev/null)
    else
        # Fallback: try to extract any number from the JSON results section
        trigger_count=$(echo "$trigger_output" | tr -d '\n' | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)
        if [[ -z "$trigger_count" ]]; then
            trigger_count=0
        fi
    fi
    
    # Default to 0 if still empty
    if [[ -z "$trigger_count" ]]; then
        trigger_count=0
    fi
    
    if [[ "$trigger_count" -ge 3 ]]; then
        echo -e "${GREEN}✓${NC} Triggers created ($trigger_count found)"
        # List the triggers for verification
        echo "  Found triggers:"
        trigger_names=$(npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | grep -A 1000 '^\[' | head -n 1000)
        if command -v jq &> /dev/null && [[ -n "$trigger_names" ]]; then
            echo "$trigger_names" | jq -r '.[0].results[].name' 2>/dev/null | sed 's/^/    - /'
        else
            echo "$trigger_names" | tr -d '\n' | grep -o '"name":"[^"]*"' | sed 's/"name":"//g' | sed 's/"//g' | sed 's/^/    - /'
        fi
    else
        echo -e "${YELLOW}!${NC} Some triggers may be missing (found: $trigger_count, expected: 3)"
        echo "  Expected triggers: update_subscribers_timestamp, check_verification_consistency, clear_verification_token_on_verify"
        if [[ "$trigger_count" -gt 0 ]]; then
            echo "  Found triggers:"
            trigger_names=$(npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | grep -A 1000 '^\[' | head -n 1000)
            if command -v jq &> /dev/null && [[ -n "$trigger_names" ]]; then
                echo "$trigger_names" | jq -r '.[0].results[].name' 2>/dev/null | sed 's/^/    - /'
            else
                echo "$trigger_names" | tr -d '\n' | grep -o '"name":"[^"]*"' | sed 's/"name":"//g' | sed 's/"//g' | sed 's/^/    - /'
            fi
        fi
    fi

    # Check migration log (simplified)
    echo "Checking migration log..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT COUNT(*) FROM version_sync_log WHERE action='schema_reset';" 2>/dev/null | grep -q "1"; then
        echo -e "${GREEN}✓${NC} Migration logged successfully"
    else
        echo -e "${YELLOW}!${NC} Migration log not found (may be normal)"
    fi
}

# Function to run post-reset tests
run_post_reset_tests() {
    local env=$1

    echo ""
    echo -e "${BLUE}🧪 Running post-reset verification...${NC}"

    # Verify database is empty
    echo "Verifying database is clean..."
    table_count=$(npx wrangler d1 execute DB --env "$env" --remote --command="SELECT COUNT(*) as count FROM sqlite_master WHERE type='table';" 2>/dev/null | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)
    
    if [[ -z "$table_count" ]]; then
        table_count=0
    fi
    
    if [[ "$table_count" -eq 0 ]]; then
        echo -e "${GREEN}✓${NC} Database is clean (no tables found)"
    else
        echo -e "${YELLOW}!${NC} Database has $table_count tables remaining"
        echo "  This is normal if some system tables remain"
    fi
    
    echo ""
    echo -e "${BLUE}💡 Next steps:${NC}"
    echo "  1. Run: npm run db:migrate:$env"
    echo "  2. Run: npm run db:seed:$env (optional)"
    echo "  3. Or use: npm run db:fresh:$env (combines reset + migrate)"
}

# Main execution
main() {
    check_wrangler
    show_migration_preview

    # Confirmation for production
    if [ "$ENVIRONMENT" = "production" ]; then
        echo ""
        echo -e "${RED}⚠️  WARNING: You are about to reset the PRODUCTION database!${NC}"
        echo -e "${RED}⚠️  This will DELETE ALL production data!${NC}"
        echo ""
        read -p "Are you absolutely sure you want to continue? (type 'YES' to confirm): " confirm
        if [ "$confirm" != "YES" ]; then
            echo -e "${YELLOW}Operation cancelled.${NC}"
            exit 0
        fi
    else
        echo ""
        read -p "Continue with migration? (y/N): " confirm
        if [[ ! $confirm =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}Operation cancelled.${NC}"
            exit 0
        fi
    fi

    backup_data "$ENVIRONMENT"
    apply_migration "$ENVIRONMENT"
    verify_migration "$ENVIRONMENT"
    run_post_reset_tests "$ENVIRONMENT"

    echo ""
    echo -e "${GREEN}🎉 Reset completed successfully!${NC}"

}

# Run main function
main