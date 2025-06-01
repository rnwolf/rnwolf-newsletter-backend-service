# Newsletter Backend Service - Repository Setup & Deployment Guide

## Repository Architecture Decision

**Creating a separate repository for the newsletter backend service is the correct approach because:**

1. **Separation of Concerns**: MkDocs static site vs. API backend service
2. **Independent Deployment**: Backend can be deployed without affecting the static site
3. **Different Technologies**: Static site generation vs. Cloudflare Workers runtime
4. **Team Collaboration**: Different teams can work on frontend/backend independently
5. **Version Control**: Backend API versioning independent of content updates

## Repository Structure

### New Repository: `newsletter-backend-service`

```
newsletter-backend-service/
├── .github/
│   └── workflows/
│       ├── test.yml
│       ├── deploy-staging.yml
│       └── deploy-production.yml
├── src/
│   ├── index.ts
│   ├── subscription-service.ts
│   ├── http-handler.ts
│   └── unsubscribe-service.ts (future)
├── tests/
│   ├── email-validation.test.ts
│   ├── turnstile-verification.test.ts
│   ├── database-operations.test.ts
│   ├── http-handling.test.ts
│   └── subscription-service.test.ts
├── migrations/
│   ├── 001_initial_schema.sql
│   └── 002_add_v2_fields.sql (future)
├── scripts/
│   ├── subscriber-fetcher.py
│   ├── newsletter-sender.py
│   └── deploy.sh
├── docs/
│   ├── api-specification.md
│   ├── deployment-guide.md
│   └── architecture.md
├── package.json
├── package-lock.json
├── wrangler.jsonc
├── vitest.config.ts
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

## Step-by-Step Repository Setup

### 1. Create New GitHub Repository

```bash
# Create new repository on GitHub
# Repository name: newsletter-backend-service
# Description: API backend service for newsletter subscription management
# Private/Public: Your choice
# Initialize with README: No (we'll create our own)
```

### 2. Clone and Initialize Local Repository

```bash
# Clone the empty repository
git clone https://github.com/yourusername/newsletter-backend-service.git
cd newsletter-backend-service

# Initialize the project structure
mkdir -p src tests migrations scripts docs .github/workflows

# Initialize Node.js project
npm init -y
```

### 3. Install Dependencies

```bash
# Production dependencies
npm install @cloudflare/workers-types

# Development dependencies
npm install -D \
  @cloudflare/vitest-pool-workers \
  vitest \
  typescript \
  @types/node \
  wrangler
```

### 4. Create Core Configuration Files

**package.json** (update scripts section):
```json
{
  "name": "newsletter-backend-service",
  "version": "1.0.0",
  "description": "API backend service for newsletter subscription management",
  "main": "src/index.ts",
  "scripts": {
    "dev": "wrangler dev --local",
    "dev:remote": "wrangler dev --remote",
    "deploy:staging": "wrangler deploy --env staging",
    "deploy:production": "wrangler deploy --env production",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:integration:staging": "ENVIRONMENT=staging vitest run tests/integration",
    "test:smoke:production": "ENVIRONMENT=production vitest run tests/smoke",
    "db:migrate:local": "wrangler d1 execute newsletter-db-local --file=./migrations/001_initial_schema.sql",
    "db:migrate:staging": "wrangler d1 execute newsletter-db-staging --file=./migrations/001_initial_schema.sql",
    "db:migrate:production": "wrangler d1 execute newsletter-db-production --file=./migrations/001_initial_schema.sql",
    "type-check": "tsc --noEmit",
    "lint": "echo 'Add linting when ready'"
  },
  "keywords": ["cloudflare-workers", "newsletter", "api", "d1", "turnstile"],
  "author": "Your Name",
  "license": "MIT"
}
```

**wrangler.jsonc**:
```jsonc
{
  "name": "newsletter-backend-service",
  "main": "src/index.ts",
  "compatibility_date": "2025-03-07",
  "compatibility_flags": ["nodejs_compat"],
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  },
  
  "env": {
    "local": {
      "name": "newsletter-backend-local",
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "newsletter-db-local",
          "database_id": "local-db-id"
        }
      ],
      "vars": {
        "ENVIRONMENT": "local",
        "API_VERSION": "v1"
      }
    },
    
    "staging": {
      "name": "newsletter-backend-staging",
      "routes": [
        {
          "pattern": "api-staging.yourdomain.com/v1/*",
          "zone_name": "yourdomain.com"
        }
      ],
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "newsletter-db-staging",
          "database_id": "staging-db-id-replace-me"
        }
      ],
      "vars": {
        "ENVIRONMENT": "staging",
        "API_VERSION": "v1"
      }
    },
    
    "production": {
      "name": "newsletter-backend-production",
      "routes": [
        {
          "pattern": "api.yourdomain.com/v1/*",
          "zone_name": "yourdomain.com"
        }
      ],
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "newsletter-db-production",
          "database_id": "production-db-id-replace-me"
        }
      ],
      "vars": {
        "ENVIRONMENT": "production",
        "API_VERSION": "v1"
      }
    }
  }
}
```

**tsconfig.json**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**vitest.config.ts**:
```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

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

