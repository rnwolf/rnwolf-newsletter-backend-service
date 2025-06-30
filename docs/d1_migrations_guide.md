# Cloudflare D1 Database Migrations Guide

## Overview

Database migrations are a way of versioning your database in Cloudflare D1. Each migration is stored as an `.sql` file in your migrations folder, enabling you to store and track changes throughout database development.

## How D1 Migrations Work

### Migration File Structure

- Every migration file has a specified version number in the filename
- Files are listed in sequential order
- Each migration file is a SQL file where you can specify queries to be run
- By default, migrations are created in the `migrations/` folder in your Worker project directory
- Applied migrations are tracked in the `d1_migrations` table in your database

### Migration Tracking

D1 automatically tracks which migrations have been applied by maintaining a record in the `d1_migrations` table. This ensures migrations are only applied once and prevents duplicate executions.

## Key Commands

### Creating Migrations

```bash
wrangler d1 migrations create <DATABASE_NAME> <MIGRATION_NAME> --config wrangler.jsonc
```

This generates a new versioned file inside the migrations folder. Name your migration file as a description of your change for easier identification.

**Example:**
```bash
wrangler d1 migrations create DB initial_schema --config wrangler.jsonc
# Creates: 0001_initial_schema.sql
```

### Listing Migrations

```bash
wrangler d1 migrations list <DATABASE_NAME> [OPTIONS] --config wrangler.jsonc
```

Shows unapplied migration files.

**Options:**
- `--local`: Show unapplied migrations for local database
- `--env staging --remote`: Show unapplied migrations for staging database
- `--env production --remote`: Show unapplied migrations for production database

### Applying Migrations

```bash
wrangler d1 migrations apply <DATABASE_NAME> [OPTIONS] --config wrangler.jsonc
```

**Examples:**
```bash
# Apply to local development database
wrangler d1 migrations apply DB --config wrangler.jsonc --local

# Apply to staging database
wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote

# Apply to production database
wrangler d1 migrations apply DB --config wrangler.jsonc --env production --remote
```

## Configuration

You can customize migration settings in your `wrangler.jsonc`:

```jsonc
{
  // Default environment configuration
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app-local",
      "database_id": "local-uuid",
      "migrations_table": "d1_migrations",    // Custom table name (optional)
      "migrations_dir": "migrations"          // Custom directory (optional)
    }
  ],

  // Environment-specific configurations
  "env": {
    "staging": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-app-staging",
          "database_id": "staging-uuid"
        }
      ]
    },
    "production": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-app-production",
          "database_id": "production-uuid"
        }
      ]
    }
  }
}
```

## Initial Schema and Versioned Migrations

### Does the initial schema form part of versioned migrations?

**Yes, the initial schema forms part of the versioned migrations.** There's no separate "initial schema" concept in D1's migration system.

The first migration you create is typically named something like `0001_initial_schema.sql` and contains all your initial `CREATE TABLE` statements. This approach treats the initial schema creation as the first migration in your sequence, which is a best practice for database versioning.

**Example workflow:**
```bash
# Create your first migration
wrangler d1 migrations create my-db initial_schema

# Edit the generated file (0001_initial_schema.sql) to include:
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    user_id INTEGER,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

## Rebuilding Database from Scratch

### Current Limitations

D1's migration system has limitations regarding partial migration application:

**What D1 Currently Supports:**
- Create empty migration files
- List unapplied migrations
- Apply remaining migrations (applies ALL unapplied migrations)
- Track applied migrations in the `d1_migrations` table

**What D1 Currently Does NOT Support:**
- ❌ No built-in way to apply migrations up to a specific version/level
- ❌ No rollback functionality - once applied, migrations cannot be automatically undone
- ❌ No partial migration application - you can only apply all remaining unapplied migrations

### Workarounds for Rebuilding to a Specific Level

#### 1. Manual Reset and Selective Application

Create a reset script that drops all tables:

```sql
-- reset.sql
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS d1_migrations;  -- Important: reset migration tracking
```

**Workflow:**
```bash
# Reset everything
wrangler d1 execute my-db --local --file="reset.sql"

