#!/bin/bash

# Script: setup-email-verification-scripts.sh
# Purpose: Make all email verification scripts executable and verify setup
# Usage: ./setup-email-verification-scripts.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Email Verification Scripts Setup${NC}"
echo -e "${BLUE}===============================${NC}"
echo ""

# Create scripts directory if it doesn't exist
if [ ! -d "scripts" ]; then
    echo -e "${YELLOW}Creating scripts directory...${NC}"
    mkdir -p scripts
fi

# Scripts to make executable
SCRIPTS=(
    "scripts/apply-reset-migration.sh"
    "scripts/verify-email-verification-schema.sh"
    "scripts/run-email-verification-tdd.sh"
    "scripts/setup-email-verification-scripts.sh"
)

echo "Making scripts executable:"
for script in "${SCRIPTS[@]}"; do
    if [ -f "$script" ]; then
        chmod +x "$script"
        echo -e "${GREEN}✓${NC} $script"
    else
        echo -e "${YELLOW}!${NC} $script (not found - you may need to create it)"
    fi
done

echo ""
echo -e "${BLUE}Verifying setup...${NC}"

# Check if migration file exists
if [ -f "migrations/003_reset_schema.sql" ]; then
    echo -e "${GREEN}✓${NC} Migration file: migrations/003_reset_schema.sql"
else
    echo -e "${RED}✗${NC} Migration file missing: migrations/003_reset_schema.sql"
fi

# Check if test files exist
TEST_FILES=(
    "tests/email-verification-migration.test.ts"
    "tests/subscription-with-verification.test.ts"
)

echo ""
echo "Test files:"
for test_file in "${TEST_FILES[@]}"; do
    if [ -f "$test_file" ]; then
        echo -e "${GREEN}✓${NC} $test_file"
    else
        echo -e "${YELLOW}!${NC} $test_file (not found - you may need to create it)"
    fi
done

echo ""
echo -e "${BLUE}Quick Start Guide${NC}"
echo "=================="
echo ""
echo "1. Reset database schema with email verification support:"
echo -e "   ${YELLOW}npm run db:reset:local${NC}"
echo ""
echo "2. Verify the schema is correct:"
echo -e "   ${YELLOW}npm run db:verify:local${NC}"
echo ""
echo "3. Run TDD test suite (tests should initially fail):"
echo -e "   ${YELLOW}npm run test:email-verification${NC}"
echo ""
echo "4. Watch mode for continuous testing during development:"
echo -e "   ${YELLOW}npm run test:email-verification:watch${NC}"
echo ""
echo "5. When ready for staging/production:"
echo -e "   ${YELLOW}npm run db:reset:staging${NC}"
echo -e "   ${YELLOW}npm run db:reset:production${NC}"
echo ""
echo -e "${GREEN}Setup complete!${NC} You're ready to implement email verification using TDD."