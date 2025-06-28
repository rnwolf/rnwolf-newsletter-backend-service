// Load environment variables from .env.jam file
require('dotenv').config({ path: './.env.jmap' });

// --- CORRECTED IMPORT STATEMENT ---
// Import the entire 'jmap-jam' module.
const jmapJamModule = require('jmap-jam');

// The main client class is exported as 'JamClient'.
const JamClient = jmapJamModule.JamClient;

// JMAP constants (like Core.Type) are available under the `JMAP` property of the module.
// The previous debug output shows JMAP as undefined, which means the structure isn't
// `jmapJamModule.JMAP` directly.
// Let's re-evaluate based on the library's actual structure from common practices.
// The `JMAP` types often come as a separate named export, or are accessible
// via a top-level 'JMAP' property on the module itself.
// Since `jmapJamModule.JMAP` was `undefined`, let's try destructuing `JMAP` directly
// from the require, which is a common pattern for libraries that export multiple things.
// If not, we might need to resort to `import * as JMAP from 'jmap-jam/JMAP';` or similar
// if the library has sub-paths for types.
// However, the common approach for libraries like this is to include it as `JMAP`
// in the named exports. So, let's try:
const { JMAP } = require('jmap-jam'); // Try to import JMAP directly as a named export.

// If `JMAP` is still `undefined` after this, then we may need to define it manually
// from the `jmap-jam` types if they are not exported as a commonjs module,
// or use `import` syntax if we're in an ESM context.
// For now, let's stick with this most common pattern given your previous output
// which shows `JamClient` and other functions.

// --- END CORRECTED IMPORT ---


// --- NEW DEBUGGING FOR IMPORTS ---
console.log("\n--- Debugging Import Statement (After Correction) ---");
console.log(`DEBUG: Value of jmapJamModule:`, jmapJamModule);
console.log(`Type of JMAP: ${typeof JMAP}`);
console.log(`Value of JMAP:`, JMAP); // Should now show the JMAP constants object if the direct import works

console.log(`Type of JamClient: ${typeof JamClient}`);
console.log(`Value of JamClient:`, JamClient);

if (typeof JamClient !== 'function') {
    console.error("CRITICAL IMPORT ERROR: JamClient is NOT a function (constructor). This is unexpected after previous debug.");
    process.exit(1);
} else {
    console.log("DEBUG: JamClient seems to be a function (constructor). Good!");
}
console.log("--- End Debugging Import Statement ---\n");
// --- END NEW DEBUGGING ---


// --- Configuration from Environment Variables ---
const JMAP_HOST = process.env.JMAP_HOST;
const JMAP_API_TOKEN = process.env.JMAP_API_TOKEN;
const JMAP_RECIPIENT = process.env.JMAP_RECIPIENT;
const JMAP_SENDER = process.env.JMAP_SENDER;
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT || "JMAP Test Email";
const EMAIL_BODY = process.env.EMAIL_BODY || "This is a test email body from JMAP.";

console.log("--- JMAP Email Sender Script (using .env.jam) ---");
console.log(`Current Time (UK): ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/London' })}`);
console.log("\n--- Configuration Check ---");
console.log(`Loading env from: .env.jam`);
console.log(`JMAP_HOST: ${JMAP_HOST ? 'Set' : 'NOT SET'}`);
console.log(`JMAP_API_TOKEN: ${JMAP_API_TOKEN ? 'Set (masked)' : 'NOT SET'}`);
console.log(`JMAP_RECIPIENT: ${JMAP_RECIPIENT}`);
console.log(`JMAP_SENDER: ${JMAP_SENDER}`);
console.log(`EMAIL_SUBJECT: "${EMAIL_SUBJECT}"`);
console.log(`EMAIL_BODY (excerpt): "${EMAIL_BODY.substring(0, Math.min(EMAIL_BODY.length, 70))}..."`);

// Basic validation for essential variables
if (!JMAP_HOST || !JMAP_API_TOKEN || !JMAP_RECIPIENT || !JMAP_SENDER) {
    console.error("\nCRITICAL ERROR: One or more required environment variables are missing.");
    console.error("Please ensure JMAP_HOST, JMAP_API_TOKEN, JMAP_RECIPIENT, and JMAP_SENDER are set in your .env.jam file.");
    console.error("Exiting script.");
    process.exit(1);
}

/**
 * Sends a test email using JMAP.
 */
