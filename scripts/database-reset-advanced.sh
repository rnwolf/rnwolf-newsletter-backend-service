#!/bin/bash
# database-reset.sh
# Basic reset
# ./database-reset-simple.sh

# Advanced reset with backup
# ./database-reset-advanced.sh

# Skip backup creation
# ./database-reset-advanced.sh --skip-backup

# Reset and restore from specific backup
# ./database-reset-advanced.sh --restore-data ./backups/data_20241127.sql

set -e

DB_NAME="DB"
ENV="staging"
CONFIG="wrangler.jsonc"
BACKUP_DIR="./backups"

# Function to create backup
create_backup() {
    echo "💾 Creating backup..."
    DATE=$(date +%Y%m%d_%H%M%S)
    mkdir -p $BACKUP_DIR

    # Backup applied migrations
    npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG \
        --command "SELECT * FROM d1_migrations ORDER BY applied_at;" \
        --json > "$BACKUP_DIR/migrations_$DATE.json"

    # Export data (you'd need to customize this for your tables)
    npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG \
        --command "SELECT * FROM users;" \
        --json > "$BACKUP_DIR/users_$DATE.json" 2>/dev/null || true

    echo "✅ Backup created in $BACKUP_DIR/"
}

# Parse command line arguments
SKIP_BACKUP=false
RESTORE_DATA=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-backup)
            SKIP_BACKUP=true
            shift
            ;;
        --restore-data)
            RESTORE_DATA="$2"
            shift 2
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
done

# Create backup unless skipped
if [ "$SKIP_BACKUP" = false ]; then
    create_backup
fi

# Generate and execute reset
echo "🔄 Generating reset script..."
node generate-reset.js

echo "📝 Executing reset..."
npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --file ./reset.sql

echo "🚀 Re-applying migrations..."
npx wrangler d1 migrations apply $DB_NAME --remote --env $ENV --config $CONFIG

# Restore data if specified
if [ -n "$RESTORE_DATA" ]; then
    echo "📥 Restoring data from $RESTORE_DATA..."
    npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --file "$RESTORE_DATA"
fi

# Load seed data
if [ -f "./seed.sql" ]; then
    echo "🌱 Loading seed data..."
    npx wrangler d1 execute $DB_NAME --remote --env $ENV --config $CONFIG --file ./seed.sql
fi

echo "✅ Database reset complete!"