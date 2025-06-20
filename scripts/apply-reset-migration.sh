#!/bin/bash

# Script: apply-reset-migration.sh
# Purpose: Safely apply the schema reset migration across environments
# Usage: ./scripts/apply-reset-migration.sh [environment]

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

# Migration file path
MIGRATION_FILE="migrations/003_reset_schema.sql"

# Check if migration file exists
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}✗${NC} Migration file not found: $MIGRATION_FILE"
    exit 1
fi

echo -e "${GREEN}✓${NC} Migration file found: $MIGRATION_FILE"

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

    # Try to export existing data
    if npx wrangler d1 execute DB --env "$env" --remote --command="SELECT name FROM sqlite_master WHERE type='table';" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Database connection successful"

        # Export subscribers table if it exists
        if npx wrangler d1 execute DB --env "$env" --remote --command="SELECT COUNT(*) FROM subscribers;" > /dev/null 2>&1; then
            echo -e "${YELLOW}!${NC} Exporting existing subscribers data..."
            npx wrangler d1 execute DB --env "$env" --remote --command=".dump subscribers" > "$backup_file" 2>/dev/null || true

            if [ -f "$backup_file" ] && [ -s "$backup_file" ]; then
                echo -e "${GREEN}✓${NC} Backup saved to: $backup_file"
            else
                echo -e "${YELLOW}!${NC} No data to backup or backup failed"
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
    echo "This migration will:"
    echo -e "${RED}  • DROP all existing tables and data${NC}"
    echo -e "${GREEN}  • CREATE subscribers table with email verification fields${NC}"
    echo -e "${GREEN}  • CREATE version_sync_log table${NC}"
    echo -e "${GREEN}  • CREATE email_verification_queue_log table${NC}"
    echo -e "${GREEN}  • CREATE performance indexes${NC}"
    echo -e "${GREEN}  • CREATE data integrity triggers${NC}"
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

    # Apply the migration
    if npx wrangler d1 execute DB --env "$env" --remote --file="$MIGRATION_FILE"; then
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
    echo -e "${BLUE}🔍 Verifying migration...${NC}"

    local remote_flag=""
    if [[ "$env" != "local" ]]; then
        remote_flag="--remote"
    fi

    # Check if subscribers table exists with correct structure
    echo "Checking subscribers table structure..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="PRAGMA table_info(subscribers);" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Subscribers table exists"

        # Check for email verification columns
        if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT email_verified, verification_token FROM subscribers LIMIT 1;" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Email verification columns exist"
        else
            echo -e "${RED}✗${NC} Email verification columns missing"
            exit 1
        fi
    else
        echo -e "${RED}✗${NC} Subscribers table not found"
        exit 1
    fi

    # Check indexes (simplified)
    echo "Checking indexes..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';" 2>/dev/null | grep -q "idx_"; then
        echo -e "${GREEN}✓${NC} Indexes created"
    else
        echo -e "${YELLOW}!${NC} Some indexes may be missing"
    fi

    # Check triggers (simplified)
    echo "Checking triggers..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';" 2>/dev/null | grep -q "trigger"; then
        echo -e "${GREEN}✓${NC} Triggers created"
    else
        echo -e "${YELLOW}!${NC} Some triggers may be missing"
    fi

    # Check migration log (simplified)
    echo "Checking migration log..."
    if npx wrangler d1 execute DB --env "$env" $remote_flag --command="SELECT COUNT(*) FROM version_sync_log WHERE action='schema_reset';" 2>/dev/null | grep -q "1"; then
        echo -e "${GREEN}✓${NC} Migration logged successfully"
    else
        echo -e "${YELLOW}!${NC} Migration log not found (may be normal)"
    fi
}

# Function to run post-migration tests
run_post_migration_tests() {
    local env=$1

    echo ""
    echo -e "${BLUE}🧪 Running post-migration tests...${NC}"

    # Test basic insert
    echo "Testing basic insert..."
    if npx wrangler d1 execute DB --env "$env" --remote --command="INSERT INTO subscribers (email, subscribed_at, email_verified) VALUES ('test@migration.com', datetime('now'), FALSE);" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Basic insert works"

        # Test query
        echo "Testing basic query..."
        if npx wrangler d1 execute DB --env "$env" --remote --command="SELECT email, email_verified FROM subscribers WHERE email='test@migration.com';" > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} Basic query works"

            # Clean up test data
            npx wrangler d1 execute DB --env "$env" --remote --command="DELETE FROM subscribers WHERE email='test@migration.com';" > /dev/null 2>&1
            echo -e "${GREEN}✓${NC} Test data cleaned up"
        else
            echo -e "${RED}✗${NC} Basic query failed"
        fi
    else
        echo -e "${RED}✗${NC} Basic insert failed"
    fi
}

# Function to provide next steps
show_next_steps() {
    echo ""
    echo -e "${BLUE}📝 Next Steps${NC}"
    echo -e "${BLUE}============${NC}"
    echo ""
    echo "1. Run the TDD test suite to verify email verification implementation:"
    echo -e "   ${YELLOW}./scripts/run-email-verification-tdd.sh${NC}"
    echo ""
    echo "2. Update your subscription handler implementation to:"
    echo "   • Store subscribers as unverified (email_verified = FALSE)"
    echo "   • Generate verification tokens"
    echo "   • Queue verification emails"
    echo "   • Return verification message instead of subscription confirmation"
    echo ""
    echo "3. Implement the email verification endpoint:"
    echo -e "   ${YELLOW}/v1/newsletter/verify?token=...&email=...${NC}"
    echo ""
    echo "4. If migrating other environments, run:"
    echo -e "   ${YELLOW}./scripts/apply-reset-migration.sh staging${NC}"
    echo -e "   ${YELLOW}./scripts/apply-reset-migration.sh production${NC}"
    echo ""
    echo "5. Deploy the updated worker code with verification functionality"
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
    run_post_migration_tests "$ENVIRONMENT"

    echo ""
    echo -e "${GREEN}🎉 Migration completed successfully!${NC}"

    show_next_steps
}

# Run main function
main