# Temporarily remove migration files you don't want applied
# Apply remaining migrations
wrangler d1 migrations apply my-db --local

# Restore the removed migration files
```

#### 2. Database Export/Import

```bash
# Export database at desired state
wrangler d1 export my-db --remote --output=./backup.sql

# Later, restore that state
wrangler d1 execute my-db --local --file="./backup.sql"
```

#### 3. Time Travel Feature

D1's Time Travel allows you to restore a database to any minute within the last 30 days:

```bash
# Restore to a specific point in time
wrangler d1 time-travel restore my-db --bookmark=<bookmark_id>
# or
wrangler d1 time-travel restore my-db --timestamp="2024-01-15T10:30:00Z"
```

**Migration Safety with Time Travel:**

Time Travel provides a powerful rollback mechanism for migrations. You can capture a bookmark before applying migrations and restore to that exact point if needed:

```bash
# 1. Capture current state before migration
wrangler d1 time-travel info my-db --remote

# Note the bookmark ID from the output, then apply migration
wrangler d1 migrations apply my-db --remote

# 2. If migration causes issues, restore to pre-migration state
wrangler d1 time-travel restore my-db --bookmark=<bookmark_id_from_step_1> --remote
```

This approach is particularly valuable for:
- **Production migrations** where you need guaranteed rollback capability
- **Complex schema changes** that might have unexpected side effects
- **Data migrations** that modify existing records
- **Testing rollback procedures** in staging environments

## Preventing Foreign Key Constraint Errors

Foreign key constraints can cause migration failures when:
- Adding foreign key relationships to existing tables with data
- Modifying table structures that temporarily break referential integrity
- Creating tables in the wrong order

### Common Scenarios and Solutions

#### Scenario 1: Adding a Foreign Key to an Existing Table

**Problem:** You have an existing `orders` table and want to add a `user_id` foreign key, but some orders might not have valid user references.

```sql
-- ❌ This will fail if any orders have invalid user_id values
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
```

**Solution:**
```sql
-- ✅ Proper approach
PRAGMA defer_foreign_keys = true;

-- Clean up any invalid data first
DELETE FROM orders WHERE user_id NOT IN (SELECT id FROM users);
-- Or set to a default user: UPDATE orders SET user_id = 1 WHERE user_id NOT IN (SELECT id FROM users);

-- Now add the foreign key constraint
ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);

PRAGMA defer_foreign_keys = false;
```

#### Scenario 2: Creating Tables with Circular Dependencies

**Problem:** Table A references Table B, and Table B references Table A.

```sql
-- ❌ This creates a chicken-and-egg problem
CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name TEXT,
    manager_id INTEGER,
    FOREIGN KEY (manager_id) REFERENCES employees(id)
);

CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT,
    department_id INTEGER,
    FOREIGN KEY (department_id) REFERENCES departments(id)
);
```

**Solution:**
```sql
-- ✅ Create tables without FK constraints first, then add them
PRAGMA defer_foreign_keys = true;

CREATE TABLE departments (
    id INTEGER PRIMARY KEY,
    name TEXT,
    manager_id INTEGER
);

CREATE TABLE employees (
    id INTEGER PRIMARY KEY,
    name TEXT,
    department_id INTEGER
);

-- Add foreign key constraints after both tables exist
ALTER TABLE departments ADD FOREIGN KEY (manager_id) REFERENCES employees(id);
ALTER TABLE employees ADD FOREIGN KEY (department_id) REFERENCES departments(id);

PRAGMA defer_foreign_keys = false;
```

#### Scenario 3: Modifying Table Structure

**Problem:** You need to modify a table that has foreign key relationships.

```sql
-- ❌ This might fail if the operation temporarily breaks FK constraints
ALTER TABLE orders RENAME COLUMN customer_id TO user_id;
```

**Solution:**
```sql
-- ✅ Defer constraints during structural changes
PRAGMA defer_foreign_keys = true;