async function sendTestEmail() {
    console.log("\n--- Starting Email Sending Process ---");

    let client;

    try {
        console.log("Step 1: Initializing JMAP client...");
        // Use JamClient
        client = new JamClient({
            sessionUrl: JMAP_HOST, // This must be the correct JMAP session URL
            bearerToken: JMAP_API_TOKEN,
        });
        console.log("DEBUG: JMAP client instance created. Attempting session load.");

        // --- CORRECTED SESSION ACCESS ---
        // JamClient's constructor is asynchronous and likely handles session loading internally.
        // We access the session via `client.session` property, which should be populated
        // after the client is successfully constructed.
        const session = client.session;
        if (!session) {
            console.error("ERROR: JMAP session object is null or undefined after client initialization.");
            console.error("This suggests an issue with the JMAP_HOST, JMAP_API_TOKEN, or server availability during client construction.");
            // If the session isn't immediately available, it might be that the constructor
            // returns a Promise that needs to be awaited for the session to be ready.
            // However, typical usage of this library indicates direct property access.
            // The HTML error was the primary culprit for this part previously.
            return;
        }
        console.log("DEBUG: JMAP session accessed successfully from client.session.");
        // --- END CORRECTED SESSION ACCESS ---


        console.log("Step 3: Identifying primary Mailbox account ID...");
        // Ensure JMAP.Core.Type.Mailbox is correctly defined
        if (!JMAP || !JMAP.Core || !JMAP.Core.Type || !JMAP.Core.Type.Mailbox) {
            console.error("ERROR: JMAP constants (JMAP.Core.Type.Mailbox) are not properly defined.");
            console.error("This indicates an issue with the JMAP import. Check the console output for `Value of JMAP:` to see its structure.");
            // If JMAP constants are still an issue here, you might need to manually define
            // JMAP.Core.Type.Mailbox as a string 'urn:ietf:params:jmap:mail:Mailbox'
            // for the purpose of getting the Mailbox Account ID, as a temporary workaround.
            // console.log("Falling back to string literal for Mailbox Type ID.");
            // const mailBoxType = 'urn:ietf:params:jmap:mail:Mailbox';
            return;
        }
        const accountId = session.primaryAccounts.get(JMAP.Core.Type.Mailbox);


        if (!accountId) {
            console.error("ERROR: No primary Mailbox account found in JMAP session.");
            console.error("This usually means your JMAP_API_TOKEN is invalid or doesn't have mail access, or JMAP_HOST is incorrect.");
            return;
        }
        console.log(`DEBUG: Identified Mailbox Account ID: ${accountId}`);

        console.log("Step 4: Locating Mailbox IDs for 'drafts' and 'sent' roles...");
        const mailboxState = session.session.state.get(JMAP.Core.Type.Mailbox);
        const draftsMailboxId = mailboxState?.["urn:ietf:params:jmap:mail:Mailbox"]?.role?.drafts;
        const sentMailboxId = mailboxState?.["urn:ietf:params:jmap:mail:Mailbox"]?.role?.sent;

        console.log(`DEBUG: Drafts Mailbox ID: ${draftsMailboxId || 'Not found directly via role (server might use default)'}`);
        console.log(`DEBUG: Sent Mailbox ID: ${sentMailboxId || 'Not found directly via role (server might use default)'}`);

        console.log("Step 5: Preparing the Email object (as a draft)...");
        const emailCreationRequest = {
            accountId: accountId,
            create: {
                newEmail: {
                    from: [{ email: JMAP_SENDER, name: "JMAP Test Sender" }],
                    to: [{ email: JMAP_RECIPIENT }],
                    subject: EMAIL_SUBJECT,
                    bodyValues: {
                        "text/plain": {
                            value: EMAIL_BODY,
                            isEncodingProblem: false,
                            isTruncated: false,
                        },
                    },
                    mailboxIds: draftsMailboxId ? { [draftsMailboxId]: true } : undefined,
                    keywords: { "$draft": true },
                },
            },
        };

        console.log("Step 6: Calling Email/set to create the draft email on the server...");
        const createEmailResult = await client.email.set(emailCreationRequest);
        const newEmailId = Object.keys(createEmailResult.created || {})[0];

        if (!newEmailId) {
            console.error("ERROR: Failed to create email in drafts on the server.");
            if (createEmailResult.notCreated) {
                console.error("Server reported errors for creation:", JSON.stringify(createEmailResult.notCreated, null, 2));
            }
            return;
        }
        console.log(`SUCCESS: Draft email created on server with ID: ${newEmailId}`);

        console.log("Step 7: Identifying a JMAP Identity for sending...");
        const identityId = Array.from(session.identities.keys())[0];

        if (!identityId) {
            console.error("ERROR: No sending identity found for your JMAP account.");
            console.error("Ensure your JMAP account has at least one sender identity configured (e.g., in Fastmail settings).");
            return;
        }
        console.log(`DEBUG: Identified Sending Identity ID: ${identityId}`);

        console.log("Step 8: Preparing the EmailSubmission object...");
        const emailSubmissionRequest = {
            accountId: accountId,
            create: {
                newSubmission: {
                    emailId: newEmailId,
                    identityId: identityId,
                    onSuccessDestroyEmail: false,
                    onSuccessUpdateEmail: {
                        mailboxIds: {
                            ...(sentMailboxId ? { [sentMailboxId]: true } : {}),
                            ...(draftsMailboxId ? { [draftsMailboxId]: null } : {})
                        },
                        keywords: { "$draft": null, "$seen": true }
                    }
                },
            },
        };

        console.log("Step 9: Calling EmailSubmission/set to send the email...");
        const submitEmailResult = await client.emailSubmission.set(emailSubmissionRequest);
        const submissionId = Object.keys(submitEmailResult.created || {})[0];

        if (!submissionId) {
            console.error("ERROR: Failed to create email submission (sending failed to initiate).");
            if (submitEmailResult.notCreated) {
                console.error("Server reported errors for submission:", JSON.stringify(submitEmailResult.notCreated, null, 2));
            }
            return;
        }
        console.log(`SUCCESS: Email submission initiated with ID: ${submissionId}`);
        console.log("\n--- Email Sending Process Complete ---");
        console.log(`Test email successfully handed off to JMAP server for sending to ${JMAP_RECIPIENT}!`);
        console.log("Please check the recipient's inbox and your JMAP account's 'Sent' folder for verification.");

    } catch (error) {
        console.error("\n--- AN UNEXPECTED ERROR OCCURRED ---");
        console.error("Error details:", error.message);
        console.error("Full Error Object (if available):", error);
        console.error("Common issues: Incorrect JMAP_HOST, invalid JMAP_API_TOKEN, or network problems.");
    } finally {
        console.log("\n--- Script execution finished. ---");
    }
}

// Execute the main asynchronous function.
sendTestEmail();