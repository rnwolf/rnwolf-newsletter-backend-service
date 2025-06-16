// tests/setup.ts - Fixed version without readFileSync
import { env } from 'cloudflare:test';

export async function setupTestDatabase(testEnv: any) {
  try {
    console.log('Setting up test database with email verification schema...');

    // Since readFileSync is not available in Workers environment,
    // we'll create the schema directly

    // Drop existing tables if they exist
    try {
      await testEnv.DB.prepare('DROP TABLE IF EXISTS subscribers').run();
      await testEnv.DB.prepare('DROP TABLE IF EXISTS version_sync_log').run();
      await testEnv.DB.prepare('DROP TABLE IF EXISTS email_verification_queue_log').run();
    } catch (error) {
      // Ignore errors if tables don't exist
      console.log('Tables dropped or did not exist');
    }

    // Create subscribers table with complete email verification schema
    await testEnv.DB.prepare(`
      CREATE TABLE subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        subscribed_at DATETIME NOT NULL,
        unsubscribed_at DATETIME NULL,
        email_verified BOOLEAN DEFAULT FALSE NOT NULL,
        verification_token TEXT NULL,
        verification_sent_at DATETIME NULL,
        verified_at DATETIME NULL,
        ip_address TEXT,
        user_agent TEXT,
        country TEXT,
        city TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    console.log('✓ Subscribers table created');

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email)',
      'CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at)',
      'CREATE INDEX IF NOT EXISTS idx_email_verified ON subscribers(email_verified)',
      'CREATE INDEX IF NOT EXISTS idx_verification_token ON subscribers(verification_token)',
      'CREATE INDEX IF NOT EXISTS idx_active_verified_subscribers ON subscribers(email_verified, unsubscribed_at)',
      'CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at)'
    ];

    for (const indexSql of indexes) {
      try {
        await testEnv.DB.prepare(indexSql).run();
      } catch (error: any) {
        console.warn(`Index creation warning: ${error.message}`);
      }
    }

    console.log('✓ Indexes created');

    // Create version_sync_log table
    await testEnv.DB.prepare(`
      CREATE TABLE version_sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        action TEXT NOT NULL,
        api_version TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_snapshot TEXT,
        sync_status TEXT DEFAULT 'pending'
      )
    `).run();

    console.log('✓ Version sync log table created');

    // Create email_verification_queue_log table
    await testEnv.DB.prepare(`
      CREATE TABLE email_verification_queue_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        verification_token TEXT NOT NULL,
        queue_message_id TEXT,
        status TEXT DEFAULT 'queued',
        queued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME NULL,
        retry_count INTEGER DEFAULT 0,
        error_message TEXT NULL
      )
    `).run();

    console.log('✓ Email verification queue log table created');

    // Create triggers for data integrity (optional, may not work in test environment)
    const triggers = [
      `CREATE TRIGGER IF NOT EXISTS update_subscribers_timestamp
        AFTER UPDATE ON subscribers
        FOR EACH ROW
      BEGIN
        UPDATE subscribers
        SET updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.id;
      END`,

      `CREATE TRIGGER IF NOT EXISTS check_verification_consistency
        BEFORE UPDATE ON subscribers
        FOR EACH ROW
        WHEN NEW.email_verified = TRUE AND NEW.verified_at IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'verified_at cannot be NULL when email_verified is TRUE');
      END`,

      `CREATE TRIGGER IF NOT EXISTS clear_verification_token_on_verify
        AFTER UPDATE OF email_verified ON subscribers
        FOR EACH ROW
        WHEN NEW.email_verified = TRUE AND OLD.email_verified = FALSE
      BEGIN
        UPDATE subscribers
        SET verification_token = NULL
        WHERE id = NEW.id;
      END`
    ];

    for (const triggerSql of triggers) {
      try {
        await testEnv.DB.prepare(triggerSql).run();
      } catch (error: any) {
        console.warn(`Trigger creation warning: ${error.message}`);
      }
    }

    console.log('✓ Triggers created (or skipped if not supported)');

    // Verify the test database has email verification columns
    const tableInfo = await testEnv.DB.prepare('PRAGMA table_info(subscribers)').all();
    const columnNames = tableInfo.results?.map((col: any) => col.name) || [];

    const requiredColumns = ['email_verified', 'verification_token', 'verification_sent_at', 'verified_at'];
    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col));

    if (missingColumns.length === 0) {
      console.log('✓ All email verification columns verified');
    } else {
      console.warn('Missing columns:', missingColumns);
    }

    console.log('✓ Test database setup complete with email verification schema');
    console.log('Final columns:', columnNames);

  } catch (error: any) {
    console.error('Test database setup failed:', error);
    throw error;
  }
}

// Helper function to check if test database is properly set up
export async function verifyTestDatabaseSchema(testEnv: any): Promise<boolean> {
  try {
    // Check if subscribers table exists with email verification columns
    const result = await testEnv.DB.prepare(
      'SELECT email_verified, verification_token, verification_sent_at, verified_at FROM subscribers LIMIT 1'
    ).first();

    return true; // If query succeeds, schema is correct
  } catch (error: any) {
    console.error('Test database schema verification failed:', error.message);
    return false;
  }
}

// Enhanced setup function that includes schema verification
export async function setupAndVerifyTestDatabase(testEnv: any) {
  await setupTestDatabase(testEnv);

  const isValid = await verifyTestDatabaseSchema(testEnv);
  if (!isValid) {
    throw new Error('Test database schema verification failed after setup');
  }

  console.log('✓ Test database schema verified successfully');
}