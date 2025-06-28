-- Migration: Complete schema reset with email verification support
-- This migration drops all existing data and recreates the schema from scratch
-- Safe to run since there are no production users yet

-- ========================================
-- WARNING: This migration will delete ALL data
-- Only run this if you're certain there are no production users
-- ========================================

-- Drop all existing tables and indexes
DROP TABLE IF EXISTS subscribers;
DROP TABLE IF EXISTS version_sync_log;
DROP TABLE IF EXISTS email_verification_queue_log;

-- Remove any existing indexes (they'll be dropped with tables, but being explicit)
DROP INDEX IF EXISTS idx_email;
DROP INDEX IF EXISTS idx_subscribed_at;
DROP INDEX IF EXISTS idx_subscription_status;
DROP INDEX IF EXISTS idx_sync_status;
DROP INDEX IF EXISTS idx_sync_email;
DROP INDEX IF EXISTS idx_verification_token;
DROP INDEX IF EXISTS idx_email_verified;

-- ========================================
-- Create subscribers table with complete schema
-- Includes all fields needed for email verification workflow
-- ========================================

CREATE TABLE subscribers (
    -- Primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core subscription data
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL,

    -- Email verification fields (NEW)
    email_verified BOOLEAN DEFAULT FALSE NOT NULL,
    verification_token TEXT NULL,
    verification_sent_at DATETIME NULL,
    verified_at DATETIME NULL,

    -- Metadata fields
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,

    -- Audit fields
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ========================================
-- Create performance indexes
-- ========================================

-- Core subscription indexes
CREATE INDEX idx_email ON subscribers(email);
CREATE INDEX idx_subscribed_at ON subscribers(subscribed_at);

-- Email verification indexes (NEW)
CREATE INDEX idx_email_verified ON subscribers(email_verified);
CREATE INDEX idx_verification_token ON subscribers(verification_token);

-- Composite index for active verified subscribers (newsletter sending)
CREATE INDEX idx_active_verified_subscribers ON subscribers(email_verified, unsubscribed_at);

-- Composite index for subscription status tracking
CREATE INDEX idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);

-- ========================================
-- Create version sync log table
-- (For future API versioning support)
-- ========================================

CREATE TABLE version_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL, -- 'subscribe', 'unsubscribe', 'verify', 'update'
    api_version TEXT NOT NULL, -- 'v1', 'v2'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_snapshot TEXT, -- JSON snapshot of the change
    sync_status TEXT DEFAULT 'pending' -- 'pending', 'synced', 'failed'
);

-- Indexes for version sync log
CREATE INDEX idx_sync_status ON version_sync_log(sync_status);
CREATE INDEX idx_sync_email ON version_sync_log(email);
CREATE INDEX idx_sync_timestamp ON version_sync_log(timestamp);

-- ========================================
-- Create email verification queue tracking table
-- (Optional: for tracking queue processing status)
-- ========================================

CREATE TABLE email_verification_queue_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    verification_token TEXT NOT NULL,
    queue_message_id TEXT, -- Cloudflare Queue message ID
    status TEXT DEFAULT 'queued', -- 'queued', 'sent', 'failed', 'expired'
    queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME NULL,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT NULL
);

-- Index for queue tracking
CREATE INDEX idx_queue_email ON email_verification_queue_log(email);
CREATE INDEX idx_queue_status ON email_verification_queue_log(status);
CREATE INDEX idx_queue_token ON email_verification_queue_log(verification_token);

-- ========================================
-- Create triggers for data integrity
-- ========================================

-- Trigger: Update updated_at timestamp on subscribers table changes
CREATE TRIGGER update_subscribers_timestamp
    AFTER UPDATE ON subscribers
    FOR EACH ROW
BEGIN
    UPDATE subscribers
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

-- Trigger: Ensure verification logic consistency
-- If email_verified = TRUE, then verified_at should not be NULL
CREATE TRIGGER check_verification_consistency
    BEFORE UPDATE ON subscribers
    FOR EACH ROW
    WHEN NEW.email_verified = TRUE AND NEW.verified_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'verified_at cannot be NULL when email_verified is TRUE');
END;

-- Trigger: Clear verification token when email is verified
CREATE TRIGGER clear_verification_token_on_verify
    AFTER UPDATE OF email_verified ON subscribers
    FOR EACH ROW
    WHEN NEW.email_verified = TRUE AND OLD.email_verified = FALSE
BEGIN
    UPDATE subscribers
    SET verification_token = NULL
    WHERE id = NEW.id;
END;

-- ========================================
-- Verification of schema creation
-- ========================================

-- Query to verify table structure (for debugging)
-- SELECT name, sql FROM sqlite_master WHERE type='table' AND name LIKE '%subscribers%';

-- Query to verify indexes (for debugging)
-- SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';

-- ========================================
-- Migration completion log
-- ========================================

INSERT INTO version_sync_log (
    email,
    action,
    api_version,
    data_snapshot,
    sync_status
) VALUES (
    'system@migration',
    'schema_reset',
    'v1',
    '{"migration": "reset_schema.sql", "timestamp": "' || datetime('now') || '", "tables_created": ["subscribers", "version_sync_log", "email_verification_queue_log"], "triggers_created": 3}',
    'completed'
);

-- ========================================
-- Schema verification queries
-- (Run these manually after migration to verify success)
-- ========================================

/*
-- Verify subscribers table structure
PRAGMA table_info(subscribers);

-- Verify indexes exist
SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='subscribers';

-- Verify triggers exist
SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='subscribers';

-- Count tables created
SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table' AND name IN ('subscribers', 'version_sync_log', 'email_verification_queue_log');
*/