-- Perform your structural changes
ALTER TABLE orders RENAME COLUMN customer_id TO user_id;
-- Update any related foreign key constraints if needed

PRAGMA defer_foreign_keys = false;
```

### Best Practices for Foreign Keys in Migrations

1. **Always use PRAGMA defer_foreign_keys when working with FK constraints**
   ```sql
   PRAGMA defer_foreign_keys = true;
   -- Your migration code
   PRAGMA defer_foreign_keys = false;
   ```

2. **Create tables in dependency order when possible**
   - Create parent tables before child tables
   - Or use the defer pragma approach

3. **Clean up data before adding constraints**
   ```sql
   -- Remove orphaned records
   DELETE FROM child_table WHERE parent_id NOT IN (SELECT id FROM parent_table);
   ```

4. **Test migrations with real data**
   - Use seed data that includes edge cases
   - Test on a copy of production data when possible

5. **Use explicit foreign key names for easier debugging**
   ```sql
   ALTER TABLE orders ADD CONSTRAINT fk_orders_user_id
   FOREIGN KEY (user_id) REFERENCES users(id);
   ```

6. **Handle foreign keys in reset scripts**
   ```sql
   -- When resetting, drop tables in reverse dependency order
   DROP TABLE IF EXISTS orders;      -- Child table first
   DROP TABLE IF EXISTS users;       -- Parent table last
   DROP TABLE IF EXISTS d1_migrations;
   ```

7. **Use Time Travel for migration safety**
   - Always capture a bookmark before applying production migrations
   - Test rollback procedures in staging environments
   - Store bookmark IDs securely for emergency rollbacks
   - Consider automated bookmark capture in CI/CD pipelines

8. **Manage test data separately from migrations**
   - Keep test seed data in separate SQL files outside the migrations directory
   - Use consistent, predictable test data for reliable testing
   - Clean up test data after test runs to maintain isolation
   - Consider using database exports to generate realistic test datasets

### Error Handling
- If applying a migration results in an error, the migration will be rolled back
- The previous successful migration will remain applied
- A backup is automatically captured before applying migrations

### Confirmation Process
- Commands prompt for confirmation before applying migrations
- In CI/CD environments, confirmation is skipped but backup is still captured
- Progress of each migration is printed to the console

### Foreign Key Constraints

When applying migrations that modify tables with foreign key relationships, you may temporarily violate constraints depending on the order of operations. D1 provides `PRAGMA defer_foreign_keys` to handle this.

**Important:** D1 does NOT support `PRAGMA foreign_keys = OFF` (standard SQLite). Instead, use `PRAGMA defer_foreign_keys = true`.

#### How it works:
- Allows you to defer the enforcement of foreign key constraints until the end of the current transaction
- This does not disable foreign key enforcement outside of the current transaction
- If you have not resolved outstanding foreign key violations at the end of your transaction, it will fail with a FOREIGN KEY constraint failed error

#### Practical Implementation:

```sql
-- Start of migration file
PRAGMA defer_foreign_keys = true;

-- Your migration SQL that might violate FK constraints
ALTER TABLE orders ADD COLUMN status_id INTEGER;
CREATE TABLE order_statuses (id INTEGER PRIMARY KEY, name TEXT);
INSERT INTO order_statuses (id, name) VALUES (1, 'pending'), (2, 'completed');
ALTER TABLE orders ADD FOREIGN KEY (status_id) REFERENCES order_statuses(id);
UPDATE orders SET status_id = 1 WHERE status_id IS NULL;

