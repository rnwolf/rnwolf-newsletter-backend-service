#!/usr/bin/env node

// Load environment variables from .env.jam file
require('dotenv').config({ path: './.env.jam' });

console.log("--- JMAP Hello World Script (using raw fetch) ---");
console.log(`Current Time (UK): ${new Date().toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone: 'Europe/London' })}`);

// --- Configuration from Environment Variables ---
// Using names as per the provided hello-world.js example for direct mapping
const hostname = process.env.JMAP_HOSTNAME;
const username = process.env.JMAP_USERNAME;
const token =  "93585w783r2v6c8q"; // process.env.JMAP_TOKEN

// Derived variables
const authUrl = `https://${hostname}/.well-known/jmap`;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
};

// Also pull in recipient/subject/body from .env.jam for the draft creation
const JMAP_RECIPIENT = process.env.JMAP_RECIPIENT;
const EMAIL_SUBJECT = process.env.EMAIL_SUBJECT || "Hello, world! from Raw JMAP Fetch";
const EMAIL_BODY = process.env.EMAIL_BODY || "Default email body from raw JMAP fetch example.";


console.log("\n--- Configuration Check ---");
console.log(`Loading env from: .env.jam`);
console.log(`JMAP_HOSTNAME: ${hostname ? 'Set' : 'NOT SET'} (Value: ${hostname})`);
console.log(`JMAP_USERNAME: ${username ? 'Set' : 'NOT SET'} (Value: ${username})`);
console.log(`JMAP_TOKEN: ${token ? 'Set (masked)' : 'NOT SET'}`);
console.log(`Derived Auth URL: ${authUrl}`);
console.log(`JMAP_RECIPIENT: ${JMAP_RECIPIENT}`);
console.log(`EMAIL_SUBJECT: "${EMAIL_SUBJECT}"`);
console.log(`EMAIL_BODY (excerpt): "${EMAIL_BODY.substring(0, Math.min(EMAIL_BODY.length, 70))}..."`);


// --- Basic validation for essential variables ---
if (!username || !token || !hostname) {
  console.error("\nCRITICAL ERROR: Please set JMAP_USERNAME, JMAP_TOKEN, and JMAP_HOSTNAME in your .env.jam file.");
  console.error("Example: JMAP_USERNAME=your@email.com JMAP_TOKEN=your_token JMAP_HOSTNAME=api.fastmail.com");
  process.exit(1);
}

// --- JMAP API Functions (adapted from original example) ---

const getSession = async () => {
  console.log("\nStep 1: Getting JMAP Session from Well-Known URL...");
  console.log(`  Fetching from: ${authUrl}`);
  try {
    const response = await fetch(authUrl, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
        console.error(`  ERROR: HTTP status ${response.status} - ${response.statusText}`);
        const errorText = await response.text();
        console.error(`  Server Response: ${errorText.substring(0, 500)}...`); // Log part of the response
        throw new Error(`Failed to get JMAP session: ${response.statusText}`);
    }
    const sessionData = await response.json();
    console.log("  DEBUG: JMAP Session data received successfully.");
    // console.log("  Full Session Data:", JSON.stringify(sessionData, null, 2)); // Uncomment for full session debug
    return sessionData;
  } catch (error) {
    console.error("  ERROR during getSession:", error.message);
    throw error; // Re-throw to be caught by main run function
  }
};