**.env.example**:
```bash
# Cloudflare Configuration
CLOUDFLARE_ACCOUNT_ID=your_account_id_here
CLOUDFLARE_API_TOKEN=your_api_token_here

# Database IDs (replace in wrangler.jsonc)
STAGING_DB_ID=your_staging_db_id_here
PRODUCTION_DB_ID=your_production_db_id_here

# Secrets (set via wrangler secret put)
TURNSTILE_SECRET_KEY=your_turnstile_secret_key
HMAC_SECRET_KEY=your_hmac_secret_key_for_unsubscribe_tokens

# Newsletter Script Configuration
D1_DATABASE_ID=your_database_id
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
FROM_EMAIL=your_email@gmail.com
FROM_NAME=Your Newsletter Name
EMAILS_PER_MINUTE=10
```

**.gitignore**:
```
# Dependencies
node_modules/
.npm
.pnpm-debug.log*

# Environment variables
.env
.env.local
.env.production

# Build outputs
dist/
.wrangler/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Testing
coverage/

# Python (for newsletter scripts)
__pycache__/
*.pyc
*.pyo
*.pyd
.Python
.pytest_cache/

# Newsletter data
subscribers.csv
newsletter.log
```

### 5. Create Database Migration

**migrations/001_initial_schema.sql**:
```sql
-- Newsletter subscribers table
-- Using single database evolution approach
CREATE TABLE IF NOT EXISTS subscribers (
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at);
CREATE INDEX IF NOT EXISTS idx_subscription_status ON subscribers(subscribed_at, unsubscribed_at);

-- Version sync log for future multi-version support if needed
CREATE TABLE IF NOT EXISTS version_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL, -- 'subscribe', 'unsubscribe', 'update'
    api_version TEXT NOT NULL, -- 'v1', 'v2'
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    data_snapshot TEXT, -- JSON snapshot of the change
    sync_status TEXT DEFAULT 'pending' -- 'pending', 'synced', 'failed'
);

CREATE INDEX IF NOT EXISTS idx_sync_status ON version_sync_log(sync_status);
CREATE INDEX IF NOT EXISTS idx_sync_email ON version_sync_log(email);
```

### 6. Add Source Code

Copy the TDD-implemented code from the previous artifact into the `src/` directory:
- `src/index.ts`
- `src/subscription-service.ts`
- `src/http-handler.ts`

Copy the test files into the `tests/` directory:
- All test files from the TDD demonstration

### 7. Create CI/CD Pipeline

**.github/workflows/test.yml**:
```yaml
name: Run Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Type check
      run: npm run type-check
      
    - name: Run tests
      run: npm test
      
    - name: Upload test results
      uses: actions/upload-artifact@v4
      if: always()
      with:
        name: test-results
        path: coverage/
```

**.github/workflows/deploy-staging.yml**:
```yaml
name: Deploy to Staging

on:
  push:
    branches: [ main ]
  workflow_dispatch:

jobs:
  test:
    uses: ./.github/workflows/test.yml
    
  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Deploy to staging
      run: npm run deploy:staging
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        
    - name: Run integration tests
      run: npm run test:integration:staging
      env:
        STAGING_API_URL: https://api-staging.yourdomain.com
```

**.github/workflows/deploy-production.yml**:
```yaml
name: Deploy to Production

on:
  release:
    types: [published]
  workflow_dispatch:

jobs:
  test:
    uses: ./.github/workflows/test.yml
    
  deploy-staging:
    needs: test
    uses: ./.github/workflows/deploy-staging.yml
    secrets: inherit
    
  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    
    steps:
    - name: Checkout code
      uses: actions/checkout@v4
      
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Deploy to production
      run: npm run deploy:production
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        
    - name: Run smoke tests
      run: npm run test:smoke:production
      env:
        PRODUCTION_API_URL: https://api.yourdomain.com
```

