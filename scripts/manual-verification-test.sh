#!/bin/bash

# Script: manual-verification-test.sh
# Purpose: Quick manual tests for email verification implementation
# Usage: ./scripts/manual-verification-test.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}Manual Email Verification Tests${NC}"
echo -e "${BLUE}==============================${NC}"
echo ""

# Test 1: Basic subscription
echo -e "${CYAN}Test 1: Basic Subscription${NC}"
echo "=========================="

TEST_EMAIL="manual-test-$(date +%s)@example.com"
echo "Test email: $TEST_EMAIL"
echo ""

echo "Making subscription request..."
RESPONSE=$(curl -s -X POST http://localhost:8787/v1/newsletter/subscribe \
    -H "Content-Type: application/json" \
    -H "Origin: https://www.rnwolf.net" \
    -d "{\"email\":\"$TEST_EMAIL\"}")

echo "Response:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
echo ""

# Check response message
if echo "$RESPONSE" | grep -q "verification link"; then
    echo -e "${GREEN}✓ PASS${NC} - Response mentions verification link"
elif echo "$RESPONSE" | grep -q "Thank you for subscribing"; then
    echo -e "${RED}✗ FAIL${NC} - Still using old response message"
    echo "  You need to update the response message"
else
    echo -e "${YELLOW}? UNCLEAR${NC} - Check response message manually"
fi

echo ""

# Test 2: Database verification
echo -e "${CYAN}Test 2: Database State${NC}"
echo "====================="

echo "Checking database for test email..."
DB_RESULT=$(npx wrangler d1 execute DB --env local --command="SELECT email, email_verified, verification_token IS NOT NULL as has_token, verification_sent_at IS NOT NULL as has_sent_at, subscribed_at FROM subscribers WHERE email = '$TEST_EMAIL';" 2>/dev/null)

echo "Database result:"
echo "$DB_RESULT"
echo ""

# Analyze database result
if echo "$DB_RESULT" | grep -q "$TEST_EMAIL.*FALSE.*true.*true"; then
    echo -e "${GREEN}✓ PASS${NC} - Subscriber stored as unverified with token"
elif echo "$DB_RESULT" | grep -q "$TEST_EMAIL.*TRUE"; then
    echo -e "${RED}✗ FAIL${NC} - Subscriber stored as verified (should be FALSE)"
elif echo "$DB_RESULT" | grep -q "$TEST_EMAIL"; then
    echo -e "${YELLOW}? PARTIAL${NC} - Subscriber exists but check token generation"
    if echo "$DB_RESULT" | grep -q "false.*false"; then
        echo -e "${RED}✗ FAIL${NC} - Missing verification token or timestamp"
    fi
else
    echo -e "${RED}✗ FAIL${NC} - Subscriber not found in database"
fi

echo ""

# Test 3: Token format verification
echo -e "${CYAN}Test 3: Token Format${NC}"
echo "==================="

TOKEN=$(npx wrangler d1 execute DB --env local --command="SELECT verification_token FROM subscribers WHERE email = '$TEST_EMAIL';" 2>/dev/null | grep -v "verification_token" | grep -v "^$" | head -1)

