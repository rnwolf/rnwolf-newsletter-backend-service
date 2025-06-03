import type { Env } from 'cloudflare:test';

export async function setupTestDatabase(env: Env) {
  // Drop existing table to ensure clean state
  try {
    await env.DB.exec('DROP TABLE IF EXISTS subscribers');
  } catch (error) {
    // Ignore if table doesn't exist
  }

  // Create subscribers table - use a single line or prepare() instead of exec()
  const createTableSQL = `CREATE TABLE subscribers (
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
  )`;

  // Use prepare() and run() instead of exec()
  await env.DB.prepare(createTableSQL).run();

  // Create indexes
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at)').run();
}