-- Migration 001: Initial schema
-- Creates the complete initial schema for the newsletter service
-- This includes subscribers table, email verification queue log, and all necessary indexes and triggers

-- Enable foreign key constraint deferral for safe table creation
PRAGMA defer_foreign_keys = true;

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

    -- Email verification fields
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
-- Create email verification queue tracking table
-- (For tracking queue processing status)
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

-- ========================================
-- Create performance indexes
-- ========================================

-- Core subscription indexes
CREATE INDEX idx_email ON subscribers(email);
CREATE INDEX idx_subscribed_at ON subscribers(subscribed_at);

-- Email verification indexes
CREATE INDEX idx_email_verified ON subscribers(email_verified);
CREATE INDEX idx_verification_token ON subscribers(verification_token);

-- Composite index for active verified subscribers (newsletter sending)
CREATE INDEX idx_active_verified_subscribers ON subscribers(email_verified, unsubscribed_at);

-- Composite index for subscription status tracking
CREATE INDEX idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);

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

-- Reset foreign key constraint deferral
PRAGMA defer_foreign_keys = false;