#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["jmapc"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///
#!/usr/bin/env python3

import os

from jmapc import (
    Address,
    Client,
    Email,
    EmailAddress,
    EmailBodyPart,
    EmailBodyValue,
    EmailHeader,
    EmailSubmission,
    Envelope,
    Identity,
    MailboxQueryFilterCondition,
    Ref,
)
from jmapc.methods import (
    EmailSet,
    EmailSubmissionSet,
    EmailSubmissionSetResponse,
    IdentityGet,
    IdentityGetResponse,
    MailboxGet,
    MailboxGetResponse,
    MailboxQuery,
)

TEST_EMAIL_BODY = f"""
Hello from {__file__}!

If you're reading this email in your inbox, the example worked successfully!

This email was created with the JMAP API and sent to yourself using the first
identity's email address in your account.
""".strip()

JMAP_HOST = os.environ.get("JMAP_HOST")
print(JMAP_HOST)

# Create and configure client
client = Client.create_with_api_token(
    host=os.environ["JMAP_HOST"], api_token=os.environ["JMAP_API_TOKEN"]
)

# Retrieve the Mailbox ID for Drafts
results = client.request(
    [
        MailboxQuery(filter=MailboxQueryFilterCondition(name="Drafts")),
        MailboxGet(ids=Ref("/ids")),
        IdentityGet(),
    ]
)

# From results, second result, MailboxGet instance, retrieve Mailbox data
assert isinstance(
    results[1].response, MailboxGetResponse
), "Error in Mailbox/get method"
mailbox_data = results[1].response.data
if not mailbox_data:
    raise Exception("Drafts not found on the server")

# From the first mailbox result, retrieve the Mailbox ID
drafts_mailbox_id = mailbox_data[0].id
assert drafts_mailbox_id

print(f"Drafts has Mailbox ID {drafts_mailbox_id}")

# From results, third result, IdentityGet instance, retrieve Identity data
assert isinstance(
    results[2].response, IdentityGetResponse
), "Error in Identity/get method"
identity_data = results[2].response.data
if not identity_data:
    raise Exception("No identities found on the server")

# Retrieve the first Identity result
identity = identity_data[0]
assert isinstance(identity, Identity)

print(f"Found identity with email address {identity.email}")

# Create and send an email
results = client.request(
    [
        # Create a draft email in the Drafts mailbox
        EmailSet(
            create=dict(
                draft=Email(
                    mail_from=[
                        EmailAddress(name=identity.name, email=identity.email)
                    ],
                    to=[
                        EmailAddress(name=identity.name, email=identity.email)
                    ],
                    subject=f"Email created with jmapc's {__file__}",
                    keywords={"$draft": True},
                    mailbox_ids={drafts_mailbox_id: True},
                    body_values=dict(
                        body=EmailBodyValue(value=TEST_EMAIL_BODY)
                    ),
                    text_body=[
                        EmailBodyPart(part_id="body", type="text/plain")
                    ],
                    headers=[
                        EmailHeader(name="X-jmapc-example-header", value="yes")
                    ],
                )
            )
        ),
        # Send the created draft email, and delete from the Drafts mailbox on
        # success
        EmailSubmissionSet(
            on_success_destroy_email=["#emailToSend"],
            create=dict(
                emailToSend=EmailSubmission(
                    email_id="#draft",
                    identity_id=identity.id,
                    envelope=Envelope(
                        mail_from=Address(email=identity.email),
                        rcpt_to=[Address(email=identity.email)],
                    ),
                )
            ),
        ),
    ]
)
# Retrieve EmailSubmission/set method response from method responses
email_send_result = results[1].response
assert isinstance(
    email_send_result, EmailSubmissionSetResponse
), f"Error sending test email: f{email_send_result}"

# Retrieve sent email metadata from EmailSubmission/set method response
assert email_send_result.created, "Error retrieving sent test email"
sent_data = email_send_result.created["emailToSend"]
assert sent_data, "Error retrieving sent test email data"

# Print sent email timestamp
print(f"Test email sent to {identity.email} at {sent_data.send_at}")

# Example output:
#
# Found the mailbox named Inbox with ID deadbeef-0000-0000-0000-000000000001
# Found identity with email address ness@onett.example.com
# Test email sent to ness@onett.example.com at 2022-01-01 12:00:00+00:00

# --- Configuration (Replace with your actual details) ---
# JMAP_HOST = "https://api.fastmail.com/jmap/" # Example for Fastmail
# API_TOKEN = os.environ["JMAP_NEWSLETTER_TOKEN"]  # Get this from environment variable
# SENDER_EMAIL = "rudi@rnwolf.net"
# RECIPIENT_EMAIL = "hello@throughputfocus.com"
# EMAIL_SUBJECT = "Hello from JMAP!"
# EMAIL_BODY = "This is a test email sent using the jmapc Python library."