-- Explicitly turn it back off (recommended)
PRAGMA defer_foreign_keys = false;
```

#### Key Points:

1. **Automatic Reset**: This is implicit if not set by the end of the transaction, but it's good practice to explicitly set it back to `false`

2. **Transaction Scope**: The pragma only affects the current transaction/migration file

3. **Must Resolve Violations**: All foreign key violations must be resolved by the end of the migration, or it will fail

4. **CASCADE Still Works**: Note that setting PRAGMA defer_foreign_keys = ON does not prevent ON DELETE CASCADE actions from being executed

## Environment Management with `--env` Flag

This guide assumes you're using a three-environment setup with explicit environment configurations rather than the `preview_database_id` approach. This provides clearer separation and control over your database environments.

### Three Database Environments

Your setup uses three distinct environments managed via the `--env` flag:

1. **Local** (`--local`):
   - SQLite database stored locally in `.wrangler/state`
   - For local development and testing
   - Data persists across `wrangler dev` sessions
   - Uses default environment config or can specify `--env local`

2. **Staging** (`--env staging --remote`):
   - Dedicated staging D1 database on Cloudflare's network
   - Uses the `database_id` from `env.staging` configuration
   - For integration testing and validation before production

3. **Production** (`--env production --remote`):
   - Your production D1 database on Cloudflare's network
   - Uses the `database_id` from `env.production` configuration
   - Live application database

### Important: Avoid `--preview` Flag Confusion

⚠️ **Do not use the `--preview` flag** in your setup. The `--preview` flag is designed for configurations that use `preview_database_id`, which is a different approach than your environment-based setup. Using `--preview` could target an unintended database or cause errors.

**Instead, always use `--env {environment} --remote` for staging and production deployments.**

### Configuration Examples

Your `wrangler.jsonc` should look like this:

```jsonc
{
  // Default/local environment
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app-local",
      "database_id": "local-uuid"
    }
  ],

  // Staging environment
  "env": {
    "staging": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-app-staging",
          "database_id": "staging-uuid"
        }
      ]
    },

    // Production environment
    "production": {
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-app-production",
          "database_id": "production-uuid"
        }
      ]
    }
  }
}
```

### Correct Command Usage

#### Local Development:
```bash
# Local SQLite database (default environment)
wrangler d1 execute DB --config wrangler.jsonc --local --file=./dev/reset_schema.sql
wrangler d1 migrations apply DB --config wrangler.jsonc --local
wrangler dev --config wrangler.jsonc  # Uses local database
```

#### Staging Environment:
```bash
# Staging database (remote D1 instance)
wrangler d1 execute DB --config wrangler.jsonc --env staging --remote --file=./dev/reset_schema.sql
wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote
wrangler dev --config wrangler.jsonc --env staging --remote  # Uses staging database
```

#### Production Environment:
```bash
# Production database (remote D1 instance)
# ONLY reset production database if required!
wrangler d1 execute DB --config wrangler.jsonc --env production --remote --file=./dev/reset_schema.sql
wrangler d1 migrations apply DB --config wrangler.jsonc --env production --remote
wrangler deploy --config wrangler.jsonc --env production  # Deploy to production
```

### Safe Migration Workflow with Time Travel

Here's a recommended workflow that leverages Time Travel for maximum safety:

#### For Staging Environment:
```bash
# 1. Capture pre-migration bookmark
wrangler d1 time-travel info DB --config wrangler.jsonc --env staging --remote
# Record the bookmark ID

# 2. Apply migration
wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote

# 3. Run integration tests
npm run test:integration

# 4. If tests fail, restore to pre-migration state
wrangler d1 time-travel restore DB --config wrangler.jsonc --bookmark=<bookmark_id> --env staging --remote
```

#### For Production Environment:
```bash
# 1. Capture pre-migration bookmark (CRITICAL for production)
wrangler d1 time-travel info DB --config wrangler.jsonc --env production --remote
# IMPORTANT: Save this bookmark ID somewhere safe

# 2. Apply migration during maintenance window
wrangler d1 migrations apply DB --config wrangler.jsonc --env production --remote

# 3. Run smoke tests immediately
npm run test:smoke

