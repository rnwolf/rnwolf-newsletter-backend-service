-- Migration 002: Add email verification fields
-- This migration adds double opt-in verification support to the existing subscribers table
-- All new fields are nullable or have defaults to ensure backward compatibility

-- Add verification fields to existing subscribers table
ALTER TABLE subscribers ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE subscribers ADD COLUMN verification_token TEXT;
ALTER TABLE subscribers ADD COLUMN verification_sent_at DATETIME;
ALTER TABLE subscribers ADD COLUMN verified_at DATETIME;

-- Create index for verification token lookups (performance optimization)
CREATE INDEX IF NOT EXISTS idx_verification_token ON subscribers(verification_token);

-- Create index for verified status queries (performance optimization)
CREATE INDEX IF NOT EXISTS idx_email_verified ON subscribers(email_verified);

-- Update existing subscribers to be verified (backward compatibility)
-- This ensures existing subscribers don't need to re-verify
UPDATE subscribers
SET email_verified = TRUE,
    verified_at = subscribed_at
WHERE unsubscribed_at IS NULL;