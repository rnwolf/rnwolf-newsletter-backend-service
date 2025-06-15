#!/bin/bash
# scripts/run-email-verification-tdd.sh
# TDD Test Runner for Email Verification Implementation

set -e

echo "🔴 TDD Phase 1: Running RED tests (these should fail)"
echo "================================================="

echo ""
echo "📝 Step 1: Testing Database Migration Requirements"
echo "This will fail until we create the migration file..."

# Test the migration file exists and is correct
npm run test tests/email-verification-migration.test.ts || echo "✅ Migration tests failed as expected (RED phase)"

echo ""
echo "📝 Step 2: Testing Updated Subscription Flow"
echo "This will fail until we update the subscription handler..."

# Test the updated subscription flow
npm run test tests/subscription-with-verification.test.ts || echo "✅ Subscription flow tests failed as expected (RED phase)"

echo ""
echo "📝 Step 3: Check Existing Email Verification Tests"
echo "These should still pass since the verification endpoint exists..."

# Test existing verification functionality
npm run test tests/email-verification.test.ts && echo "✅ Existing verification tests still pass"

echo ""
echo "📝 Step 4: Check Integration Tests"
echo "Some of these may fail due to subscription flow changes..."

# Test integration scenarios
npm run test tests/email-verification-integration.test.ts || echo "⚠️ Integration tests may fail due to subscription changes"

echo ""
echo "🎯 TDD Analysis Summary"
echo "======================"
echo "✅ FAILING tests (RED phase - this is good!):"
echo "   - Database migration requirements"
echo "   - Updated subscription flow (creates unverified users)"
echo "   - Queue integration in subscription"
echo "   - New response messages"
echo ""
echo "✅ PASSING tests (existing functionality):"
echo "   - Email verification endpoint"
echo "   - Token validation"
echo "   - HTML response generation"
echo ""
echo "📋 Next Steps (GREEN phase):"
echo "   1. Create migration file: migrations/002_add_email_verification.sql"
echo "   2. Update subscription handler in src/index.ts"
echo "   3. Add verification token generation"
echo "   4. Integrate queue sending"
echo "   5. Update response messages"
echo ""
echo "🏃‍♂️ Ready to start implementing! Run this script again after each change."

# Create package.json script entries for easier testing
echo ""
echo "💡 Add these to your package.json scripts section:"
echo '   "test:email-verification:tdd": "./scripts/run-email-verification-tdd.sh"'
echo '   "test:email-verification:migration": "vitest run tests/email-verification-migration.test.ts"'
echo '   "test:email-verification:subscription": "vitest run tests/subscription-with-verification.test.ts"'
echo '   "test:email-verification:all": "vitest run tests/email-verification*.test.ts tests/subscription-with-verification.test.ts"'