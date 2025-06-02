import { TestEnvironment } from 'cloudflare:test';

export async function setupTestDatabase(env: TestEnvironment) {
  // Drop existing table to ensure clean state
  try {
    await env.DB.exec('DROP TABLE IF EXISTS subscribers');
  } catch (error) {
    // Ignore if table doesn't exist
  }

  // Create subscribers table with proper SQL syntax
  await env.DB.exec(`
    CREATE TABLE subscribers (
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
    )
  `);
}