# Newsletter Backend Service - Troubleshooting Guide

## Table of Contents

1. [Overview](#overview)
2. [Quick Diagnostics](#quick-diagnostics)
3. [Common Issues](#common-issues)
4. [Error Categories](#error-categories)
5. [Debugging Tools](#debugging-tools)
6. [Performance Issues](#performance-issues)
7. [Environment-Specific Issues](#environment-specific-issues)
8. [External Service Issues](#external-service-issues)
9. [Database Issues](#database-issues)
10. [Monitoring and Alerts](#monitoring-and-alerts)

## Overview

This guide provides systematic troubleshooting procedures for the Newsletter Backend Service. Issues are categorized by symptoms, root causes, and resolution steps.

### Troubleshooting Philosophy

1. **Start with symptoms** - What is the user experiencing?
2. **Check recent changes** - What was deployed recently?
3. **Verify external dependencies** - Are third-party services working?
4. **Use systematic approach** - Follow the decision tree
5. **Document findings** - Update this guide with new issues

## Quick Diagnostics

### Health Check Commands

```bash
# Basic health check
curl https://api.rnwolf.net/health

# Detailed health with metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/health

# Database connectivity
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep database_status

# Recent logs
wrangler tail --env production --format pretty
```

### Quick Status Dashboard

```bash
#!/bin/bash
# quick-status.sh - Run this for immediate system overview

echo "=== Newsletter Service Status ==="
echo "Timestamp: $(date)"
echo

# Health check
echo "🏥 Health Status:"
health=$(curl -s https://api.rnwolf.net/health)
echo "$health" | jq -r '.message // "Health check failed"'
echo

# Database status
echo "🗄️  Database Status:"
db_status=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  "https://api.rnwolf.net/metrics" | grep "database_status" | tail -1)
echo "${db_status:-"Database status unknown"}"
echo

# Subscriber count
echo "👥 Subscriber Metrics:"
metrics=$(curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/json)
echo "$metrics" | jq -r '.database | "Total: \(.newsletter_subscribers_total), Active: \(.newsletter_subscribers_active)"'
echo

# Recent activity
echo "📊 24h Activity:"
echo "$metrics" | jq -r '.database | "Subscriptions: \(.newsletter_subscriptions_24h), Unsubscribes: \(.newsletter_unsubscribes_24h)"'
```

## Common Issues

### 1. Service Unavailable (503/500 Errors)

**Symptoms**:
- Health check returns 500/503
- All endpoints returning errors
- "Service temporarily unavailable" messages

**Diagnosis**:
```bash
# Check service status
curl -I https://api.rnwolf.net/health

# Check recent deployments
wrangler deployments list --env production

# Check logs for errors
wrangler tail --env production | grep -E "(ERROR|FATAL|500|503)"
```

**Common Causes & Solutions**:

**Database Connection Issues**:
```bash
# Test database connectivity
wrangler d1 execute DB --env production --command="SELECT 1 as test;"

# Check D1 service status
curl -s https://www.cloudflarestatus.com/api/v2/status.json | jq '.status.description'

# Solution: Wait for D1 recovery or restore from backup
```

**Recent Deployment Issues**:
```bash
# Rollback to previous version
wrangler rollback --env production

# Verify rollback success
curl https://api.rnwolf.net/health
```

**Environment Variable Issues**:
```bash
# Check if secrets are set
wrangler secret list --env production

# Re-deploy if secrets are missing
npm run deploy:production
```

### 2. CORS Errors

**Symptoms**:
- "Access to fetch blocked by CORS policy"
- Subscription form not working from website
- Preflight OPTIONS requests failing

**Diagnosis**:
```bash
# Test CORS headers
curl -H "Origin: https://www.rnwolf.net" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS https://api.rnwolf.net/v1/newsletter/subscribe

# Check current CORS_ORIGIN setting
wrangler secret list --env production | grep CORS
```

**Solutions**:

**Wrong CORS Origin**:
```bash
# Update CORS origin
wrangler secret put CORS_ORIGIN --env production
# Enter: https://www.rnwolf.net

# Redeploy
npm run deploy:production
```

**Missing CORS Headers**:
```bash
# Check if OPTIONS method is handled
curl -X OPTIONS https://api.rnwolf.net/v1/newsletter/subscribe -v
```

### 3. Email Verification Not Working

**Symptoms**:
- Users not receiving verification emails
- Verification links not working
- "Invalid or expired link" errors

**Diagnosis**:
```bash
# Check email queue status
wrangler queues list --env production

# Check recent email processing
wrangler tail --env production | grep -E "(email|verification|queue)"

# Test email endpoint
curl "https://api.rnwolf.net/v1/newsletter/verify?token=test&email=test@example.com"
```

**Common Causes & Solutions**:

**MailChannels API Issues**:
```bash
# Check MailChannels API key
wrangler secret list --env production | grep MAILCHANNEL

# Test MailChannels connectivity
python scripts/test_mailchannels_send.py
```

**Queue Processing Issues**:
```bash
# Check queue consumer status
wrangler queues consumer list EMAIL_VERIFICATION_QUEUE --env production

# Check for stuck messages
wrangler queues consumer get EMAIL_VERIFICATION_QUEUE --env production
```

**Token Generation/Validation Issues**:
```bash
# Check HMAC secret consistency
wrangler secret list --env production | grep HMAC

# Test token generation locally
node -e "
const crypto = require('crypto');
const email = 'test@example.com';
const secret = 'your-secret';
const timestamp = Date.now().toString();
const message = \`\${email}:\${timestamp}\`;
const token = crypto.createHmac('sha256', secret).update(message).digest('hex');
console.log(Buffer.from(\`\${token}:\${timestamp}\`).toString('base64url'));
"
```

### 4. Bot Protection Issues

**Symptoms**:
- Legitimate users blocked by Turnstile
- "Please complete security verification" errors
- High rejection rate

**Diagnosis**:
```bash
# Check Turnstile secret key
wrangler secret list --env production | grep TURNSTILE

# Test subscription without Turnstile
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# Check Turnstile logs in Cloudflare dashboard
```

**Solutions**:

**Wrong Turnstile Configuration**:
```bash
# Verify Turnstile secret key matches site key
wrangler secret put TURNSTILE_SECRET_KEY --env production

# Check Turnstile site configuration in Cloudflare dashboard
```

**Turnstile Service Issues**:
```bash
# Check Cloudflare Turnstile status
curl -s https://www.cloudflarestatus.com/api/v2/status.json | \
  jq '.components[] | select(.name | contains("Turnstile"))'
```

### 5. Database Issues

**Symptoms**:
- "Database connection failed" errors
- Slow response times
- Data inconsistencies

**Diagnosis**:
```bash
# Test database connection
wrangler d1 execute DB --env production --command="SELECT COUNT(*) FROM subscribers;"

# Check database size and limits
wrangler d1 info DB --env production

# Check for schema issues
wrangler d1 execute DB --env production --command="PRAGMA integrity_check;"
```

**Solutions**:

**Connection Issues**:
```bash
# Check D1 service status
curl -s https://www.cloudflarestatus.com/api/v2/status.json | \
  jq '.components[] | select(.name | contains("D1"))'

# Restart worker (redeploy)
npm run deploy:production
```

**Schema Issues**:
```bash
# Check current schema
npm run db:schema:production

# Apply missing migrations
npm run db:migrate:production
```

**Data Corruption**:
```bash
# Restore from backup
python scripts/db-backup-restore.py restore production latest

# Verify restoration
npm run test:smoke:production
```

## Error Categories

### HTTP Status Code Guide

| Status | Meaning | Common Causes | Investigation Steps |
|--------|---------|---------------|-------------------|
| 400 | Bad Request | Invalid email, missing parameters | Check request format and validation |
| 401 | Unauthorized | Invalid API key for metrics | Verify GRAFANA_API_KEY |
| 404 | Not Found | Invalid endpoint, subscriber not found | Check URL and database |
| 405 | Method Not Allowed | Wrong HTTP method | Check endpoint documentation |
| 500 | Internal Server Error | Database issues, code errors | Check logs and database |
| 503 | Service Unavailable | External service down | Check dependencies |

### Error Message Patterns

**Database Errors**:
```
"Database connection failed"
"Our subscription service is temporarily unavailable"
"Database unavailable"
```
→ Check D1 connectivity and service status

**Validation Errors**:
```
"Invalid email address"
"Email address is required"
"Invalid request format"
```
→ Check input validation and request format

**Authentication Errors**:
```
"Missing Authorization header"
"Invalid API key"
"Authentication failed"
```
→ Check API keys and authentication headers

**External Service Errors**:
```
"Please complete the security verification"
"Failed to send email"
"External service unavailable"
```
→ Check Turnstile and MailChannels status

## Debugging Tools

### Log Analysis

**Real-time Logs**:
```bash
# Follow logs in real-time
wrangler tail --env production --format pretty

# Filter for errors
wrangler tail --env production | grep -E "(ERROR|FATAL|500)"

# Filter for specific functionality
wrangler tail --env production | grep -E "(subscribe|verify|unsubscribe)"
```

**Log Analysis Scripts**:
```bash
#!/bin/bash
# analyze-logs.sh - Analyze recent logs for patterns

echo "=== Log Analysis for Last Hour ==="

# Get recent logs (note: wrangler tail shows real-time, use for monitoring)
echo "Common error patterns:"
wrangler tail --env production --format json | \
  jq -r 'select(.level == "error") | .message' | \
  sort | uniq -c | sort -nr | head -10

echo "Request volume by endpoint:"
wrangler tail --env production --format json | \
  jq -r 'select(.message | contains("Request received")) | .message' | \
  grep -o '/[^"]*' | sort | uniq -c | sort -nr
```

### Database Debugging

**Schema Inspection**:
```bash
# Check table structure
wrangler d1 execute DB --env production --command="
  SELECT sql FROM sqlite_master WHERE type='table' AND name='subscribers';
"

# Check indexes
wrangler d1 execute DB --env production --command="
  SELECT name, sql FROM sqlite_master WHERE type='index';
"

# Check data samples
wrangler d1 execute DB --env production --command="
  SELECT email, subscribed_at, email_verified, unsubscribed_at 
  FROM subscribers 
  ORDER BY created_at DESC 
  LIMIT 5;
"
```

**Data Validation**:
```bash
# Check for data inconsistencies
wrangler d1 execute DB --env production --command="
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN email_verified = 1 THEN 1 END) as verified,
    COUNT(CASE WHEN unsubscribed_at IS NOT NULL THEN 1 END) as unsubscribed
  FROM subscribers;
"

# Check for orphaned records
wrangler d1 execute DB --env production --command="
  SELECT COUNT(*) as orphaned_tokens
  FROM subscribers 
  WHERE verification_token IS NOT NULL 
    AND email_verified = 1;
"
```

### Performance Debugging

**Response Time Analysis**:
```bash
# Test endpoint response times
time curl -s https://api.rnwolf.net/health > /dev/null

# Detailed timing
curl -w "@curl-format.txt" -s -o /dev/null https://api.rnwolf.net/health

# Create curl-format.txt:
cat > curl-format.txt << EOF
     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n
EOF
```

**Database Performance**:
```bash
# Check query performance
wrangler d1 execute DB --env production --command="
  EXPLAIN QUERY PLAN 
  SELECT * FROM subscribers WHERE email = 'test@example.com';
"

# Check database statistics
wrangler d1 execute DB --env production --command="
  SELECT 
    COUNT(*) as total_rows,
    AVG(LENGTH(email)) as avg_email_length,
    COUNT(DISTINCT country) as unique_countries
  FROM subscribers;
"
```

## Performance Issues

### Slow Response Times

**Symptoms**:
- Response times > 1000ms
- Timeouts on requests
- Users reporting slow loading

**Investigation**:
```bash
# Check current performance
curl -w "%{time_total}\n" -s -o /dev/null https://api.rnwolf.net/health

# Check database response time
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/health | jq '.database.response_time'

# Monitor over time
for i in {1..10}; do
  echo "Test $i: $(curl -w "%{time_total}" -s -o /dev/null https://api.rnwolf.net/health)s"
  sleep 2
done
```

**Solutions**:

**Database Optimization**:
```bash
# Check if indexes are being used
wrangler d1 execute DB --env production --command="
  EXPLAIN QUERY PLAN SELECT * FROM subscribers WHERE email = 'test@example.com';
"

# Rebuild indexes if needed
wrangler d1 execute DB --env production --command="REINDEX;"
```

**Worker Optimization**:
```bash
# Check worker memory usage
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/json | jq '.system'

# Redeploy to clear any memory issues
npm run deploy:production
```

### High Memory Usage

**Investigation**:
```bash
# Check memory metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/json | \
  jq '.system | {used: .worker_memory_used, total: .worker_memory_total, percentage: (.worker_memory_used / .worker_memory_total * 100)}'
```

**Solutions**:
- Redeploy worker to reset memory
- Check for memory leaks in recent code changes
- Monitor memory usage patterns

## Environment-Specific Issues

### Local Development Issues

**Common Problems**:
- Database not initialized
- Environment variables not set
- Port conflicts

**Solutions**:
```bash
# Reset local environment
npm run db:reset:local
npm run db:seed:local

# Check environment variables
cat .env.local

# Use different port
wrangler dev --port 8788
```

### Staging Environment Issues

**Common Problems**:
- Staging secrets not updated
- Database schema mismatch
- Test data pollution

**Solutions**:
```bash
# Update staging secrets
wrangler secret put HMAC_SECRET_KEY --env staging

# Reset staging database
npm run db:reset:staging
npm run db:migrate:staging

# Clean test data
npm run cleanup:staging
```

### Production Environment Issues

**Common Problems**:
- Secret key mismatches
- Database migration issues
- External service configuration

**Solutions**:
```bash
# Verify all secrets are set
wrangler secret list --env production

# Check migration status
npm run db:schema:production

# Validate external services
python scripts/test_mailchannels_send.py
```

## External Service Issues

### MailChannels Issues

**Symptoms**:
- Emails not being delivered
- "Failed to send email" errors
- High bounce rates

**Diagnosis**:
```bash
# Test MailChannels API
python scripts/test_mailchannels_send.py

# Check API key
wrangler secret list --env production | grep MAILCHANNEL

# Check recent email logs
wrangler tail --env production | grep -E "(mailchannel|email|smtp)"
```

**Solutions**:
```bash
# Update API key
wrangler secret put MAILCHANNEL_API_KEY --env production

# Check MailChannels status
curl -s https://status.mailchannels.com/api/v2/status.json

# Verify sender configuration
wrangler secret list --env production | grep SENDER
```

### Cloudflare Turnstile Issues

**Symptoms**:
- High false positive rate
- Users unable to complete verification
- "Invalid Turnstile token" errors

**Diagnosis**:
```bash
# Check Turnstile configuration
wrangler secret list --env production | grep TURNSTILE

# Test without Turnstile
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'
```

**Solutions**:
- Verify Turnstile site key matches secret key
- Check Turnstile dashboard for error rates
- Adjust Turnstile sensitivity settings

### Grafana/Monitoring Issues

**Symptoms**:
- Metrics not updating
- Dashboard showing no data
- Authentication errors

**Diagnosis**:
```bash
# Test metrics endpoint
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics

# Check API key
wrangler secret list --env production | grep GRAFANA
```

**Solutions**:
```bash
# Update Grafana API key
wrangler secret put GRAFANA_API_KEY --env production

# Test metrics collection
npm run metrics:production
```

## Database Issues

### Data Corruption

**Symptoms**:
- Integrity check failures
- Inconsistent data
- Query errors

**Diagnosis**:
```bash
# Check database integrity
wrangler d1 execute DB --env production --command="PRAGMA integrity_check;"

# Check for orphaned records
wrangler d1 execute DB --env production --command="
  SELECT COUNT(*) FROM subscribers WHERE email IS NULL OR email = '';
"
```

**Solutions**:
```bash
# Restore from backup
python scripts/db-backup-restore.py restore production latest

# Verify restoration
npm run test:smoke:production

# Clean up corrupted data
wrangler d1 execute DB --env production --command="
  DELETE FROM subscribers WHERE email IS NULL OR email = '';
"
```

### Migration Issues

**Symptoms**:
- Schema mismatch errors
- Missing columns/tables
- Migration failures

**Diagnosis**:
```bash
# Check current schema
npm run db:schema:production

# Check migration status
cat applied-migrations.json

# Compare with expected schema
diff <(npm run db:schema:production) migrations/0001_initial_schema.sql
```

**Solutions**:
```bash
# Apply missing migrations
npm run db:migrate:production

# Force migration if needed
wrangler d1 execute DB --env production --file=migrations/0001_initial_schema.sql

# Verify schema
npm run db:schema:production
```

## Monitoring and Alerts

### Setting Up Alerts

**Grafana Alert Rules**:
1. Service Down: `up == 0`
2. High Error Rate: `rate(http_errors_total[5m]) > 0.05`
3. Database Issues: `database_status != 1`
4. High Response Time: `avg(http_request_duration) > 1000`

**Manual Monitoring**:
```bash
# Monitor key metrics
watch -n 30 'curl -s -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics | grep -E "(up|database_status|newsletter_subscribers)"'

# Monitor error rate
watch -n 60 'curl -s https://api.rnwolf.net/health | jq .success'
```

### Alert Response Procedures

**Service Down Alert**:
1. Check health endpoint
2. Review recent deployments
3. Check external dependencies
4. Rollback if necessary

**High Error Rate Alert**:
1. Check error logs
2. Identify error patterns
3. Check recent changes
4. Apply fixes or rollback

**Database Alert**:
1. Test database connectivity
2. Check D1 service status
3. Restore from backup if needed
4. Verify data integrity

## Escalation Procedures

### When to Escalate

- Service down for > 15 minutes
- Data loss suspected
- Security incident detected
- Unable to resolve within 1 hour

### Escalation Contacts

1. **Development Team Lead**: For code-related issues
2. **Infrastructure Team**: For platform issues
3. **Security Team**: For security incidents
4. **Management**: For business impact

### Documentation Requirements

When escalating, provide:
- Issue description and timeline
- Steps already taken
- Current system status
- Business impact assessment
- Recommended next steps

## Related Documentation

- **[API Reference](api-reference.md)**: Detailed API documentation
- **[Deployment Runbook](deployment-runbook.md)**: Deployment and operational procedures
- **[Architecture Overview](architecture-overview.md)**: System design and components
- **[Testing Guide](testing-guide.md)**: Testing and validation procedures