-- migrations/002_add_email_verification.sql
-- Database migration to add email verification support to newsletter service
-- This migration adds the necessary columns for the two-phase email verification flow

-- Add email verification status column
-- Default to FALSE for new subscribers, will be updated for existing ones below
ALTER TABLE subscribers
ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;

-- Add verification token column for storing HMAC-SHA256 tokens
-- NULL when verified or for grandfathered subscribers
ALTER TABLE subscribers
ADD COLUMN verification_token TEXT;

-- Add timestamp for when verification email was sent
-- Used for tracking email delivery and debugging
ALTER TABLE subscribers
ADD COLUMN verification_sent_at DATETIME;

-- Add timestamp for when email was actually verified
-- Used for analytics and verification audit trail
ALTER TABLE subscribers
ADD COLUMN verified_at DATETIME;

-- Create index on email_verified for newsletter script performance
-- Newsletter scripts will filter: WHERE email_verified = TRUE
CREATE INDEX IF NOT EXISTS idx_email_verified ON subscribers(email_verified);

-- Grandfather existing subscribers as verified
-- This ensures existing users don't need to re-verify their subscriptions
-- Sets verified_at to their original subscription date
UPDATE subscribers
SET email_verified = TRUE,
    verified_at = subscribed_at,
    verification_token = NULL
WHERE email_verified IS NULL;

-- Add constraint to ensure verification logic consistency
-- If email_verified = TRUE, then verified_at should not be NULL
-- This is implemented as a trigger to maintain data integrity
CREATE TRIGGER IF NOT EXISTS check_verification_consistency
    BEFORE UPDATE ON subscribers
    FOR EACH ROW
    WHEN NEW.email_verified = TRUE AND NEW.verified_at IS NULL
BEGIN
    SELECT RAISE(ABORT, 'verified_at cannot be NULL when email_verified is TRUE');
END;