# 4. Monitor application for issues
# If problems detected, restore immediately:
wrangler d1 time-travel restore DB --config wrangler.jsonc --bookmark=<bookmark_id> --env production --remote
```

#### Automated Pipeline with Time Travel:
```bash
#!/bin/bash
# migration-with-rollback.sh

DATABASE_NAME="DB"
ENVIRONMENT=${1:-"production"}  # Default to production, allow override
CONFIG_FILE="wrangler.jsonc"

echo "🔍 Capturing pre-migration state for $ENVIRONMENT..."
BOOKMARK_OUTPUT=$(wrangler d1 time-travel info $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote --json)
BOOKMARK_ID=$(echo $BOOKMARK_OUTPUT | jq -r '.bookmark')

echo "📝 Bookmark captured: $BOOKMARK_ID"
echo "⚠️  Save this bookmark for rollback: $BOOKMARK_ID"

echo "🚀 Applying migrations to $ENVIRONMENT..."
if wrangler d1 migrations apply $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote; then
    echo "✅ Migrations applied successfully to $ENVIRONMENT"
    echo "🔖 Rollback command if needed:"
    echo "   wrangler d1 time-travel restore $DATABASE_NAME --config $CONFIG_FILE --bookmark=$BOOKMARK_ID --env $ENVIRONMENT --remote"
else
    echo "❌ Migration failed on $ENVIRONMENT, consider rolling back to: $BOOKMARK_ID"
    exit 1
fi

# Usage examples:
# ./migration-with-rollback.sh staging
# ./migration-with-rollback.sh production
```

#### Automated Pipeline with Time Travel:
```bash
#!/bin/bash
# migration-with-rollback.sh

DATABASE_NAME="my-app"
ENVIRONMENT="production"

echo "🔍 Capturing pre-migration state..."
BOOKMARK_OUTPUT=$(wrangler d1 time-travel info $DATABASE_NAME --env $ENVIRONMENT --remote --json)
BOOKMARK_ID=$(echo $BOOKMARK_OUTPUT | jq -r '.bookmark')

echo "📝 Bookmark captured: $BOOKMARK_ID"
echo "⚠️  Save this bookmark for rollback: $BOOKMARK_ID"

echo "🚀 Applying migrations..."
if wrangler d1 migrations apply $DATABASE_NAME --env $ENVIRONMENT --remote; then
    echo "✅ Migrations applied successfully"
    echo "🔖 Rollback command if needed:"
    echo "   wrangler d1 time-travel restore $DATABASE_NAME --bookmark=$BOOKMARK_ID --env $ENVIRONMENT --remote"
else
    echo "❌ Migration failed, consider rolling back to: $BOOKMARK_ID"
    exit 1
fi
```

```bash
# 1. Develop locally
wrangler d1 migrations create my-app add_new_feature --config wrangler.jsonc
# Edit migration file...
wrangler d1 migrations apply my-app --local --config wrangler.jsonc
wrangler dev  # Test locally

# 2. Test on staging
wrangler d1 migrations apply my-app --env staging --remote --config wrangler.jsonc
# Run integration tests...

# 3. Deploy to production (if staging tests pass)
wrangler d1 migrations apply my-app --env production --remote --config wrangler.jsonc
wrangler deploy
```

### CI/CD Pipeline Example

```bash
# In your CI pipeline
name: Deploy

jobs:
  staging:
    steps:
      - name: Apply migrations to staging
        run: wrangler d1 migrations apply my-app --env staging --remote --config wrangler.jsonc

      - name: Run integration tests
        run: npm run test:integration

  production:
    needs: staging
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Apply migrations to production
        run: wrangler d1 migrations apply my-app --env production --remote --config wrangler.jsonc

      - name: Deploy to production
        run: wrangler deploy
