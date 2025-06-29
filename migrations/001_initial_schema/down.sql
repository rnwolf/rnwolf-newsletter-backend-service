-- Migration 001 Rollback: Remove initial schema
-- This will drop the subscribers table and all related objects

-- Drop trigger
DROP TRIGGER IF EXISTS update_subscribers_timestamp;

-- Drop indexes
DROP INDEX IF EXISTS idx_subscription_status;
DROP INDEX IF EXISTS idx_subscribed_at;
DROP INDEX IF EXISTS idx_email;

-- Drop table
DROP TABLE IF EXISTS subscribers;