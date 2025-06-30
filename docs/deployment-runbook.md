# Newsletter Backend Service - Deployment Runbook

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Deployment Procedures](#deployment-procedures)
5. [Post-Deployment Validation](#post-deployment-validation)
6. [Rollback Procedures](#rollback-procedures)
7. [Database Operations](#database-operations)
8. [Monitoring and Alerts](#monitoring-and-alerts)
9. [Operational Tasks](#operational-tasks)
10. [Emergency Procedures](#emergency-procedures)

## Overview

This runbook provides step-by-step procedures for deploying, operating, and maintaining the Newsletter Backend Service across all environments (local, staging, production).

### Deployment Strategy

- **Blue-Green Deployment**: Zero-downtime deployments using Cloudflare Workers
- **Environment Progression**: Local → Staging → Production
- **Automated Testing**: Post-deployment validation at each stage
- **Rollback Ready**: Quick rollback procedures for issues

## Prerequisites

### Required Tools

```bash
# Install Node.js and npm
node --version  # >= 18.0.0
npm --version   # >= 9.0.0

# Install Cloudflare Wrangler CLI
npm install -g wrangler@latest
wrangler --version

# Install project dependencies
npm install

# Verify Python for operational scripts
python3 --version  # >= 3.12
```

### Required Access

- **Cloudflare Account**: Access to Workers, D1, and Queues
- **Environment Variables**: Access to secrets management
- **Repository Access**: Git repository with appropriate permissions
- **Monitoring Access**: Grafana dashboard access

### Environment Variables

Each environment requires these variables:

```bash
# Core Service
TURNSTILE_SECRET_KEY=<turnstile-secret>
HMAC_SECRET_KEY=<hmac-secret>
CORS_ORIGIN=<allowed-origin>
ENVIRONMENT=<local|staging|production>

# Email Service
MAILCHANNEL_API_KEY=<mailchannels-api-key>
SENDER_EMAIL=<sender-email>
SENDER_NAME=<sender-name>

# Monitoring
GRAFANA_API_KEY=<grafana-api-key>
```

## Environment Setup

### Local Development Environment

**1. Clone Repository**:
```bash
git clone <repository-url>
cd newsletter-backend
```

**2. Install Dependencies**:
```bash
npm install
```

**3. Configure Local Environment**:
```bash
# Copy environment template
cp .env.example .env.local

# Edit with local values
nano .env.local
```

**4. Setup Local Database**:
```bash
# Reset - Optional
npm run db:reset:local
# Apply database migrations first
npm run db:migrate:local
# Load test data into database
npm run db:seed:local
```

**5. Start Development Server**:
```bash
npm run dev
```

**6. Verify Local Setup**:
```bash
# Health check
curl http://localhost:8787/health

# Run tests
npm run test:unit
npm run test:integration
```

### Staging Environment Setup

**1. Configure Staging Secrets**:
```bash
# Set environment variables
wrangler secret put TURNSTILE_SECRET_KEY --env staging
wrangler secret put HMAC_SECRET_KEY --env staging
wrangler secret put MAILCHANNEL_API_KEY --env staging
wrangler secret put GRAFANA_API_KEY --env staging
wrangler secret put CORS_ORIGIN --env staging
wrangler secret put SENDER_EMAIL --env staging
wrangler secret put SENDER_NAME --env staging
```

**2. Setup Staging Database**:
```bash
# Reset - Optional
npm run db:reset:staging

# Apply migrations
npm run db:migrate:staging

# Verify schema
npm run db:schema:staging
```

**3. Deploy to Staging**:
```bash
npm run deploy:staging
```

### Production Environment Setup

**1. Configure Production Secrets**:
```bash
# Set production environment variables
wrangler secret put TURNSTILE_SECRET_KEY --env production
wrangler secret put HMAC_SECRET_KEY --env production
wrangler secret put MAILCHANNEL_API_KEY --env production
wrangler secret put GRAFANA_API_KEY --env production
wrangler secret put CORS_ORIGIN --env production
wrangler secret put SENDER_EMAIL --env production
wrangler secret put SENDER_NAME --env production
```

**2. Setup Production Database**:
```bash
# Apply migrations
npm run db:migrate:production

# Verify schema
npm run db:schema:production
```

## Deployment Procedures

### Standard Deployment Flow

**1. Pre-Deployment Checklist**:
- [ ] All tests passing locally
- [ ] Code reviewed and approved
- [ ] Database migrations prepared (if needed)
- [ ] Environment variables updated (if needed)
- [ ] Monitoring alerts configured

**2. Deploy to Staging**:
```bash
# Deploy application
npm run deploy:staging

# Verify deployment
npm run test:staging:workers

# Check health
curl https://api-staging.rnwolf.net/health
```

**3. Staging Validation**:
```bash
# Run comprehensive tests
npm run test:staging:full

# Manual verification
./scripts/manual-verification-test.sh staging

# Performance check
npm run test:performance:staging
```

**4. Deploy to Production**:
```bash
# Deploy application
npm run deploy:production

# Immediate health check
curl https://api.rnwolf.net/health

# Run smoke tests
npm run test:smoke:production
```

**5. Post-Production Validation**:
```bash
# Verify all endpoints
npm run test:production:smoke

# Check metrics
npm run metrics:production

# Monitor for 15 minutes
watch -n 30 'curl -s https://api.rnwolf.net/health | jq'
```

### Database Migration Deployment

**1. Prepare Migration**:
```bash
# Create migration file
cat > migrations/00X_migration_name.sql << EOF
-- Migration SQL here
ALTER TABLE subscribers ADD COLUMN new_field TEXT;
EOF
```

**2. Test Migration Locally**:
```bash
# Apply to local
npm run db:migrate:local

# Test with new schema
npm run test:unit
npm run test:integration
```

**3. Deploy Migration to Staging**:
```bash
# Apply migration
npm run db:migrate:staging

# Deploy application
npm run deploy:staging

# Validate
npm run test:staging:workers
```

**4. Deploy Migration to Production**:
```bash
# Apply migration
npm run db:migrate:production

# Deploy application
npm run deploy:production

# Validate
npm run test:smoke:production
```

### Emergency Deployment

**For Critical Fixes**:
```bash
# Skip staging for critical production issues
git checkout main
git pull origin main

# Quick local test
npm run test:unit

# Direct production deployment
npm run deploy:production

# Immediate validation
npm run test:smoke:production

# Monitor closely
npm run metrics:production
```

## Post-Deployment Validation

### Automated Validation

**Health Checks**:
```bash
# Basic health
curl https://api.rnwolf.net/health

# Detailed health with metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/health
```

**Functional Tests**:
```bash
# Subscription flow
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "test+deployment@example.com"}'

# Database connectivity
npm run db:test:production
```

### Manual Validation

**1. Subscription Test**:
- Submit test subscription via website form
- Verify email received
- Click verification link
- Confirm subscription in database

**2. Unsubscribe Test**:
- Use test unsubscribe link
- Verify unsubscribe confirmation
- Confirm status in database

**3. Monitoring Test**:
- Check Grafana dashboards
- Verify metrics collection
- Test alert notifications

## Rollback Procedures

### Application Rollback

**1. Identify Previous Version**:
```bash
# List recent deployments
wrangler deployments list --env production

# Get previous deployment ID
PREVIOUS_DEPLOYMENT_ID="<deployment-id>"
```

**2. Rollback Application**:
```bash
# Rollback to previous version
wrangler rollback $PREVIOUS_DEPLOYMENT_ID --env production

# Verify rollback
curl https://api.rnwolf.net/health
npm run test:smoke:production
```

### Database Rollback

**1. Prepare Rollback Migration**:
```bash
# Create rollback migration
cat > migrations/00X_rollback_migration.sql << EOF
-- Rollback SQL here
ALTER TABLE subscribers DROP COLUMN new_field;
EOF
```

**2. Apply Rollback**:
```bash
# Apply rollback migration
npm run db:migrate:production

# Verify schema
npm run db:schema:production
```

### Emergency Rollback

**For Critical Issues**:
```bash
# Immediate rollback
wrangler rollback --env production

# Check status
curl https://api.rnwolf.net/health

# Alert team
echo "Production rollback completed at $(date)" | \
  mail -s "Newsletter Service Rollback" ops-team@company.com
```

## Database Operations

### Backup Procedures

**Manual Backup**:
```bash
# Export production data
python scripts/db-backup-restore.py backup production

# Verify backup
ls -la backups/production-$(date +%Y%m%d).sql
```

**Automated Backup** (recommended to set up):
```bash
# Daily backup cron job
0 2 * * * /path/to/scripts/daily-backup.sh production
```

### Data Management

**Subscriber Export**:
```bash
# Export active subscribers
ENVIRONMENT=production python scripts/subscriber_fetcher_script.py

# Verify export
head -5 subscribers-production.csv
wc -l subscribers-production.csv
```

**Database Cleanup**:
```bash
# Clean up old unverified subscribers (>30 days)
cat > cleanup.sql << EOF
DELETE FROM subscribers
WHERE email_verified = FALSE
  AND verification_sent_at < datetime('now', '-30 days');
EOF

# Apply cleanup
wrangler d1 execute DB --env production --file=cleanup.sql
```

### Schema Management

**View Current Schema**:
```bash
# Inspect current schema
npm run db:schema:production

# Check table structure
wrangler d1 execute DB --env production --command="PRAGMA table_info(subscribers);"
```

**Migration Status**:
```bash
# Check applied migrations
wrangler d1 execute DB --env production --command="SELECT * FROM _cf_KV WHERE key = 'migrations';"
```

## Monitoring and Alerts

### Health Monitoring

**Continuous Health Check**:
```bash
# Monitor health every 30 seconds
watch -n 30 'curl -s https://api.rnwolf.net/health | jq .success'

# Monitor with timestamp
while true; do
  echo "$(date): $(curl -s https://api.rnwolf.net/health | jq -r .message)"
  sleep 60
done
```

**Metrics Collection**:
```bash
# Check key metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep newsletter_subscribers

# Database status
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep database_status
```

### Alert Configuration

**Grafana Alerts** (configure in dashboard):
- Service down (health check fails)
- High error rate (>5% in 5 minutes)
- Database connectivity issues
- High response times (>1000ms average)

**Manual Alert Test**:
```bash
# Test alert endpoints
curl -f https://api.rnwolf.net/health || echo "ALERT: Service down"

# Test metrics endpoint
curl -f -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics || echo "ALERT: Metrics unavailable"
```

## Operational Tasks

### Daily Operations

**Morning Health Check**:
```bash
#!/bin/bash
# daily-health-check.sh

echo "=== Newsletter Service Daily Health Check ==="
echo "Date: $(date)"

# Health check
echo "Health Status:"
curl -s https://api.rnwolf.net/health | jq

# Subscriber count
echo "Subscriber Metrics:"
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/json | jq '.database'

# Recent activity
echo "24h Activity:"
curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep "_24h"

echo "=== Health Check Complete ==="
```

### Weekly Operations

**Weekly Maintenance**:
```bash
#!/bin/bash
# weekly-maintenance.sh

# Export subscriber list
ENVIRONMENT=production python scripts/subscriber_fetcher_script.py

# Database cleanup
echo "Cleaning up old unverified subscribers..."
# Add cleanup SQL here

# Performance review
echo "Performance metrics for the week:"
# Add performance analysis here

# Backup verification
echo "Verifying recent backups..."
ls -la backups/ | tail -7
```

### Monthly Operations

**Monthly Newsletter Preparation**:
```bash
#!/bin/bash
# monthly-newsletter-prep.sh

# Export current subscriber list
ENVIRONMENT=production python scripts/subscriber_fetcher_script.py

# Generate subscriber report
echo "=== Monthly Subscriber Report ==="
echo "Total subscribers: $(tail -n +2 subscribers-production.csv | wc -l)"
echo "By country:"
tail -n +2 subscribers-production.csv | cut -d',' -f4 | sort | uniq -c | sort -nr

# Prepare for newsletter sending
echo "Subscriber list ready: subscribers-production.csv"
echo "Use this file with your newsletter distribution tool"
```

## Emergency Procedures

### Service Down

**1. Immediate Response**:
```bash
# Check service status
curl -I https://api.rnwolf.net/health

# Check Cloudflare status
curl -I https://api.rnwolf.net/

# Check recent deployments
wrangler deployments list --env production
```

**2. Quick Diagnostics**:
```bash
# Check logs
wrangler tail --env production

# Check metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/health
```

**3. Recovery Actions**:
```bash
# If recent deployment issue - rollback
wrangler rollback --env production

# If database issue - check D1 status
wrangler d1 info DB --env production

# If queue issue - check queue status
wrangler queues list --env production
```

### Database Issues

**1. Database Connectivity**:
```bash
# Test database connection
wrangler d1 execute DB --env production --command="SELECT 1;"

# Check database size
wrangler d1 info DB --env production
```

**2. Database Recovery**:
```bash
# If corruption suspected - restore from backup
python scripts/db-backup-restore.py restore production latest

# Verify restoration
npm run test:smoke:production
```

### High Error Rate

**1. Identify Error Source**:
```bash
# Check error logs
wrangler tail --env production | grep ERROR

# Check error metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep error
```

**2. Mitigation**:
```bash
# If specific endpoint issue - check recent changes
git log --oneline -10

# If widespread issue - consider rollback
wrangler rollback --env production
```

### Contact Information

**Escalation Path**:
1. **Primary**: On-call engineer
2. **Secondary**: Development team lead
3. **Tertiary**: Infrastructure team

**External Dependencies**:
- **Cloudflare Support**: For platform issues
- **MailChannels Support**: For email delivery issues

## Maintenance Windows

### Scheduled Maintenance

**Monthly Maintenance Window**:
- **Time**: First Sunday of month, 02:00-04:00 UTC
- **Duration**: 2 hours maximum
- **Activities**: Database maintenance, performance optimization

**Maintenance Procedure**:
```bash
# 1. Announce maintenance
echo "Maintenance starting" | mail -s "Newsletter Service Maintenance" users@company.com

# 2. Backup before maintenance
python scripts/db-backup-restore.py backup production

# 3. Perform maintenance tasks
# (Database cleanup, optimization, etc.)

# 4. Validate after maintenance
npm run test:smoke:production

# 5. Announce completion
echo "Maintenance completed" | mail -s "Newsletter Service Restored" users@company.com
```

## Related Documentation

- **[Architecture Overview](architecture-overview.md)**: System design and components
- **[API Reference](api-reference.md)**: Detailed API documentation
- **[Testing Guide](testing-guide.md)**: Testing procedures and validation
- **[Troubleshooting Guide](troubleshooting-guide.md)**: Common issues and solutions
- **[Deployment Guide](newsletter_backend_deployment.md)**: Environment setup details