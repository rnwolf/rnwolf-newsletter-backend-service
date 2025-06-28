// helloJMAP.js

// Load environment variables from .env.jam file
require('dotenv').config({ path: './.env.jam' });

// --- Import the JMAP client library ---
// For the 'jmap-client' package, you typically import 'Client' and 'JMAP' like this.
const { Client, JMAP } = require('jmap-client');

// --- Configuration from Environment Variables ---
const JMAP_HOST = process.env.JMAP_HOST;
const JMAP_API_TOKEN = process.env.JMAP_API_TOKEN;

console.log("--- JMAP Hello World Script (using jmap-client) ---");
console.log(`Current Time (UK): ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/London' })}`);
console.log("\n--- Configuration Check ---");
console.log(`Loading env from: .env.jam`);
console.log(`JMAP_HOST: ${JMAP_HOST ? 'Set' : 'NOT SET'} (Value: ${JMAP_HOST})`);
console.log(`JMAP_API_TOKEN: ${JMAP_API_TOKEN ? 'Set (masked)' : 'NOT SET'}`); // Mask token for logging

// Basic validation for essential variables
if (!JMAP_HOST || !JMAP_API_TOKEN) {
    console.error("\nCRITICAL ERROR: JMAP_HOST or JMAP_API_TOKEN environment variables are missing.");
    console.error("Please ensure JMAP_HOST (e.g., https://www.fastmail.com/.well-known/jmap) and JMAP_API_TOKEN are set in your .env.jam file.");
    process.exit(1); // Exit with an error code
}

// --- Debugging Import Statement for jmap-client ---
console.log("\n--- Debugging Import Statement for jmap-client ---");
console.log(`Type of Client: ${typeof Client}`);
console.log(`Value of Client:`, Client);
console.log(`Type of JMAP constants: ${typeof JMAP}`);
console.log(`Value of JMAP constants:`, JMAP);

if (typeof Client !== 'function') {
    console.error("CRITICAL IMPORT ERROR: 'Client' from 'jmap-client' is NOT a function (constructor).");
    console.error("This suggests `npm install jmap-client` failed or its exports have changed.");
    process.exit(1);
} else {
    console.log("DEBUG: 'Client' from 'jmap-client' seems to be a function (constructor). Good!");
}
if (typeof JMAP !== 'object' || JMAP === null || !JMAP.Core) {
    console.warn("WARNING: JMAP constants might not be fully loaded or structured as expected.");
    console.warn("Expected `JMAP` object with `Core` property. Check its value above.");
}
console.log("--- End Debugging Import Statement ---\n");


/**
 * Fetches and logs JMAP account information.
 */
async function getJmapAccountInfo() {
    console.log("\n--- Starting JMAP Connection Process ---");

    let client; // Declare client here for finally block

    try {
        console.log(`Step 1: Initializing JMAP client with URL: ${JMAP_HOST}`);
        // The JmapClient constructor takes an options object with 'url' and 'token'.
        client = new Client({
            url: JMAP_HOST,
            token: JMAP_API_TOKEN,
        });
        console.log("DEBUG: JMAP client instance created successfully.");

        console.log("Step 2: Authenticating and fetching account details...");
        // The `getAccount()` method establishes the session and fetches basic account info.
        const account = await client.getAccount();
        console.log("DEBUG: Account details fetched successfully.");

        if (!account) {
            console.error("ERROR: No account information returned from JMAP server.");
            console.error("This could mean your JMAP_API_TOKEN is invalid or lacks necessary permissions.");
            return;
        }

        console.log("\n--- JMAP Account Information ---");
        console.log(`Account ID: ${account.id}`);
        console.log(`Account Name: ${account.name || 'N/A'}`);
        console.log(`Account Capabilities:`, account.capabilities);
        console.log(`Primary Mailbox Account ID: ${account.getPrimaryAccount(JMAP.Core.Type.Mailbox)?.id || 'Not Found'}`);
        console.log(`Primary Core Account ID: ${account.getPrimaryAccount(JMAP.Core.Type.Core)?.id || 'Not Found'}`);

        console.log("\n--- JMAP Session Details (Direct Access) ---");
        // You can also directly access session properties after getAccount()
        const session = client.session;
        if (session) {
            console.log(`Session state: ${session.state}`);
            console.log(`Session Capabilities:`, session.capabilities);
            console.log(`Session Primary Accounts:`, session.primaryAccounts);
            console.log(`Session Identities:`, Array.from(session.identities.values()).map(id => id.email));
            // Log full session object for more detail if needed:
            // console.log("Full Session Object:", JSON.stringify(session, null, 2));
        } else {
            console.log("WARNING: Session object not available on client after getAccount().");
        }

        console.log("\n--- JMAP Hello World Complete! ---");
        console.log("If you see account details above, your JMAP client is successfully connecting.");

    } catch (error) {
        console.error("\n--- AN UNEXPECTED ERROR OCCURRED ---");
        console.error("Error details:", error.message);
        console.error("Full Error Object:", error); // Log the full error for more insight
        console.error("\nCommon issues:");
        console.error("1. Incorrect JMAP_HOST URL (e.g., missing https://, or wrong discovery URL).");
        console.error("2. Invalid JMAP_API_TOKEN (check permissions, expiry, typos).");
        console.error("3. Network connectivity issues.");
        console.error("4. Server-side problems with your JMAP provider.");
    } finally {
        // In jmap-client, there's no explicit close needed as it uses standard fetch.
        console.log("\n--- Script execution finished. ---");
    }
}

// Run the asynchronous function
getJmapAccountInfo();