## Deployment Verification Process

### Step 1: Local Development Verification

```bash
# 1. Create local D1 database
npx wrangler d1 create newsletter-db-local

# 2. Update wrangler.jsonc with the database ID
# Copy the database ID from the command output

# 3. Run database migration
npm run db:migrate:local

# 4. Start local development server
npm run dev

# 5. Test the subscription endpoint
curl -X POST http://localhost:8787/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.rnwolf.net" \
  -d '{
    "email": "test@example.com",
    "turnstileToken": "test-token"
  }'

# 6. Run all tests
npm test
```

### Step 2: Staging Environment Verification

```bash
# 1. Create staging D1 database
npx wrangler d1 create newsletter-db-staging

# 2. Update wrangler.jsonc with staging database ID

# 3. Set up secrets for staging
npx wrangler secret put TURNSTILE_SECRET_KEY --env staging
npx wrangler secret put HMAC_SECRET_KEY --env staging

# 4. Run database migration
npm run db:migrate:staging

# 5. Deploy to staging
npm run deploy:staging

# 6. Test staging endpoint
curl -X POST https://api-staging.yourdomain.com/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -H "Origin: https://www.rnwolf.net" \
  -d '{
    "email": "staging-test@example.com",
    "turnstileToken": "real-turnstile-token"
  }'

# 7. Run integration tests
npm run test:integration:staging
```

### Step 3: Production Deployment Verification

```bash
# 1. Create production D1 database
npx wrangler d1 create newsletter-db-production

# 2. Update wrangler.jsonc with production database ID

# 3. Set up secrets for production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put HMAC_SECRET_KEY --env production

# 4. Run database migration
npm run db:migrate:production

# 5. Deploy to production
npm run deploy:production

# 6. Run smoke tests
npm run test:smoke:production
```

### Step 4: DNS Configuration

Configure DNS records for your API subdomains:

```
# Staging
api-staging.yourdomain.com CNAME yourworkername.yourdomain.workers.dev

# Production  
api.yourdomain.com CNAME yourworkername.yourdomain.workers.dev
```

## README.md Template

**README.md**:
```markdown
# Newsletter Backend Service

API backend service for newsletter subscription management, built with Cloudflare Workers, D1, and Turnstile.

## Architecture

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Bot Protection**: Cloudflare Turnstile
- **Development**: Test-Driven Development (TDD)
- **API Versioning**: Single database evolution approach

## Features

- ✅ Email subscription with validation
- ✅ Bot protection via Turnstile
- ✅ Duplicate subscription handling
- ✅ CORS protection
- ✅ Comprehensive error handling
- ✅ Metadata collection (IP, User-Agent, Country)
- ✅ Unsubscribe token generation
- 🚧 Email unsubscribe endpoint (coming soon)

## API Endpoints

### Subscribe to Newsletter
```
POST https://api.yourdomain.com/v1/newsletter/subscribe
Content-Type: application/json
Origin: https://www.rnwolf.net

{
  "email": "user@example.com",
  "turnstileToken": "turnstile-response-token"
}
```

## Development

### Prerequisites
- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Setup
```bash
git clone https://github.com/yourusername/newsletter-backend-service.git
cd newsletter-backend-service
npm install
cp .env.example .env
# Fill in your configuration in .env
```

### Local Development
```bash
npm run dev
npm test
```

### Deployment
```bash
npm run deploy:staging
npm run deploy:production
```

## Testing

The project uses Test-Driven Development with comprehensive test coverage:

- **Email Validation Tests**
- **Turnstile Verification Tests**  
- **Database Operations Tests**
- **HTTP Handling Tests**
- **Integration Tests**

Run tests: `npm test`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests first (TDD)
4. Implement the feature
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License
```

This repository structure and deployment process gives you:

1. **Clean Architecture**: Separated from MkDocs static site
2. **Production-Ready**: CI/CD pipeline with proper testing
3. **Scalable**: Can add more API endpoints and versions
4. **Verifiable**: Step-by-step deployment verification
5. **Maintainable**: TDD approach with comprehensive testing

Ready to create this repository and verify the deployment process?
