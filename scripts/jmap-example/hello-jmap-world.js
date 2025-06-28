#!/usr/bin/env node
// bail if we don't have our ENV set:
if (!process.env.JMAP_SENDER || !process.env.JMAP_USERNAME || !process.env.JMAP_API_TOKEN) {
  console.log("Please set your JMAP_SENDER, JMAP_USERNAME, and JMAP_API_TOKEN");
  console.log("JMAP_SENDER=sendername JMAP_USERNAME=username JMAP_API_TOKEN=token node hello-world.js");

  process.exit(1);
}

const hostname = process.env.JMAP_HOSTNAME || "api.fastmail.com";
const sendername = process.env.JMAP_SENDER;
const username = process.env.JMAP_USERNAME;


console.log(`JMAP_HOSTNAME: ${hostname}`);
console.log(`JMAP_SENDER: ${sendername}`);
console.log(`JMAP_USERNAME: ${username}`);

const authUrl = `https://${hostname}/.well-known/jmap`;
const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${process.env.JMAP_API_TOKEN}`,
};

const getSession = async () => {
  const response = await fetch(authUrl, {
    method: "GET",
    headers,
  });
  return response.json();
};

const mailboxQuery = async (apiUrl, accountId) => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        ["Mailbox/query", { accountId, filter: { name: "Drafts" } }, "a"],
      ],
    }),
  });
  const data = await response.json();

  return await data["methodResponses"][0][1].ids[0];
};

const identityQuery = async (apiUrl, accountId) => {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      using: [
        "urn:ietf:params:jmap:core",
        "urn:ietf:params:jmap:mail",
        "urn:ietf:params:jmap:submission",
      ],
      methodCalls: [["Identity/get", { accountId, ids: null }, "a"]],
    }),
  });
  const data = await response.json();

  return await data["methodResponses"][0][1].list.filter(
    (identity) => identity.email === username
  )[0].id;
};

const draftResponse = async (apiUrl, accountId, draftId, identityId) => {
  console.log(`accountId: ${accountId}`);
  console.log(`identityId: ${identityId}`);
  console.log(`draftId: ${draftId}`);

  const messageBodyText =
    "Hi! \n\n" +
    "This email may not look like much, but I sent it with JMAP, a protocol \n" +
    "designed to make it easier to manage email, contacts, calendars, and more of \n" +
    "your digital life in general. \n\n" +
    "Pretty cool, right? \n\n" +
    "-- \n" +
    "This email sent from my next-generation email system at Fastmail. \n";

  const messageBodyHtml =
    "<p>Hi!</p>" +
    "<p>This email may not look like much, but I sent it with <b>JMAP</b>, a protocol<br>" +
    "designed to make it easier to manage email, contacts, calendars, and more of<br>" +
    "your digital life in general.</p>" +
    "<p>Pretty cool, right?</p>" +
    "<hr>" +
    "<p>This email sent from my next-generation email system at Fastmail.</p>";

  const draftObject = {
    from: [{ email: sendername }],
    to: [{ email: username }],
    subject: "Hello, world!",
    keywords: { $draft: true },
    mailboxIds: { [draftId]: true },
    bodyValues: {
      textBody: { value: messageBodyText, charset: "utf-8" },
      htmlBody: { value: messageBodyHtml, charset: "utf-8" }
    },
    textBody: [{ partId: "textBody", type: "text/plain" }],
    htmlBody: [{ partId: "htmlBody", type: "text/html" }]
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
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
            onSuccessDestroyEmail: ["#sendIt"],
            create: { sendIt: { emailId: "#draft", identityId } },
          },
          "b",
        ],
      ],
    }),
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
};

const run = async () => {
  const session = await getSession();
  const apiUrl = session.apiUrl;
  const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];
  const draftId = await mailboxQuery(apiUrl, accountId);
  const identityId = await identityQuery(apiUrl, accountId);
  draftResponse(apiUrl, accountId, draftId, identityId);
};

run();