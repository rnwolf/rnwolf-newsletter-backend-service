-- DESTRUCTIVE RESET: Drop all tables and reset migration tracking
-- This script only DROPS tables - it does not create anything
-- After running this, use: npm run db:migrate:{env} to apply migrations from scratch

-- ========================================
-- WARNING: This will delete ALL data and reset migration tracking
-- ========================================

-- Drop application tables (in reverse dependency order)
DROP TABLE IF EXISTS email_verification_queue_log;
DROP TABLE IF EXISTS subscribers;

-- Drop D1 migration tracking table to reset migration state
-- This allows migrations to be applied fresh from the beginning
DROP TABLE IF EXISTS d1_migrations;

-- Drop any other potential tables that might exist
DROP TABLE IF EXISTS version_sync_log;  -- In case it exists from old schema

-- Remove any orphaned indexes (they should be dropped with tables, but being explicit)
DROP INDEX IF EXISTS idx_email;
DROP INDEX IF EXISTS idx_subscribed_at;
DROP INDEX IF EXISTS idx_subscription_status;
DROP INDEX IF EXISTS idx_verification_token;
DROP INDEX IF EXISTS idx_email_verified;
DROP INDEX IF EXISTS idx_active_verified_subscribers;
DROP INDEX IF EXISTS idx_queue_email;
DROP INDEX IF EXISTS idx_queue_status;
DROP INDEX IF EXISTS idx_queue_token;

-- Remove any orphaned triggers
DROP TRIGGER IF EXISTS update_subscribers_timestamp;
DROP TRIGGER IF EXISTS check_verification_consistency;
DROP TRIGGER IF EXISTS clear_verification_token_on_verify;