```

### Key Points

1. **Separate Migration Tracking**: Each database (local, staging, production) maintains its own `d1_migrations` table

2. **Preview = Staging**: In your pipeline, the `--env staging --remote` flag targets your staging database

3. **Environment Flexibility**: Cloudflare allows one to define different preview databases for different environments using the `env` configuration

4. **Safe Testing**: Always test migrations on staging before applying to production

For local development, D1 creates a standalone environment that mirrors production:

```bash
# Work with local database (data persists by default in Wrangler v3+)
wrangler d1 migrations apply DB --config wrangler.jsonc --local

# Execute SQL against local database
wrangler d1 execute DB --config wrangler.jsonc --local --command "SELECT * FROM users;"

# Execute SQL file against local database
wrangler d1 execute DB --config wrangler.jsonc --local --file="./seeds/dev.sql"
```

## Best Practices

1. **Use descriptive migration names** that clearly indicate what the migration does
2. **Always test migrations locally first** before applying to remote databases
3. **Keep migrations small and focused** on specific changes
4. **Use the database name instead of binding name** for migrations to avoid confusion
5. **Create seed/reset scripts** for development workflow outside of migrations
6. **Version control your migration files** alongside your application code

## Example Development Workflow

```bash
# 1. Create a new migration locally
wrangler d1 migrations create DB add_user_profile_table --config wrangler.jsonc

# 2. Edit the migration file with your SQL
# 3. Test locally first
wrangler d1 migrations apply DB --config wrangler.jsonc --local

# 4. Verify the changes locally
wrangler d1 execute DB --config wrangler.jsonc --local --command "SELECT name FROM sqlite_schema WHERE type='table';"

# 5. Apply to staging when ready
wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote

# 6. Run integration tests on staging
npm run test:integration

# 7. Apply to production when staging tests pass
wrangler d1 migrations apply DB --config wrangler.jsonc --env production --remote
```

## Test Data Management

Managing test data separately from migrations is crucial for reliable testing. Test data should be loaded after migrations and cleaned up after tests to ensure test isolation and repeatability.

### Directory Structure

Organize your test data files separately from migrations:

```
project/
├── migrations/
│   ├── 0001_initial_schema.sql
│   └── 0002_add_user_profiles.sql
├── test-data/
│   ├── seed-users.sql
│   ├── seed-products.sql
│   ├── cleanup-test-data.sql
│   └── generate-test-data.sql
└── wrangler.jsonc
```

### Creating Test Seed Data

#### Method 1: Manual Test Data Creation

Create structured test data files with predictable, consistent data:

```sql
-- test-data/seed-users.sql
-- Test user data for integration testing
PRAGMA defer_foreign_keys = true;

-- Clear existing test data first (optional safety measure)
DELETE FROM user_profiles WHERE user_id IN (9001, 9002, 9003, 9004, 9005);
DELETE FROM users WHERE id >= 9001 AND id <= 9999;

-- Insert test users (using high IDs to avoid conflicts)
INSERT INTO users (id, email, name, password_hash, status, created_at) VALUES
(9001, 'test.user1@example.com', 'Test User One', '$2a$10$hash1...', 'active', '2024-01-01 10:00:00'),
(9002, 'test.user2@example.com', 'Test User Two', '$2a$10$hash2...', 'active', '2024-01-01 11:00:00'),
(9003, 'test.admin@example.com', 'Test Admin', '$2a$10$hash3...', 'active', '2024-01-01 12:00:00'),
(9004, 'test.inactive@example.com', 'Inactive User', '$2a$10$hash4...', 'inactive', '2024-01-01 13:00:00'),
(9005, 'test.pending@example.com', 'Pending User', '$2a$10$hash5...', 'pending', '2024-01-01 14:00:00');

-- Insert test user profiles
INSERT INTO user_profiles (user_id, bio, avatar_url, preferences) VALUES
(9001, 'Test user for integration testing', 'https://example.com/avatar1.jpg', '{"theme": "dark"}'),
(9002, 'Another test user', 'https://example.com/avatar2.jpg', '{"theme": "light"}'),
(9003, 'Admin test user', 'https://example.com/avatar3.jpg', '{"theme": "dark", "admin": true}');

