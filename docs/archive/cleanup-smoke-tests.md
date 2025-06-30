# Make the script executable
chmod +x tests/cleanup-smoke-tests.js

# Basic usage examples:

# 1. Show help
node tests/cleanup-smoke-tests.js --help

# 2. Clean production (default environment)
node tests/cleanup-smoke-tests.js

# 3. Clean staging environment
node tests/cleanup-smoke-tests.js --env staging

# 4. Clean using environment variable
TEST_ENV=staging node tests/cleanup-smoke-tests.js

# 5. Clean from a file of emails
node tests/cleanup-smoke-tests.js --from-file smoke-test-emails.txt

# 6. Clean staging from file
node tests/cleanup-smoke-tests.js --env staging --from-file staging-emails.txt

# Expected output format:
# 🧹 Newsletter Smoke Test Email Cleanup
# Environment: production
# =====================================
# 🔍 Querying database for smoke test emails...
# Found 2 emails matching pattern: %smoke-test%@smoke-test.example.com (legacy)
# Found 0 emails matching pattern: %staging-smoke-test%@smoke-test.example.com (legacy)
# Found 3 emails matching pattern: test+%smoke-test%@rnwolf.net
# Found 1 emails matching pattern: test+%staging-smoke-test%@rnwolf.net
#
# 🗑️  Found 6 emails to cleanup:
#   1. smoke-test-1234567890-abc123@smoke-test.example.com (legacy)
#   2. smoke-test-1234567891-def456@smoke-test.example.com (legacy)
#   3. test+smoke-test-1234567892-ghi789@rnwolf.net
#   4. test+smoke-test-1234567893-jkl012@rnwolf.net
#   5. test+smoke-test-1234567894-mno345@rnwolf.net
#   6. test+staging-smoke-test-1234567895-pqr678@rnwolf.net
#
# ⚠️  WARNING: About to delete emails from PRODUCTION database!
# Continue? (yes/no): yes
#
# 🧹 Starting cleanup...
# Removing: smoke-test-1234567890-abc123@smoke-test.example.com
# ✅ Removed: smoke-test-1234567890-abc123@smoke-test.example.com
# Removing: smoke-test-1234567891-def456@smoke-test.example.com
# ✅ Removed: smoke-test-1234567891-def456@smoke-test.example.com
# Removing: test+smoke-test-1234567892-ghi789@rnwolf.net
# ✅ Removed: test+smoke-test-1234567892-ghi789@rnwolf.net
# Removing: test+smoke-test-1234567893-jkl012@rnwolf.net
# ✅ Removed: test+smoke-test-1234567893-jkl012@rnwolf.net
# Removing: test+smoke-test-1234567894-mno345@rnwolf.net
# ✅ Removed: test+smoke-test-1234567894-mno345@rnwolf.net
# Removing: test+staging-smoke-test-1234567895-pqr678@rnwolf.net
# ✅ Removed: test+staging-smoke-test-1234567895-pqr678@rnwolf.net
#
# 📊 Cleanup Summary:
#   Successfully removed: 6
#   Errors: 0
#   Total processed: 6
# ✅ Cleanup completed successfully!