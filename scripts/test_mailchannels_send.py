#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "dnspython"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///
# scripts/test_mailchannels_send.py
import os
import requests
import json
import sys
import dns.resolver # For DNS TXT record lookup
import datetime

# --- Configuration ---
MAILCHANNEL_API_KEY = os.environ.get("MAILCHANNEL_API_KEY")
MAILCHANNEL_AUTH_ID = os.environ.get("MAILCHANNEL_AUTH_ID")

# --- Test Email Details (Customize as needed) ---
# It's best to use a sender email address that is verified with MailChannels
# and a recipient email address that you control for testing.
SENDER_EMAIL = os.environ.get("SENDER_EMAIL")
SENDER_NAME = os.environ.get("SENDER_NAME", "Newsletter Test")
RECIPIENT_EMAIL = os.environ.get("RECIPIENT_EMAIL") # Set this environment variable to your test email to yourself
TEST_SUBJECT = "MailChannels Newsletter Test Email"
datetime_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

TEST_HTML_CONTENT = f"""
<h1>MailChannels API Newsletter Test Successful!</h1>
<p>This email was sent using the MailChannels API via a Python script.</p>
<p>If you received this, your API key and basic sending configuration are working.</p>
<p>Sent: {datetime_str}</p>
"""
TEST_TEXT_CONTENT = f"""
MailChannels API Newsletter Test Successful!
This email was sent using the MailChannels API via a Python script.
If you received this, your API key and basic sending configuration are working.
Sent: {datetime_str}
"""

# Your domain configured with MailChannels for DKIM
DOMAIN_TO_CHECK = SENDER_EMAIL.split('@')[1] if '@' in SENDER_EMAIL else None  # Domain to check for lockdown record

# --- Validation ---
if not MAILCHANNEL_API_KEY:
    print("Error: MAILCHANNEL_API_KEY environment variable not set.")
    sys.exit(1)
if not RECIPIENT_EMAIL:
    print("Error: RECIPIENT_EMAIL environment variable not set. Please set it to your test recipient address.")
    sys.exit(1)
if not SENDER_EMAIL:
    print("Warning: SENDER_EMAIL is not set.")
if not DOMAIN_TO_CHECK:
     print(f"Warning: Using DOMAIN_TO_CHECK: {DOMAIN_TO_CHECK} for Domain Lockdown record check. Ensure this is your sending domain.")


# --- MailChannels API Details ---
MAILCHANNELS_API_URL = "https://api.mailchannels.net/tx/v1/send"

headers = {
    "Content-Type": "application/json",
    "x-api-key": MAILCHANNEL_API_KEY,
    "X-MailChannels-Auth-Id": MAILCHANNEL_AUTH_ID if MAILCHANNEL_AUTH_ID else None,
}

payload = {
    "personalizations": [
        {
            "to": [{"email": RECIPIENT_EMAIL}],
        }
    ],
    "from": {
        "email": SENDER_EMAIL,
        "name": SENDER_NAME
    },
    "subject": TEST_SUBJECT,
    "content": [
        {
            "type": "text/plain",
            "value": TEST_TEXT_CONTENT
        },
        {
            "type": "text/html",
            "value": TEST_HTML_CONTENT
        }
    ]
}

# --- Domain Lockdown Check ---
def check_domain_lockdown(domain: str):
    """Checks for the MailChannels Domain Lockdown TXT record."""
    record_name = f"_mailchannels.{domain}"
    print(f"\nChecking Domain Lockdown TXT record for: {record_name}...")
    try:
        answers = dns.resolver.resolve(record_name, 'TXT')
        found_valid_record = False
        for rdata in answers:
            for txt_string in rdata.strings:
                txt_value = txt_string.decode('utf-8')
                print(f"  Found TXT record: {txt_value}")
                if txt_value.lower().startswith("v=mc1"): # MailChannels records start with v=mc1
                    found_valid_record = True
                    break  # Exit inner loop
            if found_valid_record:
                break  # Exit outer loop

        if found_valid_record:
            print("  Domain Lockdown TXT record appears to be configured correctly.")
            return True
        else:
            print("  Warning: No valid MailChannels Domain Lockdown TXT record (v=mc1...) found.")
            return False
    except dns.resolver.NXDOMAIN:
        print(f"  Error: The DNS record {record_name} does not exist (NXDOMAIN). Domain Lockdown is likely not configured or misconfigured.")
        return False
    except Exception as e:
        print(f"  An error occurred during DNS lookup for Domain Lockdown record: {e}")
        return False

# --- Send Test Email ---
def send_test_email():
    """Sends a test email using the MailChannels API."""
    print(f"Attempting to send a test email to: {RECIPIENT_EMAIL} from: {SENDER_EMAIL}")
    print(f"Using MailChannels API Key (first 5 chars): {MAILCHANNEL_API_KEY[:5]}...")

    try:
        response = requests.post(MAILCHANNELS_API_URL, headers=headers, data=json.dumps(payload))

        if response.status_code == 202: # MailChannels returns 202 Accepted on success
            print("Successfully sent test email! MailChannels accepted the request.")
            print("Please check the recipient's inbox.")
        else:
            print(f"Error sending email. Status Code: {response.status_code}")
            print("Response Body:")
            try:
                print(json.dumps(response.json(), indent=2))
            except json.JSONDecodeError:
                print(response.text)
            sys.exit(1) # Exit with error code if sending failed

    except requests.exceptions.RequestException as e:
        print(f"An error occurred during the HTTP request: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        sys.exit(1)

# --- Main Execution ---
if __name__ == "__main__":
    lockdown_ok = check_domain_lockdown(DOMAIN_TO_CHECK)
    if not lockdown_ok:
        # Decide if you want to proceed with sending the test email or exit
        proceed = input("Domain Lockdown check failed. Do you want to proceed with sending the test email? (Y/N): ").strip().lower()
        if proceed != 'y':
            print("Aborting test email send.")
            sys.exit(1)
    print("Domain Lockdown check passed or skipped. Proceeding to send test email...")
    send_test_email()
