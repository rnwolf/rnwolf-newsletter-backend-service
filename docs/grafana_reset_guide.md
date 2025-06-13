# Complete Grafana Integration Reset & Rebuild Guide

This guide will walk you through completely resetting and rebuilding your Newsletter service Grafana integration from scratch with extensive validation and testing.

## 🚨 Before You Start

**⚠️ WARNING**: This process will delete ALL existing Grafana datasources, dashboards, and API tokens related to the newsletter service. Make sure you're prepared for this.

### Prerequisites

1. **Admin Access**: You need admin-level API tokens for Grafana Cloud
2. **Backup**: Take screenshots of current dashboards if you want to reference them later
3. **Environment Access**: Ensure you can deploy to both staging and production
4. **Time**: Allow 30-60 minutes for the complete process

## Step 1: Prepare Your Environment

### 1.1 Set Current API Keys (for cleanup)

```bash
# Set these if you have existing admin tokens
export GRAFANA_API_KEY_STAGING="your_current_staging_admin_token"
export GRAFANA_API_KEY_PRODUCTION="your_current_production_admin_token"
```

### 1.2 Make Scripts Executable

```bash
cd /path/to/your/newsletter-project
chmod +x scripts/grafana-reset-rebuild.sh
chmod +x scripts/grafana-validation-testing.sh
```

### 1.3 Verify Prerequisites

```bash
# Check you have required tools
which curl python3 npx
npx wrangler --version

# Verify project structure
ls -la grafana/
ls -la wrangler.jsonc
```

## Step 2: Complete Reset and Rebuild

### 2.1 Run the Reset Script

```bash
# Full reset and rebuild (recommended)
./scripts/grafana-reset-rebuild.sh

# OR if you want to see what it would do first
./scripts/grafana-reset-rebuild.sh --dry-run

# OR if you only want to clean up existing setup
./scripts/grafana-reset-rebuild.sh --cleanup-only
```

### 2.2 Expected Output

The script will:

1. ✅ Check prerequisites and permissions
2. 🧹 Delete all existing newsletter dashboards
3. 🧹 Delete all existing newsletter datasources  
4. 🆕 Create new service accounts for staging and production
5. 🔑 Generate new API tokens
6. 🔗 Create new datasources
7. 📊 Create new dashboards
8. ☁️ Update Cloudflare Worker secrets
9. ✅ Validate the complete setup

### 2.3 Save New API Tokens

The script will output new API tokens like this:

```
GRAFANA_API_KEY_STAGING=glsa_new_staging_token_here
GRAFANA_API_KEY_PRODUCTION=glsa_new_production_token_here
```

**IMPORTANT**: 
- Copy these tokens immediately
- Update your environment variables
- The script saves them to a timestamped file for backup

## Step 3: Update Your Environment

### 3.1 Update Local Environment

```bash
# Update your .env file or environment
export GRAFANA_API_KEY_STAGING="glsa_new_staging_token_here"
export GRAFANA_API_KEY_PRODUCTION="glsa_new_production_token_here"
```

### 3.2 Update Cloudflare Secrets (Done automatically by script)

The script automatically updates these, but you can verify:

```bash
# Check secrets are set
npx wrangler secret list --env staging
npx wrangler secret list --env production
```

## Step 4: Validate the Integration

### 4.1 Run Comprehensive Tests

```bash
# Test all environments
./scripts/grafana-validation-testing.sh

# Test specific environment
./scripts/grafana-validation-testing.sh staging
./scripts/grafana-validation-testing.sh production

# Generate test data and test staging
./scripts/grafana-validation-testing.sh --generate-data staging
```

### 4.2 Expected Test Results

The validation script runs 10 tests per environment:

1. ✅ API Health Check
2. ✅ Metrics Authentication  
3. ✅ Metrics Content
4. ✅ Prometheus API Compatibility
5. ✅ Database Metrics
6. ✅ Grafana Datasource
7. ✅ Grafana Dashboard
8. ✅ End-to-End Metric Flow
9. ✅ Performance Testing
10. ✅ Cloudflare Secrets

**Success Output**:
```
================================================================
  Newsletter Grafana Integration - Validation & Testing
================================================================

[STEP] Running tests for staging environment...
[TEST] Running: staging: API Health Check
✓ PASSED: staging: API Health Check

... (all tests)

🎉 All tests passed!
Total Tests: 20
Passed: 20
Failed: 0
```

## Step 5: Manual Verification

### 5.1 Check Grafana UI

1. **Visit Grafana**: https://throughputfocus.grafana.net
2. **Check Datasources**: 
   - Go to Connections → Data sources
   - Look for "Newsletter-API-Staging" and "Newsletter-API-Production"
   - Click each one and "Save & Test"

3. **Check Dashboards**:
   - Go to Dashboards
   - Look for newsletter dashboards
   - Open each dashboard and verify data is loading

