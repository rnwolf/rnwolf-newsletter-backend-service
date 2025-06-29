#!/usr/bin/env node

/**
 * Cleanup script for smoke test emails
 * Removes smoke test emails from the specified environment database
 *
 * Usage:
 *   node tests/cleanup-smoke-tests.js
 *   node tests/cleanup-smoke-tests.js --from-file emails.txt
 *   node tests/cleanup-smoke-tests.js --env staging
 *   TEST_ENV=production node tests/cleanup-smoke-tests.js
 */

const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const fromFile = args.includes('--from-file') ? args[args.indexOf('--from-file') + 1] : null;
const envFlag = args.includes('--env') ? args[args.indexOf('--env') + 1] : null;
const helpFlag = args.includes('--help') || args.includes('-h');

// Get environment from various sources
const environment = envFlag || process.env.TEST_ENV || 'production';

// Validate environment
const validEnvironments = ['local', 'staging', 'production'];
if (!validEnvironments.includes(environment)) {
    console.error(`❌ Invalid environment: ${environment}`);
    console.error(`Valid environments: ${validEnvironments.join(', ')}`);
    process.exit(1);
}

// Show help
if (helpFlag) {
    console.log(`
Newsletter Smoke Test Email Cleanup Script

Usage:
  node tests/cleanup-smoke-tests.js [options]

Options:
  --env <environment>     Environment to clean (local, staging, production)
  --from-file <file>      Read emails from file instead of querying database
  --help, -h              Show this help message

Environment Variables:
  TEST_ENV                Set environment (overridden by --env flag)

Examples:
  node tests/cleanup-smoke-tests.js
  node tests/cleanup-smoke-tests.js --env staging
  node tests/cleanup-smoke-tests.js --from-file smoke-test-emails.txt
  TEST_ENV=staging node tests/cleanup-smoke-tests.js

The script will:
1. Find all emails matching smoke test patterns
2. Remove them from the database
3. Show cleanup summary
4. Remove the email file if --from-file was used
`);
    process.exit(0);
}

console.log(`🧹 Newsletter Smoke Test Email Cleanup`);
console.log(`Environment: ${environment}`);
console.log('=====================================');

/**
 * Execute wrangler command and return result
 */
function executeWranglerCommand(command, expectJson = false) {
    try {
        console.log(`Executing: ${command}`);
        const result = execSync(command, {
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'pipe']
        });

        if (expectJson) {
            try {
                return JSON.parse(result);
            } catch (e) {
                console.error('Failed to parse JSON response:', result);
                throw e;
            }
        }

        return result;
    } catch (error) {
        console.error(`Command failed: ${command}`);
        console.error(`Error: ${error.message}`);
        if (error.stdout) console.error(`Stdout: ${error.stdout}`);
        if (error.stderr) console.error(`Stderr: ${error.stderr}`);
        throw error;
    }
}

/**
 * Query database for smoke test emails
 */
async function getSmokeTestEmailsFromDatabase() {
    console.log('🔍 Querying database for smoke test emails...');

    // Different patterns for different environments
    // Updated to handle both old smoke-test.example.com and new plus addressing patterns
    const patterns = [
        '%smoke-test%@smoke-test.example.com',  // Legacy pattern
        '%staging-smoke-test%@smoke-test.example.com',  // Legacy pattern
        'test+%smoke-test%@rnwolf.net',  // New plus addressing pattern
        'test+%staging-smoke-test%@rnwolf.net'  // New plus addressing pattern
    ];

    let allEmails = [];

    for (const pattern of patterns) {
        const remoteFlag = environment !== 'local' ? '--remote' : '';
        const query = `SELECT email FROM subscribers WHERE email LIKE '${pattern}';`;
        const command = `npx wrangler d1 execute DB --env ${environment} ${remoteFlag} --command="${query}" --json`;

        try {
            const result = executeWranglerCommand(command, true);

            if (result.success && result.result && result.result[0] && result.result[0].results) {
                const emails = result.result[0].results.map(row => row.email);
                allEmails = allEmails.concat(emails);
                console.log(`Found ${emails.length} emails matching pattern: ${pattern}`);
            }
        } catch (error) {
            console.warn(`Failed to query pattern ${pattern}:`, error.message);
        }
    }

    // Remove duplicates
    return [...new Set(allEmails)];
}

/**
 * Read emails from file
 */