PRAGMA defer_foreign_keys = false;
```

```sql
-- test-data/seed-products.sql
-- Test product data
PRAGMA defer_foreign_keys = true;

-- Clear existing test data
DELETE FROM order_items WHERE product_id >= 8001 AND product_id <= 8999;
DELETE FROM products WHERE id >= 8001 AND id <= 8999;

-- Insert test products
INSERT INTO products (id, name, price, description, stock_quantity, created_at) VALUES
(8001, 'Test Widget A', 1999, 'A test widget for integration testing', 100, '2024-01-01 10:00:00'),
(8002, 'Test Widget B', 2999, 'Another test widget', 50, '2024-01-01 10:30:00'),
(8003, 'Test Premium Widget', 4999, 'Premium test widget', 25, '2024-01-01 11:00:00'),
(8004, 'Out of Stock Widget', 1599, 'Test out of stock scenario', 0, '2024-01-01 11:30:00');

PRAGMA defer_foreign_keys = false;
```

#### Method 2: Export-Based Test Data Generation

Create a script to export sanitized production data for testing:

```sql
-- test-data/generate-test-data.sql
-- Script to create test data based on production patterns

-- Export sample users (anonymized)
.mode insert users
.output test-data/exported-users.sql
SELECT
    id + 9000 as id,  -- Offset IDs to avoid conflicts
    'test.' || substr(email, 1, instr(email, '@')-1) || '+' || (id + 9000) || '@example.com' as email,
    'Test ' || name as name,
    '$2a$10$testpasswordhash...' as password_hash,
    status,
    created_at
FROM users
WHERE status = 'active'
LIMIT 10;
.output stdout

-- Export sample products
.mode insert products
.output test-data/exported-products.sql
SELECT
    id + 8000 as id,
    'Test ' || name as name,
    price,
    'Test version of: ' || description as description,
    CASE WHEN stock_quantity > 10 THEN 10 ELSE stock_quantity END as stock_quantity,
    created_at
FROM products
WHERE status = 'active'
LIMIT 20;
.output stdout
```

### Test Data Cleanup

Create cleanup scripts to remove test data after testing:

```sql
-- test-data/cleanup-test-data.sql
-- Remove all test data to ensure clean state

PRAGMA defer_foreign_keys = true;

-- Remove test orders and related data
DELETE FROM order_items WHERE order_id IN (
    SELECT id FROM orders WHERE user_id >= 9001 AND user_id <= 9999
);
DELETE FROM orders WHERE user_id >= 9001 AND user_id <= 9999;

-- Remove test products
DELETE FROM order_items WHERE product_id >= 8001 AND product_id <= 8999;
DELETE FROM products WHERE id >= 8001 AND id <= 8999;

-- Remove test user data
DELETE FROM user_profiles WHERE user_id >= 9001 AND user_id <= 9999;
DELETE FROM users WHERE id >= 9001 AND id <= 9999;

-- Clean up any test tokens or sessions
DELETE FROM tokens WHERE userId >= 9001 AND userId <= 9999;

PRAGMA defer_foreign_keys = false;

-- Verify cleanup
SELECT 'Users cleaned:' as result, COUNT(*) as count FROM users WHERE id >= 9001 AND id <= 9999
UNION ALL
SELECT 'Products cleaned:' as result, COUNT(*) as count FROM products WHERE id >= 8001 AND id <= 8999;
```

### Testing Pipeline Integration

#### Staging Environment Test Workflow

```bash
#!/bin/bash
# test-with-data.sh - Complete testing workflow with data management

DATABASE_NAME="DB"
ENVIRONMENT="staging"
CONFIG_FILE="wrangler.jsonc"

echo "🔧 Setting up staging environment for testing..."

# 1. Apply latest migrations
echo "📥 Applying migrations..."
wrangler d1 migrations apply $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote

# 2. Load test data
echo "🌱 Loading test seed data..."
wrangler d1 execute $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote --file=./test-data/seed-users.sql
wrangler d1 execute $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote --file=./test-data/seed-products.sql

