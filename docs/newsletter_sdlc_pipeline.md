# Newsletter Service - SDLC Pipeline & API Versioning Strategy

## Overview

This document outlines the complete Software Development Life Cycle (SDLC) for the newsletter subscription service, from local development through production deployment, with emphasis on versioned API management and safe endpoint retirement.

## Environment Architecture

### 1. Environment Hierarchy

```
Local Development → Staging/Test → Production
     ↓                  ↓             ↓
localhost:8787    api-staging    api.yourdomain.com
                 .yourdomain.com
```

### 2. API Versioning Structure

**Current Production APIs:**
- `https://api.yourdomain.com/v1/newsletter/subscribe`
- `https://api.yourdomain.com/v1/newsletter/unsubscribe`

**Future Versioning Pattern:**
- `https://api.yourdomain.com/v2/newsletter/subscribe` (future breaking changes)
- `https://api.yourdomain.com/v3/newsletter/subscribe` (future breaking changes)

**Staging Environment:**
- `https://api-staging.yourdomain.com/v1/newsletter/subscribe`
- `https://api-staging.yourdomain.com/v2/newsletter/subscribe` (testing new version)

## SDLC Pipeline Stages

### Stage 1: Local Development Environment

**Purpose**: Rapid development and initial testing using TDD methodology

**Technology Stack:**
- **Local Runtime**: Wrangler dev with `--local` flag (uses Miniflare/workerd)
- **Database**: Local D1 database instance
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`
- **URL**: `http://localhost:8787`

**Development Process:**
1. **TDD Cycle Implementation**:
   ```bash
   # Write tests first
   npm run test:watch
   
   # Run local development server
   npx wrangler dev --local
   
   # Test endpoints locally
   curl -X POST http://localhost:8787/v1/newsletter/subscribe \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","turnstileToken":"test-token"}'
   ```

2. **Local Testing Checklist**:
   - [ ] All unit tests pass
   - [ ] Integration tests pass with local D1
   - [ ] Turnstile verification mocked correctly
   - [ ] Error handling scenarios tested
   - [ ] CORS headers verified

**Local Environment Setup:**
```bash
# Install dependencies
npm install

# Setup local D1 database
npx wrangler d1 create newsletter-db-local
npx wrangler d1 execute newsletter-db-local --file=./schema.sql

# Start local development
npx wrangler dev --local --persist-to=./local-storage
```

### Stage 2: Staging/Test Environment (Cloudflare-hosted)

**Purpose**: Integration testing with real Cloudflare services and API contract validation

**Environment Configuration:**
- **Domain**: `api-staging.yourdomain.com`
- **Database**: Separate D1 staging database
- **Turnstile**: Staging site key configured for testing
- **DNS**: CNAME pointing to Cloudflare Workers

**Deployment Process:**
```bash
# Deploy to staging environment
npx wrangler deploy --env staging

# Run integration tests against staging
npm run test:integration:staging
```

**Staging Testing Checklist**:
- [ ] Real Turnstile verification works
- [ ] D1 database operations function correctly
- [ ] CORS headers work from staging frontend
- [ ] Performance within acceptable limits
- [ ] Error scenarios return correct status codes
- [ ] API contract compliance verified

**API Version Testing on Staging:**
```bash
# Test current version
curl https://api-staging.yourdomain.com/v1/newsletter/subscribe

# Test new version (when developing v2)
curl https://api-staging.yourdomain.com/v2/newsletter/subscribe
```

### Stage 3: Production Environment

**Purpose**: Live service serving real users with multiple API versions

**Environment Configuration:**
- **Domain**: `api.yourdomain.com`
- **Database**: Production D1 database with backups
- **Turnstile**: Production site key for www.rnwolf.net
- **Monitoring**: Cloudflare Analytics and custom metrics

**Production Deployment Process:**
```bash
# Deploy to production
npx wrangler deploy --env production

# Verify deployment
npm run test:smoke:production
```

## API Versioning & Lifecycle Management

### Current API Version Status

**v1 (Current Production)**:
- **Status**: ✅ Active & Stable
- **Endpoints**: 
  - `POST /v1/newsletter/subscribe`
  - `GET /v1/newsletter/unsubscribe`
- **Clients**: www.rnwolf.net frontend
- **Database Schema**: Original schema
- **Deprecation**: None planned

### API Version Lifecycle

#### Phase 1: Development & Testing
```
v2 Development → Staging Testing → Contract Validation
```
1. **Local Development**: New v2 endpoints developed using TDD
2. **Staging Deployment**: v2 deployed alongside v1 on staging
3. **Contract Testing**: Validate v2 API contracts
4. **Performance Testing**: Ensure v2 meets performance requirements

