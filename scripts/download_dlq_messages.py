#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///
# download_dlq_messages.py

import os
import requests
import json
import sys

# --- Configuration ---
# Get these from your Cloudflare dashboard
# ACCOUNT_ID: Your Cloudflare Account ID
# CLOUDFLARE_API_TOKEN: An API Token with Cloudflare Workers:Queue:Read permissions
# QUEUE_NAME: The name of your Dead-Letter Queue (e.g., email-verification-dlq-production)

ACCOUNT_ID = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
CLOUDFLARE_API_TOKEN = os.environ.get("CLOUDFLARE_API_TOKEN")
# Use the DLQ name directly
QUEUE_NAME = os.environ.get("CLOUDFLARE_DLQ_NAME","email-verification-dlq-production")

# --- Validation ---
if not ACCOUNT_ID:
    print("Error: CLOUDFLARE_ACCOUNT_ID environment variable not set.")
    sys.exit(1)
if not CLOUDFLARE_API_TOKEN:
    print("Error: CLOUDFLARE_API_TOKEN environment variable not set.")
    sys.exit(1)
if not QUEUE_NAME:
    print("Error: CLOUDFLARE_DLQ_NAME environment variable not set.")
    sys.exit(1)

# --- API Details ---
API_BASE_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
QUEUE_API_URL = f"{API_BASE_URL}/workers/queues/{QUEUE_NAME}/messages"

headers = {
    "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
    "Content-Type": "application/json"
}

# --- Fetching Messages ---
def fetch_dlq_messages():
    """Fetches messages from the specified Dead-Letter Queue."""
    messages = []
    params = {
        "limit": 1000 # Fetch up to 1000 messages per request (max allowed)
        # Cloudflare Queue API for fetching messages from DLQ doesn't typically use pagination like 'cursor'
        # It usually fetches all available up to the limit. If you have more than 1000, you might need
        # to contact Cloudflare support or use a different API method if available.
        # For a DLQ, fetching all is often the goal.
    }

    print(f"Attempting to fetch messages from DLQ: {QUEUE_NAME}...")

    try:
        response = requests.get(QUEUE_API_URL, headers=headers, params=params)
        response.raise_for_status() # Raise an exception for bad status codes (4xx or 5xx)

        data = response.json()

        if data.get("success"):
            messages = data.get("result", [])
            print(f"Successfully fetched {len(messages)} messages.")
            return messages
        else:
            print(f"API returned success: false. Errors: {data.get('errors')}")
            return []

    except requests.exceptions.RequestException as e:
        print(f"Error fetching messages from Cloudflare API: {e}")
        return []
    except json.JSONDecodeError:
        print(f"Error decoding JSON response from API: {response.text}")
        return []

# --- Main Execution ---
if __name__ == "__main__":
    dlq_messages = fetch_dlq_messages()

    if dlq_messages:
        # You can process or save the messages here
        # For now, let's print them in a readable format
        print("\n--- DLQ Messages ---")
        for i, message in enumerate(dlq_messages):
            # Based on debug output, 'message' is a string (likely an ID)
            print(f"Message {i + 1}: {message}")
            # Remove the debugging line now that we know the type
            # print(f"  Raw message object type: {type(message)}, content: {message}")

        # Optional: Save to a file
        # with open("dlq_messages.json", "w") as f:
        #     json.dump(dlq_messages, f, indent=2)
        # print("\nMessages saved to dlq_messages.json")

    elif dlq_messages is not None: # Check if fetch was attempted but returned empty
         print("No messages found in the Dead-Letter Queue.")
