#!/bin/bash

# Script: run-email-verification-tdd.sh
# Purpose: Run TDD test suite for email verification implementation
# Usage: ./scripts/run-email-verification-tdd.sh [--watch] [--verbose]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse command line arguments
WATCH_MODE=false
VERBOSE_MODE=false
BAIL_ON_FAIL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w)
            WATCH_MODE=true
            shift
            ;;
        --verbose|-v)
            VERBOSE_MODE=true
            shift
            ;;
        --bail|-b)
            BAIL_ON_FAIL=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --watch, -w     Run tests in watch mode"
            echo "  --verbose, -v   Enable verbose output"
            echo "  --bail, -b      Stop on first test failure"
            echo "  --help, -h      Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                    # Run tests once"
            echo "  $0 --watch            # Run in watch mode"
            echo "  $0 --verbose --bail   # Verbose with bail on failure"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Header
echo -e "${BLUE}Email Verification TDD Test Suite${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

# Environment check
if [ ! -f "package.json" ]; then
    echo -e "${RED}✗${NC} Not in project root directory (package.json not found)"
    exit 1
fi

if [ ! -f "migrations/003_reset_schema.sql" ]; then
    echo -e "${YELLOW}!${NC} Schema reset migration not found. Email verification may not work correctly."
    echo -e "   Consider running: ${CYAN}npm run db:reset:local${NC}"
fi

# Check if vitest is available
if ! npm list vitest >/dev/null 2>&1; then
    echo -e "${RED}✗${NC} Vitest not found. Installing dependencies..."
    npm install
fi

# Test files to run
EMAIL_VERIFICATION_TESTS=(
    "tests/email-verification-migration.test.ts"
    "tests/subscription-with-verification.test.ts"
)

# Function to run a single test file
run_test_file() {
    local test_file="$1"
    local test_name=$(basename "$test_file" .test.ts)

    echo -e "${CYAN}📝 Running: ${test_name}${NC}"
    echo "File: $test_file"

    if [ ! -f "$test_file" ]; then
        echo -e "${RED}✗${NC} Test file not found: $test_file"
        return 1
    fi

    local vitest_args=""
    if [ "$VERBOSE_MODE" = true ]; then
        vitest_args="$vitest_args --reporter=verbose"
    fi

    if [ "$BAIL_ON_FAIL" = true ]; then
        vitest_args="$vitest_args --bail=1"
    fi

    # Run the test
    if npx vitest run "$test_file" $vitest_args; then
        echo -e "${GREEN}✓${NC} $test_name passed"
        return 0
    else
        echo -e "${RED}✗${NC} $test_name failed"
        return 1
    fi
}

