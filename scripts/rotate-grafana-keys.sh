# Create rotation script
#!/bin/bash
# rotate-grafana-keys.sh

NEW_STAGING_KEY="glsa_new_staging_token"
NEW_PRODUCTION_KEY="glsa_new_production_token"

# Update Cloudflare secrets
echo "$NEW_STAGING_KEY" | npx wrangler secret put GRAFANA_API_KEY --env staging
echo "$NEW_PRODUCTION_KEY" | npx wrangler secret put GRAFANA_API_KEY --env production

echo "API keys rotated successfully"