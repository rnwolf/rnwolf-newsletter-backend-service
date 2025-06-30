#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///
"""
Newsletter Subscriber Fetcher Script
Fetches active subscribers from Cloudflare D1 database and saves to CSV for newsletter sending.
"""

import os
import requests
import csv
import json
from datetime import datetime
from pathlib import Path
import sys

# Cloudflare API Configuration
CLOUDFLARE_ACCOUNT_ID = os.getenv('CLOUDFLARE_ACCOUNT_ID')
CLOUDFLARE_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN')  # With D1:read permissions
D1_DATABASE_ID = os.getenv('D1_DATABASE_ID')
ENVIRONMENT = os.getenv('ENVIRONMENT')

# Valid environments
VALID_ENVIRONMENTS = ['local', 'staging', 'production']

def query_d1_database(sql_query):
    """Execute SQL query against Cloudflare D1 database"""
    if not all([CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID]):
        raise ValueError("Missing required environment variables: CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, D1_DATABASE_ID")

    url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query"

    headers = {
        "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
        "Content-Type": "application/json"
    }

    payload = {
        "sql": sql_query
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error querying D1 database: {e}")
        raise

def get_active_subscribers():
    """Retrieve all active verified subscribers (those with subscribed_at, no unsubscribed_at, and email_verified = TRUE)"""
    query = """
    SELECT email, subscribed_at, ip_address, country, email_verified, verified_at
    FROM subscribers
    WHERE subscribed_at IS NOT NULL
      AND unsubscribed_at IS NULL
      AND email_verified = TRUE
    ORDER BY subscribed_at DESC
    """
    return query_d1_database(query)

def save_subscribers_to_file(filename="subscribers.csv"):
    """Fetch subscribers from D1 and save to local CSV file"""
    print("Fetching subscribers from D1 database...")

    try:
        subscribers_data = get_active_subscribers()

        if not subscribers_data.get('success'):
            print("Error retrieving subscribers:", subscribers_data)
            return False

        # Extract results from D1 response structure
        results = subscribers_data.get('result', [])
        if not results:
            print("No data returned from database")
            return False

        subscribers = results[0].get('results', [])
        print(f"Found {len(subscribers)} active subscribers")

        if not subscribers:
            print("No active subscribers found")
            return True

        # Save to CSV file
        with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['email', 'subscribed_at', 'ip_address', 'country', 'email_sent', 'sent_at', 'status']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

            writer.writeheader()
            for subscriber in subscribers:
                writer.writerow({
                    'email': subscriber['email'],
                    'subscribed_at': subscriber['subscribed_at'],
                    'ip_address': subscriber.get('ip_address', ''),
                    'country': subscriber.get('country', ''),
                    'email_sent': 'False',
                    'sent_at': '',
                    'status': 'pending'
                })

        print(f"Subscribers saved to {filename}")

        # Show summary statistics
        countries = {}
        for sub in subscribers:
            country = sub.get('country') or 'Unknown'
            countries[country] = countries.get(country, 0) + 1

        print("\nSubscriber Summary:")
        print(f"Total active subscribers: {len(subscribers)}")
        print("\nBy country:")
        for country, count in sorted(countries.items(), key=lambda x: x[1], reverse=True):
            print(f"  {country}: {count}")

        return True

    except Exception as e:
        print(f"Error processing subscribers: {e}")
        return False

def verify_environment():
    """Verify all required environment variables are set and ENVIRONMENT is valid"""
    required_vars = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'D1_DATABASE_ID', 'ENVIRONMENT']
    missing_vars = [var for var in required_vars if not os.getenv(var)]

    if missing_vars:
        print("Missing required environment variables:")
        for var in missing_vars:
            print(f"  {var}")
        print("\nPlease set these variables in your .env file or environment")
        return False

    # Validate ENVIRONMENT value
    if ENVIRONMENT not in VALID_ENVIRONMENTS:
        print(f"Invalid ENVIRONMENT value: '{ENVIRONMENT}'")
        print(f"ENVIRONMENT must be one of: {', '.join(VALID_ENVIRONMENTS)}")
        return False

    return True

def test_connection():
    """Test connection to D1 database"""
    print("Testing D1 database connection...")

    try:
        result = query_d1_database("SELECT COUNT(*) as total FROM subscribers")
        if result.get('success'):
            total = result['result'][0]['results'][0]['total']
            print(f"✓ Database connection successful. Total subscribers: {total}")
            return True
        else:
            print("✗ Database connection failed:", result)
            return False
    except Exception as e:
        print(f"✗ Database connection error: {e}")
        return False

def main():
    """Main function"""
    print("Newsletter Subscriber Fetcher")
    print("=" * 40)

    # Check if we have required environment variables
    if not verify_environment():
        sys.exit(1)

    # Display environment information
    print(f"\n📍 Environment: {ENVIRONMENT}")
    print(f"Subscriber data will be retrieved from the {ENVIRONMENT} environment")

    # Test database connection first
    if not test_connection():
        sys.exit(1)

    # Generate environment-specific filename
    default_filename = f"subscribers-{ENVIRONMENT}.csv"
    output_file = sys.argv[1] if len(sys.argv) > 1 else default_filename

    print(f"\n📁 Output file: {output_file}")

    # Fetch and save subscribers
    if save_subscribers_to_file(output_file):
        print(f"\n✓ Successfully exported subscribers to {output_file}")
        print("You can now run the newsletter sender script.")
    else:
        print("\n✗ Failed to export subscribers")
        sys.exit(1)

if __name__ == "__main__":
    main()