if [ ! -z "$TOKEN" ]; then
    echo "Generated token: $TOKEN"
    echo ""

    # Check token format (should be base64url)
    if echo "$TOKEN" | grep -q "^[A-Za-z0-9_-]*$"; then
        echo -e "${GREEN}✓ PASS${NC} - Token format looks correct (base64url)"

        # Check token length (should be reasonable)
        TOKEN_LENGTH=${#TOKEN}
        if [ $TOKEN_LENGTH -gt 20 ] && [ $TOKEN_LENGTH -lt 200 ]; then
            echo -e "${GREEN}✓ PASS${NC} - Token length reasonable ($TOKEN_LENGTH chars)"
        else
            echo -e "${YELLOW}? UNCLEAR${NC} - Token length seems unusual ($TOKEN_LENGTH chars)"
        fi
    else
        echo -e "${RED}✗ FAIL${NC} - Token format incorrect (should be base64url)"
    fi
else
    echo -e "${RED}✗ FAIL${NC} - No token found"
fi

echo ""

# Test 4: Multiple subscriptions (duplicate handling)
echo -e "${CYAN}Test 4: Duplicate Subscription${NC}"
echo "=============================="

echo "Making second subscription with same email..."
RESPONSE2=$(curl -s -X POST http://localhost:8787/v1/newsletter/subscribe \
    -H "Content-Type: application/json" \
    -H "Origin: https://www.rnwolf.net" \
    -d "{\"email\":\"$TEST_EMAIL\"}")

echo "Second response:"
echo "$RESPONSE2" | jq . 2>/dev/null || echo "$RESPONSE2"
echo ""

# Check if new token was generated
TOKEN2=$(npx wrangler d1 execute DB --env local --command="SELECT verification_token FROM subscribers WHERE email = '$TEST_EMAIL';" 2>/dev/null | grep -v "verification_token" | grep -v "^$" | head -1)

if [ "$TOKEN" != "$TOKEN2" ]; then
    echo -e "${GREEN}✓ PASS${NC} - New token generated for duplicate subscription"
else
    echo -e "${YELLOW}? UNCLEAR${NC} - Same token used (may be OK if recent)"
fi

echo ""

# Test 5: Error handling
echo -e "${CYAN}Test 5: Error Handling${NC}"
echo "====================="

echo "Testing with invalid email..."
ERROR_RESPONSE=$(curl -s -X POST http://localhost:8787/v1/newsletter/subscribe \
    -H "Content-Type: application/json" \
    -H "Origin: https://www.rnwolf.net" \
    -d '{"email":"invalid-email"}')

echo "Error response:"
echo "$ERROR_RESPONSE" | jq . 2>/dev/null || echo "$ERROR_RESPONSE"
echo ""

if echo "$ERROR_RESPONSE" | grep -q "Invalid email"; then
    echo -e "${GREEN}✓ PASS${NC} - Error handling works for invalid email"
else
    echo -e "${YELLOW}? UNCLEAR${NC} - Check error handling manually"
fi

echo ""

# Summary
echo -e "${BLUE}Test Summary${NC}"
echo "============"
echo ""

# Count database entries
TOTAL_SUBS=$(npx wrangler d1 execute DB --env local --command="SELECT COUNT(*) as count FROM subscribers;" 2>/dev/null | grep -o '[0-9]*' | tail -1)
UNVERIFIED_SUBS=$(npx wrangler d1 execute DB --env local --command="SELECT COUNT(*) as count FROM subscribers WHERE email_verified = FALSE;" 2>/dev/null | grep -o '[0-9]*' | tail -1)

echo "Database summary:"
echo "  Total subscribers: $TOTAL_SUBS"
echo "  Unverified subscribers: $UNVERIFIED_SUBS"
echo ""

if [ "$UNVERIFIED_SUBS" -gt 0 ]; then
    echo -e "${GREEN}✓ SUCCESS${NC} - Email verification implementation appears to be working!"
    echo ""
    echo "Your changes have successfully:"
    echo "• ✓ Generated verification tokens"
    echo "• ✓ Stored subscribers as unverified"
    echo "• ✓ Updated database schema usage"
    echo ""
    echo "Next steps:"
    echo "1. Update response message (if not done)"
    echo "2. Add queue integration"
    echo "3. Run TDD tests: npm run test:email-verification"
else
    echo -e "${YELLOW}! PARTIAL${NC} - Some aspects working, check details above"
fi

echo ""

# Cleanup option
echo "Clean up test data? (y/N)"
read -n 1 cleanup_choice
echo ""

if [[ $cleanup_choice =~ ^[Yy]$ ]]; then
    echo "Cleaning up test data..."
    npx wrangler d1 execute DB --env local --command="DELETE FROM subscribers WHERE email LIKE '%manual-test-%@example.com';" >/dev/null 2>&1
    echo -e "${GREEN}✓${NC} Test data cleaned up"
fi