#### Phase 2: Production Deployment (Parallel Versions)
```
v1 (Stable) + v2 (New) → Both Active in Production
```
1. **Deploy v2 to Production**: New endpoints available but not used
2. **Monitoring Setup**: Track v2 usage and errors
3. **Gradual Migration**: Frontend updated to use v2 endpoints
4. **Parallel Operation**: Both v1 and v2 serve traffic

#### Phase 3: Migration & Deprecation
```
v1 (Deprecated) → v2 (Primary) → v1 (Retired)
```
1. **Deprecation Notice**: v1 marked as deprecated with sunset date
2. **Client Migration**: All clients moved to v2
3. **Grace Period**: v1 maintained for backward compatibility
4. **Retirement**: v1 endpoints removed

### Version Management Strategy

#### Backward Compatibility Rules
1. **Non-Breaking Changes**: Deploy to existing version
   - Adding optional fields
   - Adding new response fields
   - Improving error messages
   - Performance optimizations

2. **Breaking Changes**: Require new version
   - Changing request/response schemas
   - Removing fields
   - Changing validation rules
   - Modifying business logic significantly

#### Database Schema Versioning
```sql
-- v1 Schema (Current)
CREATE TABLE subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL,
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- v2 Schema (Future - if needed)
-- APPROACH 1: Single Table Evolution (Recommended)
ALTER TABLE subscribers ADD COLUMN subscription_preferences TEXT; -- JSON field
ALTER TABLE subscribers ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE subscribers ADD COLUMN verification_token TEXT;

-- APPROACH 2: Separate Tables (Only for major structural changes)
CREATE TABLE subscribers_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL,
    subscription_preferences TEXT, -- JSON field for v2 features
    email_verified BOOLEAN DEFAULT FALSE,
    verification_token TEXT,
    -- Maintain compatibility with v1
    ip_address TEXT,
    user_agent TEXT,
    country TEXT,
    city TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    -- Migration tracking
    migrated_from_v1 BOOLEAN DEFAULT FALSE,
    migration_date DATETIME
);

-- Data synchronization table for cross-version updates
CREATE TABLE version_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL, -- 'subscribe', 'unsubscribe', 'update'
    api_version TEXT NOT NULL, -- 'v1', 'v2'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_snapshot TEXT, -- JSON snapshot of the change
    sync_status TEXT DEFAULT 'pending' -- 'pending', 'synced', 'failed'
);
```

## Database Schema Evolution & Data Synchronization

### Schema Change Deployment Strategy

#### Approach 1: Single Database Evolution (Recommended)

**Principle**: One database schema that evolves backward-compatibly, supporting all API versions simultaneously.

**Benefits**:
- No data synchronization issues
- Single source of truth
- Simplified data consistency
- Easier rollbacks

**Schema Evolution Rules**:
1. **Additive Changes Only**: New columns, indexes, tables
2. **No Breaking Changes**: Never remove or rename existing columns used by active API versions
3. **Default Values**: All new columns must have sensible defaults
4. **Nullable Fields**: New columns should be nullable or have defaults

**Example Evolution Path**:
```sql
-- Phase 1: v1 in production
CREATE TABLE subscribers (
    email TEXT UNIQUE NOT NULL,
    subscribed_at DATETIME NOT NULL,
    unsubscribed_at DATETIME NULL
    -- ... v1 fields
);

-- Phase 2: Preparing for v2 (backward compatible additions)
ALTER TABLE subscribers ADD COLUMN subscription_preferences TEXT DEFAULT '{}';
ALTER TABLE subscribers ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE subscribers ADD COLUMN verification_token TEXT DEFAULT NULL;

-- Phase 3: v2 deployed (both versions use same table)
-- v1 ignores new columns
-- v2 uses all columns

-- Phase 4: v1 retired (can now clean up unused columns if needed)
```

#### Approach 2: Multi-Database Strategy (High Complexity)

**When to Use**: Only for fundamental structural changes that cannot be made backward-compatible.

**Implementation**: Separate databases with real-time synchronization.

### Database Schema Change Deployment Process

#### Stage 1: Local Development with Schema Changes