# 3. Run tests
echo "🧪 Running integration tests..."
if npm run test:integration; then
    echo "✅ Tests passed!"
    TEST_RESULT=0
else
    echo "❌ Tests failed!"
    TEST_RESULT=1
fi

# 4. Clean up test data (always run, regardless of test outcome)
echo "🧹 Cleaning up test data..."
wrangler d1 execute $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote --file=./test-data/cleanup-test-data.sql

# 5. Verify cleanup
echo "🔍 Verifying cleanup..."
wrangler d1 execute $DATABASE_NAME --config $CONFIG_FILE --env $ENVIRONMENT --remote --command "SELECT COUNT(*) as remaining_test_users FROM users WHERE id >= 9001;"

exit $TEST_RESULT
```

#### CI/CD Pipeline with Test Data

```yaml
# .github/workflows/test-with-data.yml
name: Test with Data Management

jobs:
  test-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Apply migrations to staging
        run: wrangler d1 migrations apply DB --config wrangler.jsonc --env staging --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Load test data
        run: |
          wrangler d1 execute DB --config wrangler.jsonc --env staging --remote --file=./test-data/seed-users.sql
          wrangler d1 execute DB --config wrangler.jsonc --env staging --remote --file=./test-data/seed-products.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

      - name: Run integration tests
        run: npm run test:integration
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}

      - name: Cleanup test data
        if: always()  # Always run cleanup, even if tests fail
        run: wrangler d1 execute DB --config wrangler.jsonc --env staging --remote --file=./test-data/cleanup-test-data.sql
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### Best Practices for Test Data

1. **Use High ID Ranges**: Use ID ranges like 8000-8999 for products, 9000-9999 for users to avoid conflicts with real data

2. **Predictable Data**: Create consistent, predictable test data that your tests can rely on

3. **Foreign Key Safety**: Always use `PRAGMA defer_foreign_keys = true` when loading/cleaning test data

4. **Atomic Cleanup**: Ensure cleanup scripts are thorough and handle all related data

5. **Verification**: Include verification steps to confirm test data was properly loaded and cleaned

6. **Environment Isolation**: Never load test data in production environments

7. **Idempotent Scripts**: Make sure test data scripts can be run multiple times safely

### Generating Test Data from Production

```bash
# Export anonymized data from production for testing
wrangler d1 export DB --config wrangler.jsonc --env production --remote --output=production-export.sql

# Then manually edit the export to:
# - Change IDs to test ranges
# - Anonymize sensitive data
# - Reduce data volume
# - Add test-specific data
```

## Troubleshooting

### Common Issues

1. **"Cannot start a transaction within a transaction" error**
   - Remove `BEGIN TRANSACTION` and `COMMIT` statements from your SQL files

2. **"Statement too long" error**
   - Split large INSERT statements into smaller chunks

3. **Foreign key constraint errors**
   - D1 does NOT support `PRAGMA foreign_keys = OFF`
   - Use `PRAGMA defer_foreign_keys = true` at the start of your migration
   - Always set `PRAGMA defer_foreign_keys = false` at the end
   - Ensure all FK violations are resolved within the same transaction
   - Ensure tables are created in the correct order when defining foreign keys

4. **Migration tracking issues**
   - Check the `d1_migrations` table to see which migrations have been applied
   - For complete reset, drop the `d1_migrations` table along with your schema tables

5. **Time Travel restore failures**
   - Ensure you're using the correct bookmark ID or timestamp format
   - Verify you have the right environment flags (`--env`, `--remote`, `--preview`)
   - Check that the timestamp/bookmark is within the 30-day retention period
   - Time Travel restores are atomic operations but may take time for large databases

6. **Test data management issues**
   - Ensure test seed data doesn't conflict with existing data (use unique IDs or clear data first)
   - Check foreign key constraints when loading test data
   - Verify test cleanup scripts remove all test data to avoid pollution between test runs