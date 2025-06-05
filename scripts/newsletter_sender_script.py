#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "markdown", "pyyaml" ]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///

"""
Newsletter Sender Script
Features:
- Rate limited email sending
- Restartable (tracks progress in CSV file)
- Configurable SMTP settings
- Error handling and logging
- Unsubscribe token generation
- Markdown to HTML/Text conversion for newsletter content
"""

import os
import csv
import time
import smtplib
import logging
import hmac
import hashlib
import base64
import sys
import re
import yaml
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
import markdown
from markdown.extensions import codehilite, fenced_code, tables, toc, admonition

# Configuration from environment variables
HMAC_SECRET_KEY = os.getenv('HMAC_SECRET_KEY')
SMTP_SERVER = os.getenv('SMTP_SERVER', 'smtp.fastmailbox.net')
SMTP_PORT = int(os.getenv('SMTP_PORT', '587'))
SMTP_USERNAME = os.getenv('SMTP_USERNAME')
SMTP_PASSWORD = os.getenv('SMTP_PASSWORD')
FROM_EMAIL = os.getenv('FROM_EMAIL')
FROM_NAME = os.getenv('FROM_NAME', 'Rudiger Wolf')
BASE_URL = os.getenv('BASE_URL', 'https://api.rnwolf.net')
BLOG_BASE_URL = os.getenv('BLOG_BASE_URL', 'https://www.rnwolf.net')

# Rate limiting (emails per minute)
EMAILS_PER_MINUTE = int(os.getenv('EMAILS_PER_MINUTE', '10'))
DELAY_BETWEEN_EMAILS = 60 / EMAILS_PER_MINUTE

# File settings
SUBSCRIBERS_FILE = "subscribers.csv"
LOG_FILE = "newsletter.log"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)

def generate_unsubscribe_token(email):
    """Generate HMAC-SHA256 unsubscribe token"""
    if not HMAC_SECRET_KEY:
        raise ValueError("HMAC_SECRET_KEY environment variable is required")

    message = email.encode('utf-8')
    token = hmac.new(
        HMAC_SECRET_KEY.encode('utf-8'),
        message,
        hashlib.sha256
    ).hexdigest()
    return base64.urlsafe_b64encode(token.encode()).decode()

def create_unsubscribe_url(email):
    """Generate complete unsubscribe URL"""
    token = generate_unsubscribe_token(email)
    encoded_email = quote(email)
    return f"{BASE_URL}/v1/newsletter/unsubscribe?token={token}&email={encoded_email}"

