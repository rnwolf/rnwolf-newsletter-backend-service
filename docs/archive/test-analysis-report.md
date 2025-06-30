# Newsletter Backend Service Testing

## Table of Contents

1. [Testing Philosophy & TDD Approach](#testing-philosophy--tdd-approach)
2. [Environment Overview](#environment-overview)
3. [Test File Architecture](#test-file-architecture)
4. [Development Workflow](#development-workflow)
5. [Testing Commands Reference](#testing-commands-reference)
6. [Deployment Testing Pipeline](#deployment-testing-pipeline)
7. [Test Data Management](#test-data-management)
8. [Troubleshooting Guide](#troubleshooting-guide)

## Testing Philosophy & TDD Approach

This project follows **Test-Driven Development (TDD)** principles with a multi-environment testing strategy:

### TDD Cycle

1. **Red**: Write failing tests for new features
2. **Green**: Write minimal code to make tests pass
3. **Refactor**: Improve code while keeping tests green
4. **Repeat**: Continue for each new feature or bug fix

### Testing Pyramid

```
                    🔺 Smoke Tests (Remote)
                   /   \ - Real HTTP requests
                  /     \ - Production validation
                 /       \ - End-to-end verification
                /_________\
               🔷 Integration Tests
              /             \ - Cross-component testing
             /               \ - Database operations
            /                 \ - Token generation/validation
           /___________________\
          🟦 Unit Tests (API + Unsubscribe)
         /                         \ - Individual endpoints
        /                           \ - CORS handling
       /                             \ - Error scenarios
      /                               \ - Input validation
     /_________________________________\


    🟩 Performance Tests
   - Load testing
   - Memory usage
   - Response times
   - Concurrent requests
```

## Environment Overview

### Local Environment

- **Purpose**: Fast development and unit testing
- **Technology**: Cloudflare Workers simulation via `@cloudflare/vitest-pool-workers`
- **Database**: Simulated D1 database in memory
- **URL**: `http://localhost:8787`
- **Characteristics**:
  - Instant feedback
  - No network latency
  - Isolated test environment
  - Full database control

### Staging Environment

- **Purpose**: Production-like testing before deployment
- **Technology**: Real Cloudflare Workers deployment
- **Database**: Real D1 database (staging)
- **URL**: `https://api-staging.rnwolf.net`
- **Characteristics**:
  - Real network conditions
  - Production-like infrastructure
  - Safe for breaking changes
  - Test data cleanup required

### Production Environment

- **Purpose**: Final validation and monitoring
- **Technology**: Live Cloudflare Workers deployment
- **Database**: Real D1 database (production)
- **URL**: `https://api.rnwolf.net`
- **Characteristics**:
  - Real user traffic
  - Zero tolerance for failures
  - Minimal, non-destructive testing only
  - Automatic test data cleanup

## Test File Architecture

### 1. `tests/api.test.ts` - Core API Unit Tests

**Purpose**: Comprehensive testing of the newsletter subscription API

**Test Categories**:

- ✅ **CORS Configuration**
  - OPTIONS preflight requests
  - CORS headers in all responses (success, error, 404)
  - Multiple origin scenarios
- ✅ **Health Check**
  - Service availability
  - Database connectivity
  - Environment verification
- ✅ **Newsletter Subscription**
  - Valid email acceptance
  - Email normalization (uppercase → lowercase)
  - Duplicate subscription handling
  - Invalid email rejection
  - Missing field validation
- ✅ **Error Handling**
  - Malformed JSON requests
  - Unknown endpoints (404)
  - Method not allowed (405)
  - Proper error response structure

**Environment Behavior**:

```typescript
// Local: Uses worker.fetch() simulation
// Staging/Production: Makes real HTTP requests (when using workers pool)
const config = TEST_CONFIG[TEST_ENV];
if (config.useWorkerFetch) {
  return await worker.fetch(request, env);
} else {
  return await fetch(url, options);
}
```

### 2. `tests/unsubscribe.test.ts` - Unsubscribe Worker Tests

**Purpose**: Testing the email unsubscription functionality

**Test Categories**:

- ✅ **Token Validation**
  - Valid HMAC token acceptance
  - Invalid token rejection
  - Wrong secret token rejection
  - Cross-email token validation
- ✅ **Database Operations**
  - Subscriber status updates
  - Already unsubscribed user handling
  - Non-existent email handling
  - Database error scenarios
- ✅ **HTTP Request Handling**
  - GET-only endpoint enforcement
  - URL-encoded email handling
  - CORS header validation
- ✅ **HTML Response Generation**
  - Success page structure
  - Error page structure
  - Responsive design elements

### 3. `tests/integration.test.ts` - Cross-Component Integration

**Purpose**: Testing complete user journeys and component interactions

**Test Scenarios**:

- 🔄 **Complete Flow Testing**
  - Subscribe → Verify → Unsubscribe → Verify
  - Resubscription after unsubscribe
  - Token generation compatibility
- 🔐 **Security Integration**
  - Token validation across components
  - HMAC compatibility between Python and Node.js
  - Cross-component CORS handling
- 🗄️ **Database Integration**
  - State consistency across operations
  - Transaction handling
  - Error recovery scenarios

### 4. `tests/performance.test.ts` - Load & Performance Testing

**Purpose**: Ensuring system performance under various load conditions

**Test Categories**:

- ⚡ **Response Time Testing**
  - Health endpoint performance
  - Subscription endpoint under load
  - P50, P95, P99 percentile tracking
- 🏋️ **Load Testing**
  - Concurrent user simulation
  - Database performance under load
  - Traffic spike handling
- 💾 **Resource Usage**
  - Memory consumption monitoring
  - Database connection efficiency
  - Error rate tracking

**Configuration by Environment**:

```typescript
const TEST_CONFIG = {
  local: {
    concurrentUsers: 5,
    requestsPerUser: 10,
    maxDuration: 10000 // 10 seconds
  },
  staging: {
    concurrentUsers: 10,
    requestsPerUser: 20,
    maxDuration: 30000 // 30 seconds
  },
  production: {
    concurrentUsers: 3,
    requestsPerUser: 5,
    maxDuration: 15000 // 15 seconds - light load only
  }
};
```

### 5. `tests/smoke-remote.test.ts` - Remote Environment Validation

**Purpose**: Real HTTP testing against deployed environments

**Key Features**:

- 🌐 **Real Network Requests**: No simulation, actual HTTP calls
- 🎯 **Environment-Specific**: Staging vs Production URLs
- 🧹 **Test Data Cleanup**: Automatic removal of test emails
- ⚡ **Fast Feedback**: Minimal, focused test suite

**Test Categories**:

- ✅ **Basic Functionality**
  - Health check validation
  - CORS header verification
  - Subscription flow testing
- ⚠️ **Error Scenarios**
  - Invalid input handling
  - 404 endpoint testing
  - Method validation
- 🚀 **Performance Validation**
  - Response time verification
  - Concurrent request handling

## Development Workflow

### 1. Local Development (TDD Cycle)

#### Step 1: Start Local Development Server

```bash
npm run dev
# Starts: http://localhost:8787
# Uses: wrangler dev --env local
```

#### Step 2: Write Failing Tests

```bash
# Run tests in watch mode for immediate feedback
npm run test:watch

# Or run specific test files
npx vitest tests/api.test.ts --watch
```

#### Step 3: Develop Features

1. Write failing test for new feature
2. Implement minimal code to pass test
3. Refactor while keeping tests green
4. Repeat

#### Step 4: Run Full Local Test Suite

```bash
# Unit and integration tests
npm run test

# Including performance tests
npm run test:local && npm run test:performance
```

### 2. Staging Deployment & Testing

#### Step 1: Deploy to Staging

```bash
# Quick deployment (skip tests if already run locally)
npm run deploy:staging

# Or full deployment with all checks
npm run deploy:staging:full
```

#### Step 2: Run Staging Tests

```bash
# Real HTTP tests against staging
npm run test:smoke:staging

# Check staging health
npm run test:health:staging
```

#### Step 3: Performance Testing

```bash
# Load test staging environment
npm run test:performance:staging
```

### 3. Production Deployment & Validation

#### Step 1: Deploy to Production

```bash
# Full production deployment with all safety checks
npm run deploy:production:full

# Quick deployment (if thoroughly tested)
./scripts/quick-deploy.sh production
```

#### Step 2: Production Smoke Tests

```bash
# Minimal, non-destructive testing
npm run test:smoke:production

# Health check only
npm run test:health:production
```

## Testing Commands Reference

### Core Testing Commands

| Command | Purpose | Environment | Test Type |
|---------|---------|-------------|-----------|
| `npm run test` | Full local test suite | Local | Unit + Integration |
| `npm run test:watch` | Development testing | Local | Unit + Integration |
| `npm run test:unit` | API + Unsubscribe only | Local | Unit |
| `npm run test:integration` | Cross-component tests | Local | Integration |

### Environment-Specific Testing

| Command | Purpose | Environment | Method |
|---------|---------|-------------|--------|
| `npm run test:local` | Local comprehensive | Local | Workers Pool |
| `npm run test:smoke:staging` | Staging validation | Staging | Real HTTP |
| `npm run test:smoke:production` | Production validation | Production | Real HTTP |

### Performance Testing

| Command | Purpose | Environment | Load Level |
|---------|---------|-------------|------------|
| `npm run test:performance` | Local load test | Local | Light |
| `npm run test:performance:staging` | Staging load test | Staging | Moderate |
| `npm run test:performance:production` | Production load test | Production | Very Light |

### Health Checks

| Command | Purpose | Method |
|---------|---------|--------|
| `npm run test:health:staging` | Quick staging check | cURL |
| `npm run test:health:production` | Quick production check | cURL |

### Deployment Commands

| Command | Purpose | Includes Tests |
|---------|---------|----------------|
| `npm run deploy:staging` | Basic staging deploy | No |
| `npm run deploy:staging:full` | Full staging deploy | Yes |
| `npm run deploy:production:full` | Full production deploy | Yes |
| `./scripts/quick-deploy.sh staging` | Quick staging | Optional |
| `./scripts/quick-deploy.sh production` | Quick production | Optional |

## Deployment Testing Pipeline

### 1. Pre-Deployment (Local)

```bash
# 1. Type checking
npm run type-check

# 2. Unit tests
npm run test:unit

# 3. Integration tests
npm run test:integration

# 4. Performance baseline
npm run test:performance
```

### 2. Staging Deployment

```bash
# 1. Deploy to staging
npm run deploy:staging

# 2. Database migration
npm run db:migrate:staging

# 3. Smoke tests
npm run test:smoke:staging

# 4. Performance validation
npm run test:performance:staging
```

### 3. Production Deployment

```bash
# 1. Full deployment with safety checks
npm run deploy:production:full

# This includes:
# - Pre-deployment checks
# - Database migration
# - Worker deployment
# - Health verification
# - Smoke tests
# - Cleanup
```

### 4. Post-Deployment Monitoring

```bash
# Health monitoring
npm run test:health:production

# Metrics access (requires auth)
npm run metrics:production
```

## Test Data Management

### Local Environment

- **Database**: Automatically reset between test runs
- **Test Data**: Generated uniquely per test
- **Cleanup**: Automatic via test framework

### Staging Environment

- **Test Emails**: Format `test+staging-smoke-test-{timestamp}-{random}@rnwolf.net`
- **Cleanup**: Automatic via deployment script
- **Persistence**: Test data may persist between runs

### Production Environment

- **Test Emails**: Format `test+smoke-test-{timestamp}-{random}@rnwolf.net`
- **Cleanup**: Immediate automatic removal
- **Logging**: All test emails logged for audit

### Cleanup Scripts

```bash
# Automatic cleanup (part of deployment)
./scripts/deploy.sh production --cleanup-only

# Manual cleanup
node tests/cleanup-smoke-tests.js

# Cleanup from file
node tests/cleanup-smoke-tests.js --from-file smoke-test-emails.txt
```

## Configuration Files

### Vitest Configurations

#### `vitest.config.ts` - Workers Pool (Local/Development)

```typescript
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          d1Databases: ['DB'],
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
```

#### `vitest.smoke.config.ts` - Real HTTP (Staging/Production)

```typescript
export default defineConfig({
  test: {
    testTimeout: 30000,
    include: ['tests/smoke-*.test.ts'],
    exclude: ['tests/api.test.ts', 'tests/unsubscribe.test.ts', 'tests/integration.test.ts'],
  },
});
```

### Environment Detection in Tests

```typescript
const TEST_ENV = process.env.TEST_ENV || 'local';

const TEST_CONFIG = {
  local: {
    baseUrl: 'http://localhost:8787',
    useWorkerFetch: true,    // Use simulation
    setupDatabase: true      // Reset DB each test
  },
  staging: {
    baseUrl: 'https://api-staging.rnwolf.net',
    useWorkerFetch: false,   // Real HTTP
    setupDatabase: false     // Use existing DB
  },
  production: {
    baseUrl: 'https://api.rnwolf.net',
    useWorkerFetch: false,   // Real HTTP
    setupDatabase: false     // Use existing DB
  }
};
```

## Troubleshooting Guide

### Common Issues

#### 1. "Tests running in wrong environment"

**Symptoms**: Seeing `http://localhost:8787` in staging/production tests
**Cause**: Using workers pool config for remote tests
**Solution**:

```bash
# Use smoke test config for remote environments
npm run test:smoke:staging  # Not npm run test:staging
npm run test:smoke:production  # Not npm run test:production
```

#### 2. "Database not found in local tests"

**Symptoms**: D1 database connection errors in local tests
**Cause**: Database not properly initialized
**Solution**:

```bash
# Run database migration for local
npm run db:migrate:local

# Or let tests auto-setup (they should do this automatically)
npm run test  # This should auto-setup DB
```

#### 3. "Smoke tests failing with CORS errors"

**Symptoms**: CORS errors in staging/production smoke tests
**Cause**: Origin header missing or incorrect
**Solution**: Check smoke test origin headers match expected domains

#### 4. "Performance tests timing out"

**Symptoms**: Tests failing with timeout errors
**Cause**: Network latency or high load
**Solution**:

```bash
# Reduce load for production
TEST_ENV=production npm run test:performance  # Uses lighter load
```

#### 5. "Test data not cleaned up"

**Symptoms**: Old test emails in production database
**Cause**: Cleanup script not running or failing
**Solution**:

```bash
# Manual cleanup
npm run deploy:cleanup
# Or
node tests/cleanup-smoke-tests.js
```

### Debug Commands

```bash
# View logs during deployment
npx wrangler tail --env production

# Check database contents
npx wrangler d1 execute DB --env production --remote --command="SELECT * FROM subscribers WHERE email LIKE '%smoke-test%';"

# Test health endpoints directly
curl https://api-staging.rnwolf.net/health
curl https://api.rnwolf.net/health

# Run single test file
npx vitest tests/api.test.ts --reporter=verbose

# Run with debug output
DEBUG=* npm run test:smoke:production
```

### Best Practices

#### For Developers

1. **Always start with local tests**: `npm run test:watch`
2. **Use TDD cycle**: Red → Green → Refactor
3. **Test staging before production**: `npm run test:smoke:staging`
4. **Run performance tests**: Especially after changes
5. **Clean up test data**: Let deployment scripts handle this

#### For CI/CD

1. **Use full deployment scripts**: `./scripts/deploy.sh`
2. **Set appropriate timeouts**: Network requests take time
3. **Monitor test data cleanup**: Ensure no pollution
4. **Use environment-specific configs**: Don't mix workers pool with real HTTP

#### For Production

1. **Minimal testing only**: Use smoke tests, not full suite
2. **Immediate cleanup**: Never leave test data
3. **Monitor after deployment**: Check health endpoints
4. **Have rollback ready**: Use `./scripts/quick-deploy.sh rollback`

## Conclusion

This comprehensive testing strategy provides:

- **Fast feedback** during development (local workers pool)
- **Realistic validation** before deployment (staging smoke tests)
- **Production safety** with minimal impact testing
- **Automatic cleanup** to prevent data pollution
- **Performance monitoring** across all environments
- **Clear separation** between test types and environments

The TDD approach ensures high code quality while the multi-environment strategy provides confidence in deployments from local development all the way to production.


## Current Test File Status

### Active Test Files

These are the main test files being used and maintained:

1. **`api.test.ts`** ✅ **KEEP - Primary API Tests**
   - Comprehensive CORS testing
   - Health check validation
   - Newsletter subscription flow
   - Error handling scenarios
   - Environment-aware testing (local/staging/production)
   - **Coverage**: Full API functionality, CORS, error responses

2. **`integration.test.ts`** ✅ **KEEP - End-to-End Tests**
   - Complete subscribe → unsubscribe flow
   - Resubscription scenarios
   - Token generation compatibility
   - CORS integration testing
   - Cross-environment testing
   - **Coverage**: Full workflow integration, token compatibility

3. **`unsubscribe.test.ts`** ✅ **KEEP - Unsubscribe Functionality**
   - Token validation (valid/invalid/wrong secret)
   - Database operations for unsubscribe
   - HTTP request handling
   - HTML response generation
   - Environment-aware testing
   - **Coverage**: Complete unsubscribe worker functionality

4. **`setup.ts`** ✅ **KEEP - Test Utilities**
   - Database setup helper
   - Used by other test files
   - **Coverage**: Test infrastructure


5. **`env.d.ts`** ✅ **KEEP - Type Definitions**
    - **Status**: Required for TypeScript support

## Test Coverage Analysis

### ✅ Well Covered Features

1. **CORS Configuration**
   - Preflight requests
   - Origin validation
   - Headers in responses
   - Method restrictions

2. **Newsletter Subscription**
   - Email validation (valid/invalid formats)
   - Email normalization
   - Duplicate handling
   - Database storage
   - Turnstile integration (mocked)

3. **Newsletter Unsubscribe**
   - HMAC token validation
   - Database updates
   - HTML response generation
   - Error scenarios

4. **Error Handling**
   - Invalid inputs
   - Database errors
   - Network timeouts
   - Malformed requests

5. **Integration Flows**
   - Subscribe → Unsubscribe → Resubscribe
   - Token compatibility (Python ↔ Node.js)
   - Cross-environment testing

6. **Environment Testing**
   - Local (worker.fetch)
   - Staging (real HTTP)
   - Production (smoke tests)

## ⚠️ Areas for Improvement

1. **Rate Limiting** - Not tested
2. **Cloudflare-specific Headers** - Limited testing
3. **Database Schema Migrations** - Not tested
4. **Backup/Restore Procedures** - Not tested
