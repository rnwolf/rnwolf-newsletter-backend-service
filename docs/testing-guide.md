# Newsletter Backend Service - Comprehensive Testing Guide

## Table of Contents

1. [Testing Philosophy & Strategy](#testing-philosophy--strategy)
2. [Test Environment Matrix](#test-environment-matrix)
3. [Development Pipeline](#development-pipeline)
4. [Test File Architecture](#test-file-architecture)
5. [Testing Commands Reference](#testing-commands-reference)
6. [TDD Implementation Workflow](#tdd-implementation-workflow)
7. [Deployment Testing Pipeline](#deployment-testing-pipeline)
8. [Test Data Management](#test-data-management)
9. [Troubleshooting Guide](#troubleshooting-guide)

## Testing Philosophy & Strategy

This project follows **Test-Driven Development (TDD)** with a comprehensive multi-environment testing strategy designed for Cloudflare Workers deployment.

### Core Principles

1. **Test First**: Write tests before implementation
2. **Environment Parity**: Tests run in environments that match deployment targets
3. **Fail Fast**: Catch issues early in the development pipeline
4. **Real-world Validation**: Post-deployment tests against actual deployed services

### Testing Pyramid

```
                    🔺 Smoke Tests (Production)
                   /   \ - Real HTTP requests to deployed API
                  /     \ - Critical path validation
                 /       \ - Minimal test data footprint
                /_________\
               🔷 Integration Tests (Environment-specific)
              /             \ - Cross-component testing
             /               \ - Database operations
            /                 \ - Queue processing
           /___________________\
          🟦 Unit Tests (Local)
         /                         \ - Individual endpoints
        /                           \ - CORS handling
       /                             \ - Error scenarios
      /                               \ - Input validation
     /_________________________________\

    🟩 Performance Tests (Load & Stress)
   - Concurrent request handling
   - Memory usage validation
   - Response time benchmarks
```

## Test Environment Matrix

| Test Phase | Command | Config File | Environment | Base URL | CORS Origin | Database | Purpose |
|------------|---------|-------------|-------------|----------|-------------|----------|---------|
| **Pre-deployment** | `test:unit` | `vitest.config.local.ts` | `'local'` | `http://localhost:8787` | `http://localhost:3000` | In-memory | Code validation |
| **Pre-deployment** | `test:integration` | `vitest.config.local.ts` | `'local'` | `http://localhost:8787` | `http://localhost:3000` | In-memory | Component integration |
| **Post-deployment (Staging)** | `test:staging:workers` | `vitest.config.staging.ts` | `'staging'` | `https://api-staging.rnwolf.net` | `https://staging.rnwolf.net` | Remote D1 | Deployment validation |
| **Post-deployment (Production)** | `test:smoke:production` | `vitest.config.production.ts` | `'production'` | `https://api.rnwolf.net` | `https://www.rnwolf.net` | Remote D1 | Production health check |
| **Performance Testing** | `test:performance:*` | Environment-specific | Variable | Environment-specific | Environment-specific | Environment-specific | Load & stress testing |

### Environment Configuration Details

#### Local Environment
- **Purpose**: Fast development feedback and unit testing
- **Technology**: Cloudflare Workers simulation via `@cloudflare/vitest-pool-workers`
- **Database**: Simulated D1 database in memory with full schema
- **Email**: No actual emails sent (mocked queue)
- **Secrets**: Test values (e.g., `HMAC_SECRET_KEY: 'test-secret'`)

#### Staging Environment  
- **Purpose**: Pre-production validation with real infrastructure
- **Technology**: Deployed Cloudflare Worker on staging subdomain
- **Database**: Real D1 database (staging instance)
- **Email**: Filtered (test domains blocked by email worker)
- **Secrets**: Real staging secrets from Cloudflare

#### Production Environment
- **Purpose**: Minimal smoke tests to verify deployment health
- **Technology**: Deployed Cloudflare Worker on production domain
- **Database**: Real D1 database (production instance)
- **Email**: Filtered (test domains blocked by email worker)
- **Secrets**: Real production secrets from Cloudflare

## Development Pipeline

### 1. Local Development (TDD Cycle)

```bash
# RED: Write failing test
npm run test:unit                    # Should fail initially

# GREEN: Implement minimal code
npm run test:unit                    # Should pass

# REFACTOR: Improve code quality
npm run test:unit                    # Should still pass
npm run test:integration             # Broader validation
```

### 2. Pre-deployment Validation

```bash
# Type checking
npm run type-check

# Unit tests (local environment)
npm run test:unit

# Integration tests (local environment) 
npm run test:integration

# Performance tests (optional)
npm run test:performance
```

### 3. Deployment Process

```bash
# Deploy to staging
./scripts/deploy.sh staging

# Automatic post-deployment tests run:
# - npm run test:staging:workers
```

### 4. Production Deployment

```bash
# Deploy to production
./scripts/deploy.sh production

# Automatic smoke tests run:
# - npm run test:smoke:production
```

## Test File Architecture

### Core Test Files

| File | Environment | Purpose | Key Features |
|------|-------------|---------|--------------|
| `api.test.ts` | All | API endpoint testing | CORS, validation, error handling |
| `integration.test.ts` | All | Cross-component flows | Subscribe → unsubscribe workflows |
| `unsubscribe.test.ts` | All | Unsubscribe functionality | Token validation, HTML responses |
| `email-verification.test.ts` | Local | Email verification logic | Token generation, validation |
| `email-verification-integration.test.ts` | All | Email verification flows | Complete verification workflows |
| `email-verification-endpoint.test.ts` | All | Verification endpoint | GET request handling |
| `queue-processing.test.ts` | Local | Queue worker testing | Email queue processing |
| `metrics.test.ts` | All | Metrics collection | Performance monitoring |
| `performance.test.ts` | All | Load testing | Concurrent requests, response times |
| `smoke-remote.test.ts` | Remote only | Production health | Critical path validation |

### Test Configuration Files

| File | Purpose | Environment Variables |
|------|---------|----------------------|
| `vitest.config.local.ts` | Local development | `ENVIRONMENT: 'local'`, test secrets |
| `vitest.config.staging.ts` | Staging validation | `ENVIRONMENT: 'staging'`, staging URLs |
| `vitest.config.production.ts` | Production smoke tests | `ENVIRONMENT: 'production'`, production URLs |

### Test Setup Files

| File | Purpose |
|------|---------|
| `tests/setup.ts` | Local environment setup |
| `tests/setup-staging.ts` | Staging environment validation |
| `tests/setup-smoke.ts` | Production smoke test setup |

## Testing Commands Reference

### Development Commands

```bash
# Local development
npm run test:unit                    # Unit tests (local)
npm run test:integration             # Integration tests (local)
npm run test:queue                   # Queue processing tests
npm run test:metrics                 # Metrics collection tests

# Email verification specific
npm run test:email-verification:unit        # Email verification unit tests
npm run test:email-verification:integration # Email verification integration
npm run test:email-verification:full        # Complete email verification suite
```

### Environment-Specific Commands

```bash
# Local environment
npm run test:local                   # All tests in local environment

# Staging environment  
npm run test:staging                 # All tests with staging config
npm run test:staging:workers         # Integration tests against deployed staging

# Production environment
npm run test:production              # All tests with production config
npm run test:smoke:production        # Smoke tests against deployed production
```

### Performance Testing

```bash
# Local performance testing
npm run test:performance             # Load tests in local environment

# Environment-specific performance
npm run test:performance:staging     # Load tests against staging
npm run test:performance:production  # Load tests against production
```

### Metrics Testing

```bash
# Environment-specific metrics validation
npm run test:metrics:local           # Local metrics testing
npm run test:metrics:staging         # Staging metrics validation
npm run test:metrics:production      # Production metrics validation
```

## TDD Implementation Workflow

### Phase 1: Write Failing Tests (RED)

1. **Identify the feature** to implement
2. **Write test cases** that describe the expected behavior
3. **Run tests** - they should fail initially
4. **Commit the failing tests** to establish the contract

```bash
# Example: Adding new endpoint
npm run test:unit                    # Should fail for new endpoint
```

### Phase 2: Implement Minimal Code (GREEN)

1. **Write minimal code** to make tests pass
2. **Focus on functionality**, not optimization
3. **Run tests frequently** to get immediate feedback

```bash
# Implement the feature
npm run test:unit                    # Should pass now
npm run test:integration             # Broader validation
```

### Phase 3: Refactor & Optimize (REFACTOR)

1. **Improve code quality** without changing behavior
2. **Add error handling** and edge cases
3. **Optimize performance** if needed
4. **Ensure tests still pass**

```bash
# After refactoring
npm run test:unit                    # Should still pass
npm run test:integration             # Should still pass
npm run test:performance             # Check performance impact
```

### Phase 4: Integration Testing

1. **Test cross-component interactions**
2. **Validate database operations**
3. **Test queue processing**

```bash
npm run test:integration             # Cross-component testing
npm run test:queue                   # Queue processing
npm run test:email-verification:full # Complete workflows
```

## Deployment Testing Pipeline

### Pre-deployment Tests (Local Environment)

The deploy script runs these tests before deployment:

```bash
# Type checking
npm run type-check

# Unit tests (fast feedback)
npm run test:unit

# Integration tests (component interaction)
npm run test:integration
```

**Purpose**: Validate code quality and functionality before deployment.

### Post-deployment Tests (Target Environment)

After successful deployment, environment-specific tests run:

#### Staging Deployment
```bash
npm run test:staging:workers
```
- Tests against deployed staging API
- Validates real infrastructure
- Uses staging database and configuration
- Includes email verification workflows

#### Production Deployment
```bash
npm run test:smoke:production
```
- Minimal critical path testing
- Validates production health
- Quick feedback on deployment success
- Automatic cleanup of test data

## Test Data Management

### Email Address Patterns

| Environment | Pattern | Example | Email Sent? |
|-------------|---------|---------|-------------|
| Local | `@example.com` | `test@example.com` | No (mocked) |
| Staging | `test+staging-smoke-test@rnwolf.net` | `test+staging-smoke-test-123-abc@rnwolf.net` | No (filtered) |
| Production | `test+smoke-test@rnwolf.net` | `test+smoke-test-456-def@rnwolf.net` | No (filtered) |

### Email Filtering

The email verification worker automatically filters test emails:

```typescript
const testEmailDomains = [
  '@example.com',
  '@example.org', 
  '@example.net',
  '@test.com',
  '@test.example.com',
  '@performance-test.example.com',
  '@smoke-test.example.com'
];

// Also check for plus addressing test patterns (test+something@domain)
const isTestEmailDomain = testEmailDomains.some(domain => email.endsWith(domain));
const isTestEmailPlusAddressing = email.includes('+smoke-test') || email.includes('+staging-smoke-test') || email.startsWith('test+');

const isTestEmail = isTestEmailDomain || isTestEmailPlusAddressing;
```

### Database State Management

- **Local**: Fresh database for each test run
- **Staging**: Persistent database, tests use unique identifiers
- **Production**: Minimal test data, automatic cleanup

### Test Data Cleanup

```bash
# Automatic cleanup after deployment
./scripts/deploy.sh staging          # Includes automatic cleanup
./scripts/deploy.sh production       # Includes automatic cleanup

# Manual cleanup if needed
npm run cleanup:staging
npm run cleanup:production
```

## Troubleshooting Guide

### Common Issues

#### 1. Environment Detection Problems

**Symptom**: Tests show wrong environment (e.g., "local" when expecting "staging")

**Solution**: Check vitest configuration and environment variables
```bash
# Verify environment detection
console.log('env.ENVIRONMENT:', env.ENVIRONMENT);
console.log('config.corsOrigin:', config.corsOrigin);
```

#### 2. CORS Errors in Tests

**Symptom**: `expected 'https://www.rnwolf.net' to be 'http://localhost:3000'`

**Cause**: Test running in wrong environment

**Solution**: Ensure correct vitest config is used
```bash
# Check which config is being used
npm run test:staging:workers         # Should use vitest.config.staging.ts
```

#### 3. Database Connection Issues

**Symptom**: Database queries fail in tests

**Local**: Check D1 binding in vitest config
**Staging/Production**: Verify database ID and environment

#### 4. Email Verification Issues

**Symptom**: Undelivered mail bounce messages

**Cause**: Real emails being sent to test domains

**Solution**: Verify email filtering is working
```bash
# Check email worker logs for filtering messages
# Should see: [TEST_EMAIL_SKIP] messages
```

#### 5. Queue Processing Failures

**Symptom**: Queue tests fail or timeout

**Local**: Check queue mocking in test setup
**Remote**: Verify queue configuration in wrangler.jsonc

### Debug Commands

```bash
# Check test environment configuration
npm run test:staging:workers -- --reporter=verbose

# Validate metrics endpoints
npm run test:metrics:staging

# Check database state
npm run db:subscribers:staging

# Verify deployment health
npm run test:health:staging
```

### Performance Issues

```bash
# Run performance tests to identify bottlenecks
npm run test:performance:staging

# Check metrics for response times
npm run metrics:staging

# Validate concurrent request handling
npm run test:load
```

## Best Practices

### Test Writing

1. **Write descriptive test names** that explain the expected behavior
2. **Use the AAA pattern**: Arrange, Act, Assert
3. **Test both success and failure scenarios**
4. **Keep tests independent** and idempotent
5. **Use appropriate test data** for each environment

### Environment Management

1. **Use environment-specific configurations** consistently
2. **Never send real emails** from test environments
3. **Clean up test data** after test runs
4. **Monitor test performance** and optimize slow tests

### Deployment Pipeline

1. **Run full test suite** before deployment
2. **Validate deployment** with post-deployment tests
3. **Monitor production health** with smoke tests
4. **Have rollback procedures** ready for failures

This comprehensive testing guide ensures reliable, maintainable code and smooth deployments across all environments.