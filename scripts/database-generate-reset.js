// generate-database-reset.js
const { execSync } = require('child_process');
const fs = require('fs');

function generateResetSQL() {
    try {
        // Get all user tables (excluding system tables)
        const tablesOutput = execSync(
            `npx wrangler d1 execute DB --remote --env staging --config wrangler.jsonc --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%';" --json`,
            { encoding: 'utf8' }
        );

        const tables = JSON.parse(tablesOutput);

        // Get all indexes
        const indexesOutput = execSync(
            `npx wrangler d1 execute DB --remote --env staging --config wrangler.jsonc --command "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';" --json`,
            { encoding: 'utf8' }
        );

        const indexes = JSON.parse(indexesOutput);

        // Generate reset SQL
        let resetSQL = '-- Auto-generated reset.sql\n\n';

        // Drop indexes first
        if (indexes.length > 0) {
            resetSQL += '-- Drop indexes\n';
            indexes.forEach(index => {
                resetSQL += `DROP INDEX IF EXISTS ${index.name};\n`;
            });
            resetSQL += '\n';
        }

        // Drop tables
        resetSQL += '-- Drop tables\n';
        tables.forEach(table => {
            resetSQL += `DROP TABLE IF EXISTS ${table.name};\n`;
        });

        fs.writeFileSync('reset.sql', resetSQL);
        console.log('✅ Generated reset.sql with', tables.length, 'tables and', indexes.length, 'indexes');

    } catch (error) {
        console.error('Error generating reset SQL:', error.message);
    }
}

generateResetSQL();