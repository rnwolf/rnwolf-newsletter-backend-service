# Cloudflare D1 Database features

Cloudflare D1 databases give you safe, repeatable, Git-friendly schema management and 30 day rollback to point in time history for serverless edge databases.

 - Time Travel

    D1's have a 30 history! By using Time Travel with --timestamp we have a practical approach for quick rollbacks. It provides a flexible way to revert to a state like "5 minutes ago" or "yesterday at 3 PM".

- Manage schema changes and database versioning

    The migrations feature in D1 is intended to help developers manage schema changes and database versioning in a structured and repeatable way.

# How to Deal with Database Changes Through the Pipeline

Here's the recommended process:

## Local Development:

 - When you need to change the database schema, create a new, sequentially numbered .sql file in your migrations/ directory (e.g., 003_add_new_column.sql).
 - Run npm run db:migrate:local. This will apply all pending migrations to your local D1 database.
 - Use npm run db:status:local to verify the applied migrations.
 - If you need to completely reset your local database to a clean state (e.g., for a fresh test run), use npm run db:reset:local.

## Staging Environment:

 - Before deploying new code that relies on schema changes, apply the migrations to staging: npm run db:migrate:staging.
 - Always run npm run db:status:staging before and after applying migrations to confirm the state.
 - Run your smoke tests (npm run test:smoke:staging) and integration tests against the updated staging environment.

## Production Environment:

 - Apply the migrations: npm run db:migrate:production. This will only apply the new, pending migrations.
 - Verify the status: npm run db:status:production.
 - Run production smoke tests (npm run test:smoke:production) and monitor your application closely.


# Combining Migration Steps with Backup/Restore

A robust backup/restore process can largely replace explicit "rollback" migration steps.
This approach ensures data integrity and provides a safety net for production deployments.

 - Pre-Migration Backup: Before running npm run db:migrate:staging or npm run db:migrate:production, ensure your scripts/deploy.sh (or a manual step) takes a D1 backup using wrangler d1 backup create (which your db-backup-restore.py script likely wraps).
 - Rollback Procedure: If a production migration causes issues, your rollback procedure would be:
    1. Rollback the worker code to the previous version (using wrangler rollback or redeploying the previous commit).
    2. Restore the D1 database from the backup taken just before the problematic migration.


# db-backup-restore.py script

Now you can use commands like:

 - `uv run scripts/db-backup-restore.py timetravel info staging` (to get the current bookmark and current time)
 - `uv run scripts/db-backup-restore.py timetravel restore staging --bookmark <bookmark_id>`
 - `uv run scripts/db-backup-restore.py timetravel restore staging --timestamp "2024-07-20T10:30:00Z"`
 - `uv run scripts/db-backup-restore.py timetravel restore staging --timestamp 1721471400` (UNIX timestamp)
