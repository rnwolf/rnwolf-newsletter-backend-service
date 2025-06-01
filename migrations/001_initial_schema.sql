-- Newsletter subscribers table
-- Using single database evolution approach
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at);
CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);

-- Version sync log for future multi-version support if needed
CREATE TABLE IF NOT EXISTS version_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL, -- 'subscribe', 'unsubscribe', 'update'
    api_version TEXT NOT NULL, -- 'v1', 'v2'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_snapshot TEXT, -- JSON snapshot of the change
    sync_status TEXT DEFAULT 'pending' -- 'pending', 'synced', 'failed'
);

CREATE INDEX IF NOT EXISTS idx_sync_status ON version_sync_log(sync_status);
CREATE INDEX IF NOT EXISTS idx_sync_email ON version_sync_log(email);