def load_subscribers_from_file(filename=SUBSCRIBERS_FILE):
    """Load subscribers from CSV file"""
    if not Path(filename).exists():
        logging.error(f"Subscribers file {filename} not found. Run subscriber_fetcher.py first.")
        return []

    subscribers = []
    with open(filename, 'r', newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            subscribers.append(row)

    return subscribers

def update_subscriber_status(filename, email, status='True', sent_time=None, error_msg=None):
    """Update the email_sent status for a specific subscriber"""
    if sent_time is None:
        #sent_time = datetime.utcnow().isoformat()
        sent_time = datetime.now(timezone.utc).isoformat()


    # Read all subscribers
    subscribers = []
    with open(filename, 'r', newline='', encoding='utf-8') as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            if row['email'] == email:
                row['email_sent'] = status
                row['sent_at'] = sent_time
                if error_msg:
                    row['status'] = f'error: {error_msg[:100]}'  # Truncate long error messages
                else:
                    row['status'] = 'sent' if status == 'True' else 'pending'
            subscribers.append(row)

    # Write back to file
    with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
        fieldnames = ['email', 'subscribed_at', 'ip_address', 'country', 'email_sent', 'sent_at', 'status']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(subscribers)

def parse_markdown_file(file_path):
    """Parse markdown file and extract frontmatter and content"""
    if not Path(file_path).exists():
        raise FileNotFoundError(f"Markdown file not found: {file_path}")

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split frontmatter and content
    if content.startswith('---'):
        try:
            _, frontmatter_raw, markdown_content = content.split('---', 2)
            frontmatter = yaml.safe_load(frontmatter_raw.strip())
        except ValueError:
            raise ValueError("Invalid frontmatter format in markdown file")
    else:
        frontmatter = {}
        markdown_content = content

    # Clean up markdown content
    markdown_content = markdown_content.strip()

    return frontmatter, markdown_content

def generate_blog_url(frontmatter):
    """Generate blog URL from frontmatter slug and created date"""
    slug = frontmatter.get('slug', '')

    # Handle nested date structure in MkDocs frontmatter
    date_info = frontmatter.get('date', {})
    if isinstance(date_info, dict):
        created = date_info.get('created', '')
    else:
        # Fallback to old structure or direct created field
        created = frontmatter.get('created', date_info if date_info else '')

    if not slug:
        logging.warning("No slug found in frontmatter")
        return BLOG_BASE_URL

    # Parse created date to extract year, month, day
    try:
        if isinstance(created, str):
            # Try to parse various date formats
            for fmt in ['%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%SZ']:
                try:
                    created_date = datetime.strptime(created, fmt)
                    break
                except ValueError:
                    continue
            else:
                # If no format matches, try ISO format
                created_date = datetime.fromisoformat(created.replace('Z', '+00:00'))
        else:
            created_date = created

        year = created_date.year
        month = created_date.month
        day = created_date.day

        # Construct URL: https://www.rnwolf.net/blog/YYYY/MM/DD/slug/
        blog_url = f"{BLOG_BASE_URL}/blog/{year:04d}/{month:02d}/{day:02d}/{slug}/"

    except (ValueError, AttributeError) as e:
        logging.warning(f"Could not parse created date '{created}': {e}")
        # Fallback to basic blog URL with slug
        blog_url = f"{BLOG_BASE_URL}/blog/{slug}/"

    return blog_url

def markdown_to_html(markdown_content):
    """Convert markdown to HTML with proper extensions"""
    md = markdown.Markdown(
        extensions=[
            'codehilite',
            'fenced_code',
            'tables',
            'toc',
            'attr_list',
            'def_list',
            'abbr',
            'footnotes',
            'admonition',

        ],
        extension_configs={
            'codehilite': {
                'css_class': 'highlight',
                'use_pygments': False  # Use CSS classes instead
            }
        }
    )

    html_content = md.convert(markdown_content)
    return html_content

def create_intro_text(subscription_date, blog_url, unsubscribe_url):
    """Create the intro text for both HTML and text versions"""
    # Format subscription date
    try:
        if 'T' in subscription_date:
            sub_date = datetime.fromisoformat(subscription_date.replace('Z', '+00:00'))
        else:
            sub_date = datetime.strptime(subscription_date, '%Y-%m-%d %H:%M:%S')
        formatted_date = sub_date.strftime("%B %d, %Y")
    except:
        formatted_date = subscription_date

    # Text version
    text_intro = f"""You signed up for this newsletter ({blog_url}) on {formatted_date}. Just making sure you know this isn't spam. 😊

Don't want to hear from me anymore? No problem — there's a one-click unsubscribe link: {unsubscribe_url}

---

"""

    # HTML version
    html_intro = f"""<div style="background: #f8f9fa; border-left: 4px solid #0066cc; padding: 15px; margin-bottom: 30px; font-size: 14px; color: #666;">
    <p>You signed up for this <a href="{blog_url}">newsletter</a> on <strong>{formatted_date}</strong>. Just making sure you know this isn't spam. 😊</p>
    <p>Don't want to hear from me anymore? No problem — there's a <a href="{unsubscribe_url}">one-click unsubscribe link</a>.</p>
</div>

"""

    return text_intro, html_intro

def create_newsletter_email(email, subscription_date, markdown_file_path):
    """Create newsletter email from markdown file with unsubscribe link"""
    unsubscribe_url = create_unsubscribe_url(email)

    # Parse markdown file
    try:
        frontmatter, markdown_content = parse_markdown_file(markdown_file_path)
    except Exception as e:
        logging.error(f"Error parsing markdown file: {e}")
        raise

    # Extract title for subject line
    title = frontmatter.get('title', 'Newsletter Update')

    # Generate blog URL
    blog_url = generate_blog_url(frontmatter)

    # Create intro text
    text_intro, html_intro = create_intro_text(subscription_date, blog_url, unsubscribe_url)

    # Convert markdown to HTML
    html_content_body = markdown_to_html(markdown_content)

    # Create text version (use original markdown)
    text_content = text_intro + markdown_content + f"\n\n---\n\nUnsubscribe: {unsubscribe_url}\nVisit Website: {BLOG_BASE_URL}"

    # Create HTML version with styling
    html_content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>{title}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }}
        .header {{
            border-bottom: 2px solid #eee;
            margin-bottom: 30px;
            padding-bottom: 20px;
        }}
        .content {{
            margin-bottom: 30px;
        }}
        .footer {{
            border-top: 1px solid #eee;
            margin-top: 30px;
            padding-top: 20px;
            font-size: 14px;
            color: #666;
        }}
        a {{ color: #0066cc; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
        h1, h2, h3, h4, h5, h6 {{ color: #2c5282; }}
        h1 {{ margin: 0; }}
        .subtitle {{ color: #666; margin: 5px 0 0 0; }}
        blockquote {{
            border-left: 4px solid #e2e8f0;
            margin: 1.5em 0;
            padding: 0.5em 1em;
            background: #f7fafc;
        }}
        code {{
            background: #f1f5f9;
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
        }}
        pre {{
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 5px;
            padding: 1em;
            overflow-x: auto;
        }}
        pre code {{
            background: none;
            padding: 0;
        }}
        table {{
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }}
        th, td {{
            border: 1px solid #e2e8f0;
            padding: 8px 12px;
            text-align: left;
        }}
        th {{
            background: #f7fafc;
            font-weight: 600;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>{title}</h1>
        <p class="subtitle">Rudiger's Wolf Newsletter</p>
    </div>

    {html_intro}

    <div class="content">
        {html_content_body}
    </div>

    <div class="footer">
        <p>
            <a href="{unsubscribe_url}">Unsubscribe</a> |
            <a href="{BLOG_BASE_URL}">Visit Website</a>
        </p>
        <p style="font-size: 12px; color: #999;">
            This email was sent to {email}. If you didn't subscribe to this newsletter,
            you can use one-click <a href="{unsubscribe_url}">unsubscribe</a> link.
        </p>
    </div>
</body>
</html>
"""

    # Create email message
    msg = MIMEMultipart('alternative')
    msg['Subject'] = title
    msg['From'] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg['To'] = email
    msg['List-Unsubscribe'] = f"<{unsubscribe_url}>"
    msg['List-Unsubscribe-Post'] = "List-Unsubscribe=One-Click"

    # Add text and HTML parts
    text_part = MIMEText(text_content, 'plain', 'utf-8')
    html_part = MIMEText(html_content, 'html', 'utf-8')

    msg.attach(text_part)
    msg.attach(html_part)

    return msg

def send_email_smtp(msg, recipient_email):
    """Send email via SMTP"""
    try:
        server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)

        text = msg.as_string()
        server.sendmail(FROM_EMAIL, recipient_email, text)
        server.quit()

        return True, "Email sent successfully"

    except Exception as e:
        return False, str(e)

def verify_configuration():
    """Verify all required configuration is present"""
    required_vars = [
        'HMAC_SECRET_KEY', 'SMTP_USERNAME', 'SMTP_PASSWORD', 'FROM_EMAIL'
    ]
    missing_vars = [var for var in required_vars if not globals().get(var)]

    if missing_vars:
        logging.error("Missing required environment variables:")
        for var in missing_vars:
            logging.error(f"  {var}")
        return False

    return True

def get_markdown_file_path():
    """Get markdown file path from command line argument or prompt user"""
    if len(sys.argv) > 1 and sys.argv[1] != 'status':
        markdown_path = sys.argv[1]
    else:
        markdown_path = input("Enter path to newsletter markdown file: ").strip()

    if not markdown_path:
        logging.error("No markdown file path provided")
        return None

    # Expand user path if needed
    markdown_path = os.path.expanduser(markdown_path)

    if not Path(markdown_path).exists():
        logging.error(f"Markdown file not found: {markdown_path}")
        return None

    return markdown_path

def show_status():
    """Show current sending status"""
    subscribers = load_subscribers_from_file()
    if not subscribers:
        print("No subscribers file found")
        return

    total = len(subscribers)
    sent = len([s for s in subscribers if s['email_sent'].lower() == 'true'])
    failed = len([s for s in subscribers if s['status'].startswith('error')])
    pending = total - sent - failed

    print(f"\nNewsletter Status:")
    print(f"  Total subscribers: {total}")
    print(f"  Successfully sent: {sent}")
    print(f"  Failed: {failed}")
    print(f"  Pending: {pending}")

    if failed > 0:
        print(f"\nFailed subscribers:")
        for sub in subscribers:
            if sub['status'].startswith('error'):
                print(f"  {sub['email']}: {sub['status']}")

def send_newsletters():
    """Main function to send newsletters with rate limiting and restart capability"""
    if not verify_configuration():
        logging.error("Configuration verification failed")
        return

    # Get markdown file path
    markdown_file_path = get_markdown_file_path()
    if not markdown_file_path:
        return

    # Parse markdown file to show preview
    try:
        frontmatter, markdown_content = parse_markdown_file(markdown_file_path)
        title = frontmatter.get('title', 'Newsletter Update')
        slug = frontmatter.get('slug', 'unknown')

        # Handle nested date structure
        date_info = frontmatter.get('date', {})
        if isinstance(date_info, dict):
            created = date_info.get('created', 'unknown')
        else:
            created = frontmatter.get('created', date_info if date_info else 'unknown')

        description = frontmatter.get('description', '')
        draft = frontmatter.get('draft', False)

        print(f"\nNewsletter Preview:")
        print(f"  Title: {title}")
        print(f"  Description: {description}")
        print(f"  Slug: {slug}")
        print(f"  Created: {created}")
        print(f"  Draft: {draft}")
        print(f"  Content length: {len(markdown_content)} characters")
        print(f"  Content preview: {markdown_content[:100]}...")

        if draft:
            print(f"\n⚠️  WARNING: This post is marked as DRAFT")
            confirm_draft = input("Continue with draft post? (y/N): ")
            if confirm_draft.lower() != 'y':
                print("Cancelled - not sending draft post")
                return

    except Exception as e:
        logging.error(f"Error parsing markdown file: {e}")
        return

    subscribers = load_subscribers_from_file()
    if not subscribers:
        logging.error("No subscribers found")
        return

    total_subscribers = len(subscribers)
    pending_subscribers = [s for s in subscribers if s['email_sent'].lower() != 'true']
    sent_count = total_subscribers - len(pending_subscribers)

    logging.info(f"Total subscribers: {total_subscribers}")
    logging.info(f"Already sent: {sent_count}")
    logging.info(f"Pending: {len(pending_subscribers)}")

    if not pending_subscribers:
        logging.info("All newsletters have been sent!")
        return

    # Confirm before starting
    response = input(f"\nSend newsletter '{title}' to {len(pending_subscribers)} subscribers? (y/N): ")
    if response.lower() != 'y':
        logging.info("Newsletter sending cancelled")
        return

    success_count = 0
    error_count = 0

    logging.info(f"Starting newsletter send with {DELAY_BETWEEN_EMAILS:.1f}s delay between emails")

    for i, subscriber in enumerate(pending_subscribers, 1):
        email = subscriber['email']
        subscription_date = subscriber['subscribed_at']

        logging.info(f"Sending {i}/{len(pending_subscribers)} to {email}")

        try:
            # Create email from markdown file
            msg = create_newsletter_email(email, subscription_date, markdown_file_path)

            # Send email
            success, message = send_email_smtp(msg, email)

            if success:
                # Update status in CSV
                update_subscriber_status(SUBSCRIBERS_FILE, email, 'True')
                success_count += 1
                logging.info(f"✓ Sent to {email}")
            else:
                error_count += 1
                logging.error(f"✗ Failed to send to {email}: {message}")
                # Mark as failed
                update_subscriber_status(SUBSCRIBERS_FILE, email, 'Failed', error_msg=message)

        except Exception as e:
            error_count += 1
            logging.error(f"✗ Error sending to {email}: {str(e)}")
            update_subscriber_status(SUBSCRIBERS_FILE, email, 'Error', error_msg=str(e))

        # Rate limiting - wait between emails
        if i < len(pending_subscribers):  # Don't wait after the last email
            logging.info(f"Waiting {DELAY_BETWEEN_EMAILS:.1f} seconds...")
            time.sleep(DELAY_BETWEEN_EMAILS)

    logging.info(f"\nNewsletter sending complete!")
    logging.info(f"Successful: {success_count}")
    logging.info(f"Errors: {error_count}")
    logging.info(f"Total processed: {success_count + error_count}")

def main():
    """Main function"""
    if len(sys.argv) > 1 and sys.argv[1] == 'status':
        show_status()
    else:
        print("Newsletter Sender - Markdown to Email")
        print("=" * 40)
        print("Usage:")
        print("  python newsletter_sender.py [markdown_file_path]")
        print("  python newsletter_sender.py status")
        print()
        send_newsletters()

if __name__ == "__main__":
    main()
