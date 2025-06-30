#!/bin/bash
# database-reset-simple.sh

set -e  # Exit on error

DB_NAME="DB"
ENV="staging"
CONFIG="wrangler.jsonc"

echo "🔄 Starting database reset..."

# Step 1: Execute reset SQL
echo "📝 Dropping existing tables..."
npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --file ./reset.sql

# Step 2: Re-apply all migrations
echo "🚀 Re-applying migrations..."
npx wrangler d1 migrations apply $DB_NAME --remote --env $ENV --config $CONFIG

# Step 3: Optional - Load reference data
if [ -f "./seed.sql" ]; then
    echo "🌱 Loading seed data..."
    npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --file ./seed.sql
fi

echo "✅ Database reset complete!"

# Step 4: Verify by listing applied migrations
echo "📋 Applied migrations:"
npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --command "SELECT name, applied_at FROM d1_migrations ORDER BY applied_at;"