# Function to run all tests once
run_tests_once() {
    echo -e "${BLUE}🚀 Running Email Verification TDD Tests${NC}"
    echo ""

    local failed_tests=()
    local passed_tests=()

    for test_file in "${EMAIL_VERIFICATION_TESTS[@]}"; do
        echo ""
        if run_test_file "$test_file"; then
            passed_tests+=("$(basename "$test_file" .test.ts)")
        else
            failed_tests+=("$(basename "$test_file" .test.ts)")

            if [ "$BAIL_ON_FAIL" = true ]; then
                echo ""
                echo -e "${RED}❌ Stopping on first failure (--bail mode)${NC}"
                break
            fi
        fi
    done

    # Summary
    echo ""
    echo -e "${BLUE}📊 Test Summary${NC}"
    echo "==============="
    echo -e "Total tests: ${#EMAIL_VERIFICATION_TESTS[@]}"
    echo -e "${GREEN}Passed: ${#passed_tests[@]}${NC}"
    echo -e "${RED}Failed: ${#failed_tests[@]}${NC}"

    if [ ${#passed_tests[@]} -gt 0 ]; then
        echo ""
        echo -e "${GREEN}✓ Passed tests:${NC}"
        for test in "${passed_tests[@]}"; do
            echo -e "  ${GREEN}•${NC} $test"
        done
    fi

    if [ ${#failed_tests[@]} -gt 0 ]; then
        echo ""
        echo -e "${RED}✗ Failed tests:${NC}"
        for test in "${failed_tests[@]}"; do
            echo -e "  ${RED}•${NC} $test"
        done

        echo ""
        echo -e "${YELLOW}💡 TDD Implementation Guide:${NC}"
        echo ""
        echo "If tests are failing, this is expected in TDD RED phase!"
        echo ""
        echo "Next steps:"
        echo "1. Ensure database schema is up to date:"
        echo -e "   ${CYAN}npm run db:verify:local${NC}"
        echo ""
        echo "2. If schema is wrong, reset it:"
        echo -e "   ${CYAN}npm run db:reset:local${NC}"
        echo ""
        echo "3. Update subscription handler implementation:"
        echo "   • Change response message to mention email verification"
        echo "   • Store subscribers as unverified (email_verified = FALSE)"
        echo "   • Generate verification tokens"
        echo "   • Queue verification emails"
        echo ""
        echo "4. Run tests again to see progress:"
        echo -e "   ${CYAN}./scripts/run-email-verification-tdd.sh${NC}"

        return 1
    else
        echo ""
        echo -e "${GREEN}🎉 All email verification tests passed!${NC}"
        echo ""
        echo -e "${YELLOW}🚀 Ready for next phase:${NC}"
        echo "1. Implement email verification endpoint (/v1/newsletter/verify)"
        echo "2. Create email worker for sending verification emails"
        echo "3. Update newsletter sender to only send to verified subscribers"
        echo "4. Deploy to staging and production"

        return 0
    fi
}

# Function to run tests in watch mode
run_tests_watch() {
    echo -e "${BLUE}👀 Running Email Verification Tests in Watch Mode${NC}"
    echo ""
    echo "Watching files:"
    for test_file in "${EMAIL_VERIFICATION_TESTS[@]}"; do
        echo -e "  ${CYAN}•${NC} $test_file"
    done
    echo ""
    echo -e "${YELLOW}Press Ctrl+C to exit watch mode${NC}"
    echo ""

    # Build watch patterns
    local watch_patterns=""
    for test_file in "${EMAIL_VERIFICATION_TESTS[@]}"; do
        watch_patterns="$watch_patterns $test_file"
    done

    # Also watch source files
    watch_patterns="$watch_patterns src/**/*.ts"

    local vitest_args="--watch"
    if [ "$VERBOSE_MODE" = true ]; then
        vitest_args="$vitest_args --reporter=verbose"
    fi

    # Run vitest in watch mode
    npx vitest $vitest_args $watch_patterns
}

# Function to check prerequisites
check_prerequisites() {
    echo -e "${BLUE}🔍 Checking Prerequisites${NC}"
    echo "=========================="

    # Check Node.js
    if command -v node >/dev/null 2>&1; then
        local node_version=$(node --version)
        echo -e "${GREEN}✓${NC} Node.js: $node_version"
    else
        echo -e "${RED}✗${NC} Node.js not found"
        exit 1
    fi

    # Check npm
    if command -v npm >/dev/null 2>&1; then
        local npm_version=$(npm --version)
        echo -e "${GREEN}✓${NC} npm: v$npm_version"
    else
        echo -e "${RED}✗${NC} npm not found"
        exit 1
    fi

    # Check wrangler
    if npx wrangler --version >/dev/null 2>&1; then
        local wrangler_version=$(npx wrangler --version)
        echo -e "${GREEN}✓${NC} Wrangler: $wrangler_version"
    else
        echo -e "${RED}✗${NC} Wrangler not found"
        exit 1
    fi

    # Check test files exist
    echo ""
    echo "Checking test files:"
    for test_file in "${EMAIL_VERIFICATION_TESTS[@]}"; do
        if [ -f "$test_file" ]; then
            echo -e "${GREEN}✓${NC} $test_file"
        else
            echo -e "${RED}✗${NC} $test_file (missing)"
        fi
    done

    echo ""
}

# Function to show TDD guidance
show_tdd_guidance() {
    echo -e "${BLUE}📚 TDD Guidance for Email Verification${NC}"
    echo "======================================"
    echo ""
    echo -e "${YELLOW}Current Phase: RED → GREEN → REFACTOR${NC}"
    echo ""
    echo "🔴 RED Phase (Write Failing Tests):"
    echo "   • Tests define the expected behavior"
    echo "   • Tests should fail initially"
    echo "   • Focus on one requirement at a time"
    echo ""
    echo "🟢 GREEN Phase (Make Tests Pass):"
    echo "   • Write minimal code to make tests pass"
    echo "   • Don't worry about perfect code yet"
    echo "   • Focus on functionality over form"
    echo ""
    echo "🔵 REFACTOR Phase (Improve Code):"
    echo "   • Clean up code while keeping tests green"
    echo "   • Extract functions and classes"
    echo "   • Improve error handling"
    echo ""
    echo -e "${CYAN}Key Requirements Being Tested:${NC}"
    echo "1. Database schema supports email verification"
    echo "2. Subscription creates unverified users"
    echo "3. Verification tokens are generated correctly"
    echo "4. Queue integration works properly"
    echo "5. Response messages guide users correctly"
    echo ""
}

# Main execution
main() {
    check_prerequisites

    if [ "$WATCH_MODE" = true ]; then
        show_tdd_guidance
        run_tests_watch
    else
        show_tdd_guidance
        run_tests_once
    fi
}

# Handle Ctrl+C gracefully
trap 'echo -e "\n${YELLOW}Test execution interrupted.${NC}"; exit 130' INT

# Run main function
main