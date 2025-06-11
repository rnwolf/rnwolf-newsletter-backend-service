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
# Found 3 emails matching pattern: %smoke-test%@smoke-test.example.com
# Found 0 emails matching pattern: %staging-smoke-test%@smoke-test.example.com
#
# 🗑️  Found 3 emails to cleanup:
#   1. smoke-test-1234567890-abc123@smoke-test.example.com
#   2. smoke-test-1234567891-def456@smoke-test.example.com
#   3. smoke-test-1234567892-ghi789@smoke-test.example.com
#
# ⚠️  WARNING: About to delete emails from PRODUCTION database!
# Continue? (yes/no): yes
#
# 🧹 Starting cleanup...
# Removing: smoke-test-1234567890-abc123@smoke-test.example.com
# ✅ Removed: smoke-test-1234567890-abc123@smoke-test.example.com
# Removing: smoke-test-1234567891-def456@smoke-test.example.com
# ✅ Removed: smoke-test-1234567891-def456@smoke-test.example.com
# Removing: smoke-test-1234567892-ghi789@smoke-test.example.com
# ✅ Removed: smoke-test-1234567892-ghi789@smoke-test.example.com
#
# 📊 Cleanup Summary:
#   Successfully removed: 3
#   Errors: 0
#   Total processed: 3
# ✅ Cleanup completed successfully!