function getSmokeTestEmailsFromFile(filename) {
    console.log(`📁 Reading emails from file: ${filename}`);

    if (!fs.existsSync(filename)) {
        throw new Error(`File not found: ${filename}`);
    }

    const fileContent = fs.readFileSync(filename, 'utf8');
    const emails = fileContent
        .split('\n')
        .map(email => email.trim())
        .filter(email => email.length > 0)
        .filter(email => 
            email.includes('@smoke-test.example.com') || 
            (email.startsWith('test+') && email.includes('@rnwolf.net'))
        );

    console.log(`Found ${emails.length} smoke test emails in file`);
    return emails;
}

/**
 * Delete email from database
 */
function deleteEmailFromDatabase(email) {
    // Escape single quotes in email for SQL
    const escapedEmail = email.replace(/'/g, "''");
    const remoteFlag = environment !== 'local' ? '--remote' : '';
    const command = `npx wrangler d1 execute DB --env ${environment} ${remoteFlag} --command="DELETE FROM subscribers WHERE email = '${escapedEmail}';"`;

    executeWranglerCommand(command);
}

/**
 * Main cleanup function
 */
async function cleanupSmokeTestEmails() {
    try {
        let emailsToCleanup = [];

        if (fromFile) {
            emailsToCleanup = getSmokeTestEmailsFromFile(fromFile);
        } else {
            emailsToCleanup = await getSmokeTestEmailsFromDatabase();
        }

        if (emailsToCleanup.length === 0) {
            console.log('✅ No smoke test emails found to cleanup');
            return;
        }

        console.log(`\n🗑️  Found ${emailsToCleanup.length} emails to cleanup:`);
        emailsToCleanup.forEach((email, index) => {
            console.log(`  ${index + 1}. ${email}`);
        });

        // Confirm deletion for production
        if (environment === 'production' && !fromFile) {
            console.log('\n⚠️  WARNING: About to delete emails from PRODUCTION database!');
            const readline = require('readline').createInterface({
                input: process.stdin,
                output: process.stdout
            });

            const answer = await new Promise(resolve => {
                readline.question('Continue? (yes/no): ', resolve);
            });
            readline.close();

            if (answer.toLowerCase() !== 'yes') {
                console.log('❌ Cleanup cancelled by user');
                return;
            }
        }

        console.log('\n🧹 Starting cleanup...');
        let successCount = 0;
        let errorCount = 0;

        for (const email of emailsToCleanup) {
            try {
                console.log(`Removing: ${email}`);
                deleteEmailFromDatabase(email);
                successCount++;
                console.log(`✅ Removed: ${email}`);
            } catch (error) {
                errorCount++;
                console.error(`❌ Failed to remove ${email}: ${error.message}`);
            }
        }

        console.log('\n📊 Cleanup Summary:');
        console.log(`  Successfully removed: ${successCount}`);
        console.log(`  Errors: ${errorCount}`);
        console.log(`  Total processed: ${successCount + errorCount}`);

        // Clean up the emails file if it was provided and we're done
        if (fromFile && fs.existsSync(fromFile) && errorCount === 0) {
            try {
                fs.unlinkSync(fromFile);
                console.log(`🗑️  Removed emails file: ${fromFile}`);
            } catch (error) {
                console.warn(`⚠️  Could not remove emails file: ${error.message}`);
            }
        }

        if (successCount > 0) {
            console.log('✅ Cleanup completed successfully!');
        }

        if (errorCount > 0) {
            console.log(`⚠️  ${errorCount} errors occurred during cleanup`);
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        console.error('\nTroubleshooting tips:');
        console.error('1. Make sure wrangler is installed and authenticated');
        console.error('2. Check that the database exists for the specified environment');
        console.error('3. Verify environment permissions');
        console.error('4. Try running: npx wrangler auth login');
        process.exit(1);
    }
}

/**
 * Validate prerequisites
 */
function validatePrerequisites() {
    try {
        execSync('npx wrangler --version', { stdio: 'pipe' });
    } catch (error) {
        console.error('❌ Wrangler CLI not found or not working');
        console.error('Please install it with: npm install -g wrangler');
        process.exit(1);
    }

    // Check if wrangler.jsonc exists
    const wranglerConfig = path.join(process.cwd(), 'wrangler.jsonc');
    if (!fs.existsSync(wranglerConfig)) {
        console.error('❌ wrangler.jsonc not found in current directory');
        console.error('Please run this script from the project root directory');
        process.exit(1);
    }
}

// Run the cleanup
if (require.main === module) {
    validatePrerequisites();
    cleanupSmokeTestEmails().catch(error => {
        console.error('❌ Unexpected error:', error);
        process.exit(1);
    });
}

module.exports = {
    cleanupSmokeTestEmails,
    getSmokeTestEmailsFromDatabase,
    getSmokeTestEmailsFromFile,
    deleteEmailFromDatabase
};