```bash
# Create migration script
cat > migrations/002_add_v2_fields.sql << EOF
ALTER TABLE subscribers ADD COLUMN subscription_preferences TEXT DEFAULT '{}';
ALTER TABLE subscribers ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE subscribers ADD COLUMN verification_token TEXT DEFAULT NULL;

CREATE TABLE version_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL,
    api_version TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_snapshot TEXT,
    sync_status TEXT DEFAULT 'pending'
);
EOF

# Apply migration locally
npx wrangler d1 execute newsletter-db-local --file=./migrations/002_add_v2_fields.sql

# Test both v1 and v2 APIs against new schema
npm run test:v1:local
npm run test:v2:local
```

**Local Testing Checklist**:
- [ ] v1 API continues to work without changes
- [ ] v2 API can use new fields
- [ ] Migration is reversible
- [ ] No data loss in rollback scenario

#### Stage 2: Staging Environment Schema Migration

```bash
# Deploy schema changes to staging
npx wrangler d1 execute newsletter-db-staging --file=./migrations/002_add_v2_fields.sql

# Deploy workers with dual version support
npx wrangler deploy --env staging

# Run comprehensive testing
npm run test:schema:staging
npm run test:v1:staging
npm run test:v2:staging
```

**Staging Validation Process**:
1. **Backward Compatibility**: Ensure v1 API unaffected
2. **Forward Compatibility**: Validate v2 API functionality
3. **Data Integrity**: Verify no data corruption
4. **Performance Impact**: Check query performance with new schema
5. **Rollback Testing**: Verify ability to rollback schema changes

#### Stage 3: Production Schema Migration

**Blue-Green Database Strategy**:
```bash
# Step 1: Create backup of production database
npx wrangler d1 backup create newsletter-db-production

# Step 2: Apply schema migration during low-traffic window
npx wrangler d1 execute newsletter-db-production --file=./migrations/002_add_v2_fields.sql

# Step 3: Deploy new worker version
npx wrangler deploy --env production

# Step 4: Monitor for issues
npm run monitor:production:schema
```

### Data Synchronization Across API Versions

#### Single Database Approach (Recommended)

**Data Access Pattern**:
```typescript
// v1 API - ignores new v2 fields
interface V1Subscriber {
  email: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  ip_address: string;
  user_agent: string;
  country: string;
  city: string;
}

// v2 API - uses all fields including new ones
interface V2Subscriber extends V1Subscriber {
  subscription_preferences: string; // JSON
  email_verified: boolean;
  verification_token: string | null;
}

// Database operations maintain compatibility
class SubscriberService {
  // v1 operations
  async subscribeV1(email: string, metadata: V1Metadata): Promise<V1Subscriber> {
    return await this.db.prepare(`
      INSERT INTO subscribers (email, subscribed_at, ip_address, user_agent, country, city)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET 
        subscribed_at = ?,
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(email, now, metadata.ip, metadata.userAgent, metadata.country, metadata.city, now).first();
  }

  // v2 operations
  async subscribeV2(email: string, metadata: V2Metadata): Promise<V2Subscriber> {
    return await this.db.prepare(`
      INSERT INTO subscribers (email, subscribed_at, subscription_preferences, email_verified, ip_address, user_agent, country, city)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET 
        subscribed_at = ?,
        subscription_preferences = ?,
        email_verified = ?,
        unsubscribed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `).bind(email, now, JSON.stringify(metadata.preferences), false, metadata.ip, metadata.userAgent, metadata.country, metadata.city, now, JSON.stringify(metadata.preferences), false).first();
  }
}
```

#### Multi-Database Synchronization (Complex Scenario)

**When Required**: Fundamental schema incompatibilities between versions.

**Synchronization Architecture**:
```typescript
class CrossVersionSyncService {
  async syncSubscriptionChange(email: string, action: 'subscribe' | 'unsubscribe', sourceVersion: 'v1' | 'v2', data: any) {
    // Log the change for audit trail
    await this.logVersionSync(email, action, sourceVersion, data);
    
    if (sourceVersion === 'v1') {
      // Sync v1 change to v2 database
      await this.syncV1ToV2(email, action, data);
    } else {
      // Sync v2 change to v1 database  
      await this.syncV2ToV1(email, action, data);
    }
  }

