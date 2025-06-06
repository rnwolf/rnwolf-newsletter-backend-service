# Newsletter Backend Deployment Configuration
# Source this file or set these environment variables before running deploy.sh

# Notification settings (optional)
export SLACK_WEBHOOK_URL=""  # Slack webhook for deployment notifications
export DISCORD_WEBHOOK_URL=""  # Discord webhook for deployment notifications
export NOTIFICATION_EMAIL=""  # Email for deployment notifications

# Deployment settings
export DEPLOYMENT_TIMEOUT=300  # Maximum time to wait for deployment (seconds)
export HEALTH_CHECK_RETRIES=5  # Number of health check retries
export HEALTH_CHECK_DELAY=10   # Delay between health check retries (seconds)

# Backup settings
export BACKUP_RETENTION_DAYS=30  # How long to keep deployment backups
export MAX_BACKUPS=10           # Maximum number of backups to keep

# Test settings
export SMOKE_TEST_TIMEOUT=60    # Timeout for smoke tests (seconds)
export INTEGRATION_TEST_TIMEOUT=120  # Timeout for integration tests (seconds)

# Environment URLs
export STAGING_API_URL="https://api-staging.rnwolf.net"
export PRODUCTION_API_URL="https://api.rnwolf.net"

# Cloudflare settings
export CLOUDFLARE_ZONE_NAME="rnwolf.net"
export STAGING_SUBDOMAIN="api-staging"
export PRODUCTION_SUBDOMAIN="api"

# Required secrets (will be checked during deployment)
export REQUIRED_SECRETS=("TURNSTILE_SECRET_KEY" "HMAC_SECRET_KEY")

# Git settings
export REQUIRED_BRANCH_STAGING="main"     # Required branch for staging deployment
export REQUIRED_BRANCH_PRODUCTION="main"  # Required branch for production deployment
export ENFORCE_CLEAN_WORKING_DIR=true     # Require clean working directory

# Load environment-specific overrides if they exist
if [[ -f "$(dirname "${BASH_SOURCE[0]}")/.env.deploy" ]]; then
    source "$(dirname "${BASH_SOURCE[0]}")/.env.deploy"
fi

# Load user-specific overrides if they exist
if [[ -f "$HOME/.newsletter-deploy-config" ]]; then
    source "$HOME/.newsletter-deploy-config"
fi