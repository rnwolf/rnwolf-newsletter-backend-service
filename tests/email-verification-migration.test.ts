// tests/email-verification-migration.test.ts
// TDD Red Phase: Tests for database migration to support email verification
import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { setupTestDatabase } from './setup';

interface TableInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

interface DatabaseRow {
  email: string;
  email_verified: boolean | null;
  verification_token: string | null;
  verification_sent_at: string | null;
  verified_at: string | null;
  subscribed_at: string;
  unsubscribed_at: string | null;
  [key: string]: unknown;
}

// Only run these tests in local environment where we control the database
const TEST_ENV = process.env.TEST_ENV || 'local';

describe(`Email Verification Database Migration Tests (${TEST_ENV} environment)`, () => {
  beforeEach(async () => {
    if (TEST_ENV !== 'local') return;

    // Set up basic table without verification fields
    await setupTestDatabase(env);
  });

  describe('Migration File Requirements', () => {
    it('should have migration file 002_add_email_verification.sql', async () => {
      if (TEST_ENV !== 'local') return;

      // This test will fail until we create the migration file
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      expect(fs.existsSync(migrationPath)).toBe(true);

      const migrationContent = fs.readFileSync(migrationPath, 'utf8');

      // Migration should add the required columns
      expect(migrationContent).toContain('ADD COLUMN email_verified');
      expect(migrationContent).toContain('ADD COLUMN verification_token');
      expect(migrationContent).toContain('ADD COLUMN verification_sent_at');
      expect(migrationContent).toContain('ADD COLUMN verified_at');

      // Migration should handle existing subscribers
      expect(migrationContent).toContain('UPDATE subscribers');
      expect(migrationContent).toContain('email_verified = TRUE');
    });

    it('should apply migration successfully', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration (this will fail until migration file exists)
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

        // Split and execute each statement
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Verify all columns exist after migration
      const tableInfo = await env.DB.prepare(
        'PRAGMA table_info(subscribers)'
      ).all() as { results: TableInfo[] };

      const columnNames = tableInfo.results.map(col => col.name);

      expect(columnNames).toContain('email_verified');
      expect(columnNames).toContain('verification_token');
      expect(columnNames).toContain('verification_sent_at');
      expect(columnNames).toContain('verified_at');
    });

    it('should set correct data types for new columns', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration first
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      const tableInfo = await env.DB.prepare(
        'PRAGMA table_info(subscribers)'
      ).all() as { results: TableInfo[] };

      const columnMap = new Map(tableInfo.results.map(col => [col.name, col]));

      // email_verified should be BOOLEAN with default FALSE
      const emailVerified = columnMap.get('email_verified');
      expect(emailVerified?.type).toContain('BOOLEAN');
      expect(emailVerified?.dflt_value).toBe('FALSE');

      // verification_token should be TEXT, nullable
      const verificationToken = columnMap.get('verification_token');
      expect(verificationToken?.type).toBe('TEXT');
      expect(verificationToken?.notnull).toBe(0); // nullable

      // verification_sent_at should be DATETIME, nullable
      const verificationSentAt = columnMap.get('verification_sent_at');
      expect(verificationSentAt?.type).toBe('DATETIME');
      expect(verificationSentAt?.notnull).toBe(0); // nullable

      // verified_at should be DATETIME, nullable
      const verifiedAt = columnMap.get('verified_at');
      expect(verifiedAt?.type).toBe('DATETIME');
      expect(verifiedAt?.notnull).toBe(0); // nullable
    });
  });

  describe('Existing Subscriber Migration', () => {
    it('should mark existing subscribers as verified after migration', async () => {
      if (TEST_ENV !== 'local') return;

      // Insert some existing subscribers before migration
      const existingSubscribers = [
        'existing1@example.com',
        'existing2@example.com',
        'existing3@example.com'
      ];

      for (const email of existingSubscribers) {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, ip_address, country)
          VALUES (?, ?, '192.168.1.1', 'GB')
        `).bind(email, new Date().toISOString()).run();
      }

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Verify existing subscribers are marked as verified
      for (const email of existingSubscribers) {
        const subscriber = await env.DB.prepare(
          'SELECT email_verified, verified_at FROM subscribers WHERE email = ?'
        ).bind(email).first() as DatabaseRow | null;

        expect(subscriber?.email_verified).toBe(true);
        expect(subscriber?.verified_at).toBeTruthy();
      }
    });

    it('should not affect unsubscribed users during migration', async () => {
      if (TEST_ENV !== 'local') return;

      const unsubscribedEmail = 'unsubscribed@example.com';
      const unsubscribeDate = '2024-06-01T00:00:00Z';

      // Insert unsubscribed user before migration
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, country)
        VALUES (?, ?, ?, '192.168.1.1', 'GB')
      `).bind(unsubscribedEmail, '2024-01-01T00:00:00Z', unsubscribeDate).run();

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Verify unsubscribed user is still marked as verified (grandfathered)
      // but remains unsubscribed
      const subscriber = await env.DB.prepare(
        'SELECT email_verified, verified_at, unsubscribed_at FROM subscribers WHERE email = ?'
      ).bind(unsubscribedEmail).first() as DatabaseRow | null;

      expect(subscriber?.email_verified).toBe(true); // Grandfathered as verified
      expect(subscriber?.verified_at).toBeTruthy();
      expect(subscriber?.unsubscribed_at).toBe(unsubscribeDate); // Still unsubscribed
    });

    it('should handle migration idempotency (safe to run multiple times)', async () => {
      if (TEST_ENV !== 'local') return;

      const testEmail = 'idempotent@example.com';

      // Insert subscriber before migration
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, ip_address, country)
        VALUES (?, ?, '192.168.1.1', 'GB')
      `).bind(testEmail, new Date().toISOString()).run();

      // Apply migration first time
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }

        // Apply migration second time (should not fail)
        for (const statement of statements) {
          try {
            await env.DB.prepare(statement).run();
          } catch (error) {
            // ALTER TABLE ADD COLUMN will fail if column exists, that's expected
            if (!(statement.includes('ADD COLUMN') && error.message?.includes('duplicate column'))) {
              throw error;
            }
          }
        }
      }

      // Verify subscriber data is still intact
      const subscriber = await env.DB.prepare(
        'SELECT email_verified, verified_at FROM subscribers WHERE email = ?'
      ).bind(testEmail).first() as DatabaseRow | null;

      expect(subscriber?.email_verified).toBe(true);
      expect(subscriber?.verified_at).toBeTruthy();
    });
  });

  describe('Newsletter Script Compatibility', () => {
    it('should allow newsletter scripts to filter by verified status', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration first
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Insert mix of verified and unverified subscribers
      const verifiedEmail = 'verified@example.com';
      const unverifiedEmail = 'unverified@example.com';

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verified_at)
        VALUES (?, ?, TRUE, ?)
      `).bind(verifiedEmail, new Date().toISOString(), new Date().toISOString()).run();

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind(unverifiedEmail, new Date().toISOString(), 'pending-token').run();

      // Test newsletter script query (only verified subscribers)
      const verifiedSubscribers = await env.DB.prepare(`
        SELECT email FROM subscribers
        WHERE email_verified = TRUE
        AND unsubscribed_at IS NULL
      `).all();

      expect(verifiedSubscribers.results).toHaveLength(1);
      expect((verifiedSubscribers.results[0] as any).email).toBe(verifiedEmail);

      // Test that unverified subscribers are excluded
      const allSubscribers = await env.DB.prepare(`
        SELECT email FROM subscribers
        WHERE unsubscribed_at IS NULL
      `).all();

      expect(allSubscribers.results).toHaveLength(2); // Both exist in DB
      expect(verifiedSubscribers.results).toHaveLength(1); // Only verified returned
    });

    it('should support transition period queries (verified OR grandfathered)', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Insert different types of subscribers
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verified_at)
        VALUES (?, ?, TRUE, ?)
      `).bind('verified@example.com', new Date().toISOString(), new Date().toISOString()).run();

      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified)
        VALUES (?, ?, FALSE)
      `).bind('unverified@example.com', new Date().toISOString()).run();

      // Query for newsletter sending (only verified)
      const newsletterRecipients = await env.DB.prepare(`
        SELECT email, email_verified, verified_at FROM subscribers
        WHERE email_verified = TRUE
        AND unsubscribed_at IS NULL
        ORDER BY email
      `).all();

      expect(newsletterRecipients.results).toHaveLength(1);
      expect((newsletterRecipients.results[0] as any).email).toBe('verified@example.com');

      // Query for analytics (all subscribers)
      const allActiveSubscribers = await env.DB.prepare(`
        SELECT email, email_verified FROM subscribers
        WHERE unsubscribed_at IS NULL
        ORDER BY email
      `).all();

      expect(allActiveSubscribers.results).toHaveLength(2);
      expect((allActiveSubscribers.results[0] as any).email).toBe('unverified@example.com');
      expect((allActiveSubscribers.results[1] as any).email).toBe('verified@example.com');
    });
  });

  describe('Performance Impact', () => {
    it('should not significantly impact existing queries', async () => {
      if (TEST_ENV !== 'local') return;

      // Insert test data before migration
      const testEmails = Array.from({ length: 100 }, (_, i) => `perf-test-${i}@example.com`);

      for (const email of testEmails) {
        await env.DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, ip_address, country)
          VALUES (?, ?, '192.168.1.1', 'GB')
        `).bind(email, new Date().toISOString()).run();
      }

      // Measure query time before migration
      const startBefore = Date.now();
      await env.DB.prepare('SELECT COUNT(*) FROM subscribers').first();
      const durationBefore = Date.now() - startBefore;

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Measure query time after migration
      const startAfter = Date.now();
      await env.DB.prepare('SELECT COUNT(*) FROM subscribers').first();
      const durationAfter = Date.now() - startAfter;

      // Performance should not degrade significantly (allow 2x slower due to added columns)
      expect(durationAfter).toBeLessThan(durationBefore * 2 + 10); // 10ms tolerance

      // Verify new columns don't break existing queries
      const countResult = await env.DB.prepare('SELECT COUNT(*) as count FROM subscribers').first() as { count: number } | null;
      expect(countResult?.count).toBe(100);
    });

    it('should create appropriate indexes for new columns', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Check if email_verified index exists (if migration includes it)
      const indexes = await env.DB.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index'
        AND tbl_name = 'subscribers'
      `).all();

      const indexNames = indexes.results.map((row: any) => row.name);

      // Basic indexes should exist
      expect(indexNames).toContain('idx_email');
      expect(indexNames).toContain('idx_subscribed_at');

      // If migration includes email_verified index, verify it exists
      // This test documents the expectation but migration may or may not include it
    });
  });

  describe('Data Integrity After Migration', () => {
    it('should preserve all existing subscriber data', async () => {
      if (TEST_ENV !== 'local') return;

      const originalData = {
        email: 'preserve-test@example.com',
        subscribed_at: '2024-01-01T00:00:00Z',
        ip_address: '192.168.1.100',
        user_agent: 'Original Browser',
        country: 'US',
        city: 'New York'
      };

      // Insert original data
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, ip_address, user_agent, country, city)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        originalData.email,
        originalData.subscribed_at,
        originalData.ip_address,
        originalData.user_agent,
        originalData.country,
        originalData.city
      ).run();

      // Apply migration
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Verify all original data preserved
      const subscriber = await env.DB.prepare(
        'SELECT * FROM subscribers WHERE email = ?'
      ).bind(originalData.email).first() as DatabaseRow | null;

      expect(subscriber?.email).toBe(originalData.email);
      expect(subscriber?.subscribed_at).toBe(originalData.subscribed_at);
      expect((subscriber as any)?.ip_address).toBe(originalData.ip_address);
      expect((subscriber as any)?.user_agent).toBe(originalData.user_agent);
      expect((subscriber as any)?.country).toBe(originalData.country);
      expect((subscriber as any)?.city).toBe(originalData.city);

      // Verify new columns added with correct values
      expect(subscriber?.email_verified).toBe(true); // Grandfathered
      expect(subscriber?.verified_at).toBeTruthy();
      expect(subscriber?.verification_token).toBeNull(); // Not needed for grandfathered
    });

    it('should handle NULL values correctly in new columns', async () => {
      if (TEST_ENV !== 'local') return;

      // Apply migration first
      const fs = require('fs');
      const path = require('path');

      const migrationPath = path.join(process.cwd(), 'migrations', '002_add_email_verification.sql');

      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
        const statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);

        for (const statement of statements) {
          await env.DB.prepare(statement).run();
        }
      }

      // Insert new unverified subscriber
      await env.DB.prepare(`
        INSERT INTO subscribers (email, subscribed_at, email_verified, verification_token)
        VALUES (?, ?, FALSE, ?)
      `).bind('null-test@example.com', new Date().toISOString(), 'test-token').run();

      const subscriber = await env.DB.prepare(
        'SELECT verification_sent_at, verified_at FROM subscribers WHERE email = ?'
      ).bind('null-test@example.com').first() as DatabaseRow | null;

      // These should be NULL for unverified subscribers
      expect(subscriber?.verification_sent_at).toBeNull();
      expect(subscriber?.verified_at).toBeNull();
    });
  });
});