  private async syncV1ToV2(email: string, action: string, v1Data: V1Subscriber) {
    try {
      if (action === 'subscribe') {
        await this.v2DB.prepare(`
          INSERT INTO subscribers_v2 (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city, migrated_from_v1)
          VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
          ON CONFLICT(email) DO UPDATE SET 
            subscribed_at = ?,
            unsubscribed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).bind(email, v1Data.subscribed_at, v1Data.unsubscribed_at, v1Data.ip_address, v1Data.user_agent, v1Data.country, v1Data.city, v1Data.subscribed_at).run();
      } else if (action === 'unsubscribe') {
        await this.v2DB.prepare(`
          UPDATE subscribers_v2 SET unsubscribed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?
        `).bind(v1Data.unsubscribed_at, email).run();
      }
      
      // Mark sync as completed
      await this.updateSyncStatus(email, 'synced');
    } catch (error) {
      await this.updateSyncStatus(email, 'failed');
      throw error;
    }
  }

  private async syncV2ToV1(email: string, action: string, v2Data: V2Subscriber) {
    try {
      // Map v2 data to v1 compatible format
      const v1CompatData = {
        email: v2Data.email,
        subscribed_at: v2Data.subscribed_at,
        unsubscribed_at: v2Data.unsubscribed_at,
        ip_address: v2Data.ip_address,
        user_agent: v2Data.user_agent,
        country: v2Data.country,
        city: v2Data.city
      };

      if (action === 'subscribe') {
        await this.v1DB.prepare(`
          INSERT INTO subscribers (email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(email) DO UPDATE SET 
            subscribed_at = ?,
            unsubscribed_at = NULL,
            updated_at = CURRENT_TIMESTAMP
        `).bind(...Object.values(v1CompatData), v2Data.subscribed_at).run();
      } else if (action === 'unsubscribe') {
        await this.v1DB.prepare(`
          UPDATE subscribers SET unsubscribed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?
        `).bind(v2Data.unsubscribed_at, email).run();
      }

      await this.updateSyncStatus(email, 'synced');
    } catch (error) {
      await this.updateSyncStatus(email, 'failed');
      throw error;
    }
  }

  private async logVersionSync(email: string, action: string, apiVersion: string, data: any) {
    await this.syncLogDB.prepare(`
      INSERT INTO version_sync_log (email, action, api_version, data_snapshot)
      VALUES (?, ?, ?, ?)
    `).bind(email, action, apiVersion, JSON.stringify(data)).run();
  }
}
```

### Data Consistency Strategies

#### 1. Eventual Consistency Model
- Changes propagate asynchronously between versions
- Temporary inconsistency acceptable
- Background sync processes ensure convergence

#### 2. Strong Consistency Model  
- All changes must be atomic across versions
- Higher latency but guaranteed consistency
- Use database transactions spanning multiple schemas

#### 3. Conflict Resolution
```typescript
class ConflictResolver {
  async resolveSubscriptionConflict(email: string) {
    const v1Record = await this.getV1Subscriber(email);
    const v2Record = await this.getV2Subscriber(email);

    // Resolution strategy: Last-write-wins based on updated_at
    const mostRecent = v1Record.updated_at > v2Record.updated_at ? v1Record : v2Record;
    
    // Sync the most recent state to both versions
    await this.syncToAllVersions(email, mostRecent);
  }
}
```

### Rollback Strategy for Schema Changes

#### Emergency Schema Rollback
```bash
# Step 1: Rollback worker deployment
npx wrangler rollback --env production

# Step 2: Database rollback (if safe)
npx wrangler d1 restore newsletter-db-production --backup-id=BACKUP_ID

# Step 3: Verify data integrity
npm run verify:production:data
```

#### Safe Rollback Principles
1. **Never drop columns** used by any active API version
2. **Maintain backward compatibility** in all schema changes  
3. **Test rollback procedures** in staging environment
4. **Keep recent backups** before any schema migration

### Monitoring Cross-Version Data Sync

#### Key Metrics
- **Sync Lag**: Time between version updates
- **Sync Failures**: Failed synchronization attempts
- **Data Divergence**: Inconsistencies between versions
- **Conflict Rate**: Frequency of data conflicts

#### Alerting Thresholds
- Sync lag > 5 minutes
- Sync failure rate > 1%
- Data divergence detected
- Unresolved conflicts > 10

### Recommended Approach for Newsletter Service: Single Database Evolution

**DECISION: We are using the Single Database Evolution approach for our newsletter subscription service.**

**For our newsletter subscription service, we will use the Single Database Evolution approach because:**

1. **Simple Data Model**: Subscriber data is relatively simple
2. **Low Conflict Risk**: Newsletter subscriptions rarely have complex conflicts
3. **Easier Maintenance**: Single source of truth reduces complexity
4. **Performance**: No cross-database synchronization overhead

**Implementation Strategy**:
- Use additive schema changes only
- Both API versions share the same database table
- v1 ignores new v2 fields
- v2 can read/write all fields including legacy v1 fields
- Retire v1 only after all clients migrated

**This approach eliminates all data synchronization complexity and ensures that subscription changes made through any API version are immediately visible to all other versions.**

### Wrangler Configuration Structure

**wrangler.jsonc** (Multi-environment setup):
```jsonc
{
  "name": "newsletter-api",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  
  "env": {
    "staging": {
      "name": "newsletter-api-staging",
      "routes": [
        { "pattern": "api-staging.yourdomain.com/v1/*", "zone_name": "yourdomain.com" },
        { "pattern": "api-staging.yourdomain.com/v2/*", "zone_name": "yourdomain.com" }
      ],
      "d1_databases": [
        { "binding": "DB", "database_name": "newsletter-db-staging", "database_id": "staging-db-id" }
      ],
      "vars": {
        "ENVIRONMENT": "staging",
        "API_VERSION": "v1"
      }
    },
    
    "production": {
      "name": "newsletter-api-production",
      "routes": [
        { "pattern": "api.yourdomain.com/v1/*", "zone_name": "yourdomain.com" },
        { "pattern": "api.yourdomain.com/v2/*", "zone_name": "yourdomain.com" }
      ],
      "d1_databases": [
        { "binding": "DB", "database_name": "newsletter-db-production", "database_id": "production-db-id" }
      ],
      "vars": {
        "ENVIRONMENT": "production",
        "API_VERSION": "v1"
      }
    }
  }
}
```

### CI/CD Pipeline (GitHub Actions Example)

```yaml
name: Newsletter API Deployment

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run test
      - run: npm run test:integration

  deploy-staging:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npx wrangler deploy --env staging
      - run: npm run test:smoke:staging

  deploy-production:
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      - run: npx wrangler deploy --env production
      - run: npm run test:smoke:production
```

## API Retirement Process

### Step-by-Step Retirement Workflow

#### 1. Deprecation Announcement (v1 → v2 transition)
```javascript
// Add deprecation headers to v1 responses
const deprecationHeaders = {
  'Sunset': 'Sat, 31 Dec 2025 23:59:59 GMT',
  'Deprecation': 'true',
  'Link': '</v2/newsletter/subscribe>; rel="successor-version"'
};
```

#### 2. Migration Timeline
- **Month 1**: v2 deployed, v1 marked deprecated
- **Month 2-3**: Client migration period, both versions active
- **Month 4**: v1 endpoints return warnings but still function
- **Month 5**: v1 endpoints return errors, redirect to v2
- **Month 6**: v1 endpoints completely removed

#### 3. Monitoring & Metrics
```javascript
// Track version usage
analytics.track('api_version_usage', {
  version: 'v1',
  endpoint: '/newsletter/subscribe',
  deprecated: true
});
```

#### 4. Safe Retirement Checklist
- [ ] All known clients migrated to v2
- [ ] v1 usage below threshold (< 1% of traffic)
- [ ] No critical v1 errors in past 30 days
- [ ] Rollback plan documented
- [ ] Stakeholder approval obtained

## Monitoring & Observability

### Key Metrics to Track
1. **Version Distribution**: Traffic split between API versions
2. **Error Rates**: Per version error rates and types
3. **Performance**: Response times for each version
4. **Migration Progress**: Clients moving from old to new versions

### Alerting Strategy
- **High Error Rate**: > 5% errors on any version
- **Performance Degradation**: > 2s response time
- **Failed Deployments**: Deployment health checks fail
- **Database Issues**: D1 connection or query failures

## Rollback Strategy

### Emergency Rollback Process
1. **Immediate**: Route traffic back to previous version
2. **Database**: Restore from backup if schema changes involved
3. **Client Communication**: Notify affected clients
4. **Root Cause**: Investigate and document issues

### Rollback Commands
```bash
# Emergency rollback to previous deployment
npx wrangler rollback --env production

# Route traffic to stable version
# (Update routes in wrangler.jsonc to point to stable version)
```

## Development Workflow Summary

### Daily Development Cycle
1. **Local TDD**: Write tests, implement features, verify locally
2. **Staging Deploy**: Push to staging for integration testing
3. **Production Deploy**: Deploy stable code to production

### Version Release Cycle
1. **Plan**: Define breaking changes requiring new version
2. **Develop**: Implement new version using TDD
3. **Test**: Comprehensive testing on staging
4. **Deploy**: Parallel deployment with monitoring
5. **Migrate**: Gradual client migration
6. **Retire**: Safe retirement of old version

This SDLC ensures safe, reliable deployments while maintaining API version compatibility and providing clear migration paths for clients.