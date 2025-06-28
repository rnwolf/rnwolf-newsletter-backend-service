#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///

import requests
import os

# Your Fastmail API token
FASTMAIL_API_TOKEN = os.environ.get("JMAP_API_TOKEN")

# JMAP session endpoint
JMAP_SESSION_URL = 'https://api.fastmail.com/.well-known/jmap'

# Set up the Authorization header
headers = {
    'Authorization': f'Bearer {FASTMAIL_API_TOKEN}'
}

# Make the GET request
response = requests.get(JMAP_SESSION_URL, headers=headers)

# Check the response
if response.status_code == 200:
    session_data = response.json()
    print("JMAP Session Info:")
    print(session_data)
else:
    print(f"Error {response.status_code}: {response.text}")