### 5.2 Test API Endpoints Manually

```bash
# Test staging metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY_STAGING" \
  https://api-staging.rnwolf.net/metrics

# Test production metrics  
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics

# Test Prometheus API compatibility
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=newsletter_subscribers_total"
```

### 5.3 Verify Dashboard Data

1. **Open Production Dashboard**: 
   - Should show real subscriber data
   - Database status should be "Connected"
   - Metrics should have recent timestamps

2. **Open Staging Dashboard**:
   - May show less data (that's normal)
   - Database status should be "Connected"
   - Test by creating a staging subscription

## Step 6: Troubleshooting

### 6.1 Common Issues

**Issue**: "No data" in dashboard panels
```bash
# Check metrics endpoint directly
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics

# Look for specific metrics
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics | grep newsletter_subscribers_total
```

**Issue**: Authentication errors
```bash
# Verify API key is set correctly
echo $GRAFANA_API_KEY_PRODUCTION

# Check Cloudflare secret
npx wrangler secret list --env production
```

**Issue**: Dashboard shows "Query returned empty result"
- Wait 5-10 minutes for data to populate
- Generate test data in staging
- Check API endpoint response format

### 6.2 Debug Scripts

```bash
# Run debugging script for datasources
./scripts/debug-datasources.sh

# Debug metrics output
./scripts/debug-metrics.sh production

# Debug individual panel queries  
./scripts/debug-grafana-panels.sh
```

### 6.3 Reset Individual Components

```bash
# Reset only datasources
./scripts/create-datasources.sh

# Reset only dashboards
./scripts/create-dashboards.sh production --nuclear

# Reset only secrets
echo "new_token" | npx wrangler secret put GRAFANA_API_KEY --env production
```

## Step 7: Testing the Complete Flow

### 7.1 Create Test Data

```bash
# Create a test subscription in staging
curl -X POST https://api-staging.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.rnwolf.net" \
  -d '{"email":"test-'$(date +%s)'@example.com"}'
```

### 7.2 Verify Metrics Update

```bash
# Wait 30 seconds, then check metrics
sleep 30

curl -H "Authorization: Bearer $GRAFANA_API_KEY_STAGING" \
  https://api-staging.rnwolf.net/metrics | grep newsletter_subscribers_total
```

### 7.3 Check Dashboard Updates

1. Open staging dashboard in Grafana
2. Refresh the page
3. Verify subscriber count increased
4. Check that timestamp is recent

## Step 8: Final Cleanup

### 8.1 Remove Temporary Files

```bash
# Remove token backup files (after saving tokens elsewhere)
rm -f .grafana-tokens-*.env

# Remove any temporary debugging files
rm -f /tmp/dashboard_*.json
```

### 8.2 Update Documentation

Update your team documentation with:
- New API token locations
- Dashboard URLs
- Any custom modifications made

### 8.3 Set Up Monitoring and Alerts

```bash
# Test alert conditions (if you have them configured)
# This should trigger if subscriber count drops to 0
curl -X POST https://api-staging.rnwolf.net/v1/newsletter/unsubscribe?email=test@example.com&token=invalid

# Monitor dashboard for alert triggers
```

## Step 9: Ongoing Maintenance

### 9.1 Regular Validation

Run the validation script weekly:

```bash
# Add to cron or CI/CD pipeline
./scripts/grafana-validation-testing.sh --skip-perf
```

### 9.2 Token Rotation

Every 90 days, rotate API tokens:

```bash
./scripts/rotate-grafana-keys.sh
```

### 9.3 Dashboard Updates

When updating dashboard configurations:

```bash
# Validate JSON first
./scripts/validate-dashboard-json.sh

# Deploy updates
./scripts/create-dashboards.sh production --update
```

## 📋 Quick Reference

### Essential Commands

```bash
# Full reset and rebuild
./scripts/grafana-reset-rebuild.sh

# Validate everything works
./scripts/grafana-validation-testing.sh

# Debug specific issues
./scripts/debug-metrics.sh production
./scripts/debug-datasources.sh
./scripts/debug-grafana-panels.sh

# Check API health
curl https://api.rnwolf.net/health
curl https://api-staging.rnwolf.net/health

# Test metrics with auth
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics
```

### Important URLs

- **Grafana Dashboards**: https://throughputfocus.grafana.net/dashboards
- **Grafana Datasources**: https://throughputfocus.grafana.net/connections/datasources  
- **Production API**: https://api.rnwolf.net
- **Staging API**: https://api-staging.rnwolf.net
- **Production Metrics**: https://api.rnwolf.net/metrics
- **Staging Metrics**: https://api-staging.rnwolf.net/metrics

### Environment Variables

```bash
# Required for scripts
export GRAFANA_API_KEY_STAGING="glsa_..."
export GRAFANA_API_KEY_PRODUCTION="glsa_..."

# Optional for debugging
export CLOUDFLARE_ACCOUNT_ID="your_account_id"
export CLOUDFLARE_API_TOKEN="your_api_token"
```

## 🔧 Advanced Troubleshooting

### Issue: Metrics Showing Zero Values

**Symptoms**: Dashboard shows 0 subscribers, but you know there are subscribers

**Diagnosis**:
```bash
# Check database directly
npx wrangler d1 execute DB --env production --remote \
  --command "SELECT COUNT(*) FROM subscribers"

# Check metrics endpoint
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics/database
```

**Solution**:
- Database connection issue
- Metrics collection logic error
- Check Worker logs: `npx wrangler tail --env production`

### Issue: Dashboard Shows "No Data"

**Symptoms**: Panels show "No data" even though metrics endpoint returns data

**Diagnosis**:
```bash
# Test Prometheus API format
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=up"

# Check datasource configuration
./scripts/debug-datasources.sh
```

**Solution**:
- Datasource URL incorrect
- Authentication headers wrong
- Prometheus API format issues

### Issue: Authentication Failures

**Symptoms**: 401 errors when accessing metrics

**Diagnosis**:
```bash
# Check token validity
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://throughputfocus.grafana.net/api/user

# Check Cloudflare secret
npx wrangler secret list --env production
```

**Solution**:
- Token expired or invalid
- Cloudflare secret not updated
- Service account permissions changed

### Issue: Performance Problems

**Symptoms**: Slow dashboard loading, timeouts

**Diagnosis**:
```bash
# Run performance tests
./scripts/grafana-validation-testing.sh production

# Test API response time
time curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics
```

**Solution**:
- Database performance issues
- Too many concurrent requests
- Network connectivity problems

## 📊 Expected Metrics and Values

### Healthy Production Dashboard Should Show:

- **Total Subscribers**: > 0 (your actual subscriber count)
- **Active Subscribers**: ≤ Total Subscribers  
- **Database Status**: "Connected" (green)
- **Service Status**: "Up" (green)
- **24h Subscriptions**: ≥ 0
- **24h Unsubscribes**: ≥ 0
- **Response Times**: < 1000ms average

### Staging Dashboard May Show:

- **Lower subscriber counts** (normal)
- **Test emails** from validation scripts
- **Occasional test data spikes**
- **Similar response times** to production

## 🔄 Recovery Procedures

### If Everything Breaks

1. **Stop the bleeding**:
   ```bash
   # Check services are still running
   curl https://api.rnwolf.net/health
   curl https://api-staging.rnwolf.net/health
   ```

2. **Quick diagnostics**:
   ```bash
   ./scripts/grafana-validation-testing.sh --skip-perf
   ```

3. **Nuclear option** (rebuilds everything):
   ```bash
   ./scripts/grafana-reset-rebuild.sh
   ```

### If Only Dashboards Break

```bash
# Delete and recreate dashboards only
./scripts/create-dashboards.sh production --nuclear
./scripts/create-dashboards.sh staging --nuclear
```

### If Only Datasources Break

```bash
# Recreate datasources only
./scripts/create-datasources.sh
```

### If Only Metrics Break

```bash
# Check Worker deployment
npx wrangler deployments list --env production

# Redeploy if needed
npm run deploy:production

# Test metrics endpoint
curl -H "Authorization: Bearer $GRAFANA_API_KEY_PRODUCTION" \
  https://api.rnwolf.net/metrics
```

## 🎯 Success Criteria

Your integration is successfully reset and rebuilt when:

✅ **All validation tests pass** (20/20)
✅ **Dashboards show real data** (not "No data")  
✅ **Database status is "Connected"**
✅ **Metrics endpoint responds < 2 seconds**
✅ **Prometheus API compatibility works**
✅ **New API tokens are properly stored**
✅ **Cloudflare secrets are updated**
✅ **Both staging and production work**

## 📞 Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs**:
   ```bash
   npx wrangler tail --env production
   npx wrangler tail --env staging
   ```

2. **Run diagnostic scripts**:
   ```bash
   ./scripts/debug-metrics.sh production
   ./scripts/debug-datasources.sh
   ./scripts/debug-grafana-panels.sh
   ```

3. **Validate step by step**:
   ```bash
   # Test each component individually
   curl https://api.rnwolf.net/health
   curl -H "Authorization: Bearer $TOKEN" https://api.rnwolf.net/metrics
   curl -H "Authorization: Bearer $TOKEN" https://throughputfocus.grafana.net/api/datasources
   ```

4. **Check Grafana UI manually**:
   - Datasource configuration and connectivity
   - Dashboard panel queries
   - Time range settings

Remember: The scripts are designed to be safe and provide detailed output about what they're doing. Don't hesitate to run them multiple times if needed.