const mailboxQuery = async (apiUrl, accountId) => {
  console.log("\nStep 3: Querying Mailbox for 'Drafts' ID...");
  const requestBody = JSON.stringify({
    using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    methodCalls: [
      ["Mailbox/query", { accountId, filter: { name: "Drafts" } }, "a"],
    ],
  });
  console.log(`  Sending request to: ${apiUrl}`);
  // console.log("  Request Body:", requestBody); // Uncomment for full request body debug

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (!response.ok) {
        console.error(`  ERROR: HTTP status ${response.status} - ${response.statusText}`);
        const errorText = await response.text();
        console.error(`  Server Response: ${errorText.substring(0, 500)}...`);
        throw new Error(`Failed to query Mailbox: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("  DEBUG: Mailbox query response received.");
    // console.log("  Full Mailbox Query Data:", JSON.stringify(data, null, 2)); // Uncomment for full response debug

    // Check for JMAP errors in the response
    if (data.methodResponses && data.methodResponses[0] && data.methodResponses[0][0] === 'error') {
        const errorDetails = data.methodResponses[0][1];
        console.error(`  JMAP Error in Mailbox/query: ${errorDetails.type} - ${errorDetails.description || 'No description'}`);
        throw new Error(`JMAP Mailbox/query error: ${errorDetails.type}`);
    }

    if (!data["methodResponses"] || !data["methodResponses"][0] || !data["methodResponses"][0][1] || !data["methodResponses"][0][1].ids || data["methodResponses"][0][1].ids.length === 0) {
        console.error("  ERROR: 'Drafts' mailbox ID not found in the response.");
        console.error("  Response might indicate no 'Drafts' mailbox or a filter issue.");
        throw new Error("Drafts mailbox ID not found.");
    }
    const draftId = data["methodResponses"][0][1].ids[0];
    console.log(`  SUCCESS: Drafts Mailbox ID: ${draftId}`);
    return draftId;
  } catch (error) {
    console.error("  ERROR during mailboxQuery:", error.message);
    throw error;
  }
};

const identityQuery = async (apiUrl, accountId) => {
  console.log("\nStep 4: Querying Identity for sender email ID...");
  const requestBody = JSON.stringify({
    using: [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ],
    methodCalls: [["Identity/get", { accountId, ids: null }, "a"]],
  });
  console.log(`  Sending request to: ${apiUrl}`);
  // console.log("  Request Body:", requestBody); // Uncomment for full request body debug

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (!response.ok) {
        console.error(`  ERROR: HTTP status ${response.status} - ${response.statusText}`);
        const errorText = await response.text();
        console.error(`  Server Response: ${errorText.substring(0, 500)}...`);
        throw new Error(`Failed to query Identity: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("  DEBUG: Identity query response received.");
    // console.log("  Full Identity Query Data:", JSON.stringify(data, null, 2)); // Uncomment for full response debug

    // Check for JMAP errors
    if (data.methodResponses && data.methodResponses[0] && data.methodResponses[0][0] === 'error') {
        const errorDetails = data.methodResponses[0][1];
        console.error(`  JMAP Error in Identity/get: ${errorDetails.type} - ${errorDetails.description || 'No description'}`);
        throw new Error(`JMAP Identity/get error: ${errorDetails.type}`);
    }

    if (!data["methodResponses"] || !data["methodResponses"][0] || !data["methodResponses"][0][1] || !data["methodResponses"][0][1].list) {
        console.error("  ERROR: Identity list not found in the response.");
        throw new Error("Identity list not found.");
    }

    const identity = data["methodResponses"][0][1].list.filter(
      (id) => id.email === username
    )[0];

    if (!identity) {
        console.error(`  ERROR: No identity found for username: ${username}`);
        console.error("  Ensure your JMAP account has an identity matching your JMAP_USERNAME.");
        throw new Error(`Identity not found for ${username}`);
    }
    console.log(`  SUCCESS: Identity ID for ${username}: ${identity.id}`);
    return identity.id;
  } catch (error) {
    console.error("  ERROR during identityQuery:", error.message);
    throw error;
  }
};

const draftAndSendEmail = async (apiUrl, accountId, draftId, identityId) => {
  console.log("\nStep 5: Preparing and Sending Email...");
  const messageBody = EMAIL_BODY; // Use the EMAIL_BODY from .env.jam

  const draftObject = {
    from: [{ email: username }], // Uses JMAP_USERNAME for from address
    to: [{ email: JMAP_RECIPIENT }], // Uses JMAP_RECIPIENT from .env.jam
    subject: EMAIL_SUBJECT, // Uses EMAIL_SUBJECT from .env.jam
    keywords: { $draft: true },
    mailboxIds: { [draftId]: true },
    bodyValues: { "text/plain": { value: messageBody, isEncodingProblem: false, isTruncated: false } }, // Corrected bodyValues structure
  };

  const requestBody = JSON.stringify({
    using: [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:ietf:params:jmap:submission",
    ],
    methodCalls: [
      ["Email/set", { accountId, create: { draft: draftObject } }, "a"],
      [
        "EmailSubmission/set",
        {
          accountId,
          onSuccessDestroyEmail: ["#sendIt"], // Tells JMAP to destroy the draft after sending
          create: { sendIt: { emailId: "#draft", identityId } }, // "#draft" refers to the created draft from "a"
        },
        "b",
      ],
    ],
  });
  console.log(`  Sending request to: ${apiUrl}`);
  // console.log("  Request Body:", requestBody); // Uncomment for full request body debug

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: requestBody,
    });

    if (!response.ok) {
        console.error(`  ERROR: HTTP status ${response.status} - ${response.statusText}`);
        const errorText = await response.text();
        console.error(`  Server Response: ${errorText.substring(0, 500)}...`);
        throw new Error(`Failed to create/send email: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("  DEBUG: Email send response received.");
    console.log("  Full Email Send Response:", JSON.stringify(data, null, 2)); // Always log the full response for send operation

    // Check for JMAP errors in the overall response
    if (data.methodResponses) {
        let hasError = false;
        data.methodResponses.forEach(methodResponse => {
            if (methodResponse[0] === 'error') {
                hasError = true;
                const errorDetails = methodResponse[1];
                console.error(`  JMAP Error in ${methodResponse[0]} method: ${errorDetails.type} - ${errorDetails.description || 'No description'}`);
            }
        });
        if (hasError) {
            throw new Error("One or more JMAP methods failed during email creation/submission.");
        }
    }

    const emailCreated = data.methodResponses?.find(mr => mr[0] === 'Email/set' && mr[1]?.created?.draft);
    const submissionCreated = data.methodResponses?.find(mr => mr[0] === 'EmailSubmission/set' && mr[1]?.created?.sendIt);

    if (emailCreated && submissionCreated) {
        console.log("\nSUCCESS: Email draft created and submission initiated!");
        console.log(`Email ID: ${Object.keys(emailCreated[1].created.draft)[0]}`);
        console.log(`Submission ID: ${Object.keys(submissionCreated[1].created.sendIt)[0]}`);
        console.log(`Test email successfully handed off to JMAP server for sending to ${JMAP_RECIPIENT}!`);
        console.log("Please check the recipient's inbox and your JMAP account's 'Sent' folder for verification.");
    } else {
        console.error("ERROR: Email creation or submission did not complete successfully according to JMAP response.");
        console.error("See 'Full Email Send Response' above for details.");
        throw new Error("Email creation/submission failed.");
    }

  } catch (error) {
    console.error("  ERROR during draftAndSendEmail:", error.message);
    throw error;
  }
};

// --- Main execution function ---
const run = async () => {
  try {
    const session = await getSession();
    const apiUrl = session.apiUrl;
    const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];

    console.log(`\nStep 2: Session Data Extracted:`);
    console.log(`  API URL: ${apiUrl}`);
    console.log(`  Primary Mail Account ID: ${accountId}`);

    if (!accountId) {
        console.error("CRITICAL ERROR: Could not find primary Mail account ID in session.");
        console.error("Ensure your JMAP_TOKEN has 'mail' capabilities and is valid.");
        return;
    }

    const draftId = await mailboxQuery(apiUrl, accountId);
    const identityId = await identityQuery(apiUrl, accountId);
    await draftAndSendEmail(apiUrl, accountId, draftId, identityId);

  } catch (error) {
    console.error("\n--- AN UNEXPECTED ERROR OCCURRED (Main Run) ---");
    console.error("Error details:", error.message);
    console.error("Full Error Object (if available):", error);
    console.error("\nReview logs above for more specific step-by-step errors.");
  } finally {
    console.log("\n--- Script execution finished. ---");
  }
};

// Execute the main asynchronous function.
run();