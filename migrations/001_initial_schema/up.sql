-- Migration 001: Initial schema
-- Creates the basic subscribers table and indexes
-- This is the foundation schema for the newsletter service

-- Create subscribers table
CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL,
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create basic indexes
CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at);
CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);

-- Create trigger for updated_at
CREATE TRIGGER IF NOT EXISTS update_subscribers_timestamp
    AFTER UPDATE ON subscribers
    FOR EACH ROW
BEGIN
    UPDATE subscribers
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;