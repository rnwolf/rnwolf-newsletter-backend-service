#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///

import pprint
import os
from tiny_jmap_library import TinyJMAPClient

JMAP_HOSTNAME=os.environ.get("JMAP_HOSTNAME", "api.fastmail.com")
JMAP_USERNAME=os.environ.get("JMAP_USERNAME")
JMAP_API_TOKEN=os.environ.get("JMAP_API_TOKEN")

# Set up our client from the environment and set our account ID
client = TinyJMAPClient(
    hostname=JMAP_HOSTNAME,
    username=JMAP_USERNAME,
    token=JMAP_API_TOKEN,
)
account_id = client.get_account_id()

# Here, we're going to find our drafts mailbox, by calling Mailbox/query
query_res = client.make_jmap_call(
    {
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": [
            [
                "Mailbox/query",
                {"accountId": account_id, "filter": {"name": "Drafts"}},
                "a",
            ]
        ],
    }
)

# Pull out the id from the list response, and make sure we got it
draft_mailbox_id = query_res["methodResponses"][0][1]["ids"][0]
assert len(draft_mailbox_id) > 0

# Great! Now we're going to set up the data for the email we're going to send.
body = """
Hi!

This email may not look like much, but I sent it with JMAP, a protocol
designed to make it easier to manage email, contacts, calendars, and more of
your digital life in general.

Pretty cool, right?

--
This email sent from my next-generation email system at Fastmail.
"""

draft = {
    "from": [{"email": "=?UTF-8?q?R=C3=BCdiger's_Newsletter?= <newsletter@rnwolf.net>"}],
    "to": [{"email": "rudi@rnwolf.net"}],
    "subject": "Hello, world!",
    "keywords": {"$draft": True},
    "mailboxIds": {draft_mailbox_id: True},
    "bodyValues": {"body": {"value": body, "charset": "utf-8"}},
    "textBody": [{"partId": "body", "type": "text/plain"}],
}

identity_id = client.get_identity_id()

# Here, we make two calls in a single request. The first is an Email/set, to
# set our draft in our drafts folder, and the second is an
# EmailSubmission/set, to actually send the mail to ourselves. This requires
# an additional capability for submission.
create_res = client.make_jmap_call(
    {
        "using": [
            "urn:ietf:params:jmap:core",
            "urn:ietf:params:jmap:mail",
            "urn:ietf:params:jmap:submission",
        ],
        "methodCalls": [
            ["Email/set", {"accountId": account_id, "create": {"draft": draft}}, "a"],
            [
                "EmailSubmission/set",
                {
                    "accountId": account_id,
                    "onSuccessDestroyEmail": ["#sendIt"],
                    "create": {
                        "sendIt": {
                            "emailId": "#draft",
                            "identityId": identity_id,
                        }
                    },
                },
                "b",
            ],
        ],
    }
)

pprint.pprint(create_res)