# Newsletter Backend Service - Architecture Overview

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Principles](#architecture-principles)
3. [C4 Model Documentation](#c4-model-documentation)
4. [Technology Stack](#technology-stack)
5. [Key Components](#key-components)
6. [Data Flow](#data-flow)
7. [Security Architecture](#security-architecture)
8. [Observability & Monitoring](#observability--monitoring)
9. [Deployment Architecture](#deployment-architecture)

## System Overview

The Newsletter Backend Service is a serverless, cloud-native application built on Cloudflare Workers that provides a complete newsletter subscription system with double opt-in email verification, unsubscribe management, and comprehensive observability.

### Core Capabilities

- **Newsletter Subscription**: Secure subscription with bot protection
- **Email Verification**: Double opt-in verification workflow
- **Unsubscribe Management**: One-click unsubscribe functionality
- **Metrics & Monitoring**: Prometheus-compatible metrics with Grafana dashboards
- **Newsletter Distribution**: Subscriber list management for external newsletter tools

## Architecture Principles

### 1. **Serverless-First**
- Built entirely on Cloudflare Workers for global edge deployment
- No server management or scaling concerns
- Pay-per-request pricing model

### 2. **Security by Design**
- HMAC token verification for all sensitive operations
- Bot protection using Cloudflare Turnstile
- PII protection with email masking in logs
- Environment-specific CORS policies

### 3. **Observability-Driven**
- Comprehensive metrics collection using OpenTelemetry patterns
- Prometheus-compatible metrics endpoint
- Distributed tracing for request flows
- Health checks and performance monitoring

### 4. **Test-Driven Development**
- Comprehensive test suite covering unit, integration, and smoke tests
- Environment-specific testing (local, staging, production)
- TDD approach for all new features

## C4 Model Documentation

The system architecture is documented using the C4 model, providing views at different levels of abstraction:

### Level 1: System Context
![System Context](c4/c4_system_context.mermaid)

**Purpose**: Shows how the newsletter system fits into the broader ecosystem and interacts with external users and systems.

**Key Interactions**:
- Users subscribe via website forms
- Cloudflare Turnstile provides bot protection
- MailChannels delivers emails
- Grafana monitors system health
- Newsletter sender script distributes newsletters

### Level 2: Container View
![Container View](c4/c4_container_view.mermaid)

**Purpose**: Shows the high-level technology choices and how responsibilities are distributed across containers.

**Key Containers**:
- **Newsletter API Worker**: Main HTTP request handler
- **Email Verification Worker**: Async email processing
- **Metrics Handler**: Observability endpoints
- **D1 Database**: Subscriber data storage
- **Email Verification Queue**: Async message processing

### Level 3: Component View
![Component View](c4/c4_component_view.mermaid)

**Purpose**: Shows the internal structure of the main API worker and how components interact.

**Key Components**:
- **HTTP Handlers**: Endpoint-specific request processing
- **Business Services**: Core application logic
- **External Clients**: Integration with external services
- **Email Worker Components**: Email processing pipeline

### Level 4: Code View
![Code View](c4/c4_code_view.mermaid)

**Purpose**: Shows the key functions and their relationships at the implementation level.

**Key Functions**:
- Subscription processing and validation
- Token generation and verification
- Database operations
- Metrics collection and formatting

## Technology Stack

### **Runtime & Platform**
- **Cloudflare Workers**: Serverless JavaScript runtime
- **TypeScript**: Type-safe development
- **Node.js Compatibility**: For crypto and other Node.js APIs

### **Data & Storage**
- **Cloudflare D1**: SQLite-based serverless database
- **Cloudflare Queues**: Message queue for async processing

### **External Services**
- **MailChannels API**: Email delivery service
- **Cloudflare Turnstile**: Bot protection
- **Grafana**: Monitoring and dashboards

### **Development & Testing**
- **Vitest**: Testing framework with Cloudflare Workers support
- **Wrangler**: Cloudflare Workers CLI and development tools
- **OpenTelemetry**: Observability and metrics collection

## Key Components

### 1. **Newsletter API Worker** (`src/index.ts`)
**Responsibilities**:
- HTTP request routing and handling
- CORS management
- Request validation and processing
- Observability data collection

**Key Endpoints**:
- `POST /v1/newsletter/subscribe` - Newsletter subscription
- `GET /v1/newsletter/verify` - Email verification
- `GET /v1/newsletter/unsubscribe` - Unsubscribe processing
- `GET /health` - Health checks
- `GET /metrics/*` - Observability endpoints

### 2. **Email Verification Worker** (`src/email-verification-worker.ts`)
**Responsibilities**:
- Queue message processing
- Email template generation
- MailChannels API integration
- Retry logic for failed emails

### 3. **Metrics Handler** (`src/metrics/metrics-handler.ts`)
**Responsibilities**:
- Prometheus API compatibility
- Database metrics collection
- Performance metrics aggregation
- Grafana integration

### 4. **Observability System** (`src/observability/otel.ts`)
**Responsibilities**:
- Metrics recording and aggregation
- Distributed tracing
- Performance monitoring
- Request correlation

## Data Flow

### Subscription Flow
1. **User submits form** → Newsletter API Worker
2. **Turnstile validation** → Cloudflare Turnstile
3. **Store unverified subscriber** → D1 Database
4. **Queue verification email** → Email Verification Queue
5. **Process email** → Email Verification Worker
6. **Send email** → MailChannels API
7. **Email delivered** → User's email client

### Verification Flow
1. **User clicks verification link** → Newsletter API Worker
2. **Token validation** → HMAC verification
3. **Update subscriber status** → D1 Database
4. **Return confirmation page** → User

### Unsubscribe Flow
1. **User clicks unsubscribe link** → Newsletter API Worker
2. **Token validation** → HMAC verification
3. **Update unsubscribe status** → D1 Database
4. **Return confirmation page** → User

### Monitoring Flow
1. **Grafana queries metrics** → Metrics Handler
2. **Collect database metrics** → D1 Database
3. **Format Prometheus data** → Grafana
4. **Health checks** → Newsletter API Worker

## Security Architecture

### **Authentication & Authorization**
- **Grafana API Key**: Protects metrics endpoints
- **HMAC Tokens**: Secure verification and unsubscribe links
- **Environment Isolation**: Separate secrets per environment

### **Input Validation**
- **Email Format Validation**: RFC-compliant email checking
- **Bot Protection**: Cloudflare Turnstile integration
- **Request Sanitization**: All inputs validated and sanitized

### **Data Protection**
- **PII Masking**: Email addresses masked in logs
- **Secure Token Generation**: Cryptographically secure HMAC tokens
- **Environment Secrets**: Sensitive data stored in Cloudflare Workers secrets

### **CORS Policy**
- **Restrictive by Default**: Only allowed origins for subscription
- **Permissive for Email Links**: Email clients need broad access
- **Environment-Specific**: Different policies per environment

## Observability & Monitoring

### **Metrics Collection**
- **HTTP Request Metrics**: Response times, status codes, error rates
- **Database Metrics**: Connection health, query performance
- **Business Metrics**: Subscription rates, verification rates
- **System Metrics**: Memory usage, error counts

### **Monitoring Stack**
- **Prometheus Format**: Industry-standard metrics format
- **Grafana Dashboards**: Visual monitoring and alerting
- **Health Checks**: Automated service health validation
- **Distributed Tracing**: Request flow tracking

### **Key Metrics**
- `newsletter_subscribers_total` - Total subscriber count
- `newsletter_subscribers_active` - Active subscriber count
- `newsletter_subscriptions_24h` - Recent subscription activity
- `http_requests_total` - HTTP request volume
- `database_status` - Database connectivity

## Deployment Architecture

### **Environment Strategy**
- **Local**: Development with in-memory database simulation
- **Staging**: Pre-production validation with real infrastructure
- **Production**: Live environment with full monitoring

### **Infrastructure as Code**
- **Wrangler Configuration**: `wrangler.jsonc` defines all environments
- **Database Migrations**: Versioned schema changes
- **Environment Variables**: Managed through Cloudflare dashboard

### **Deployment Pipeline**
1. **Local Development** → Unit and integration tests
2. **Staging Deployment** → Automated deployment validation
3. **Staging Tests** → Post-deployment health checks
4. **Production Deployment** → Blue-green deployment
5. **Production Validation** → Smoke tests and monitoring

### **Scaling & Performance**
- **Global Edge Deployment**: Cloudflare's global network
- **Automatic Scaling**: Workers scale to zero and handle traffic spikes
- **Database Scaling**: D1 handles read/write scaling automatically
- **Queue Processing**: Automatic scaling based on message volume

## Related Documentation

- **[Design Specification](newsletter_design_spec.md)**: Detailed system design and requirements
- **[Testing Guide](testing-guide.md)**: Comprehensive testing strategy and procedures
- **[Deployment Guide](newsletter_backend_deployment.md)**: Deployment procedures and environment setup
- **[Grafana Observability](grafana_metrics_observability.md)**: Monitoring and dashboard configuration

## Architecture Decision Records

### **Why Cloudflare Workers?**
- Global edge deployment for low latency
- Serverless scaling and cost model
- Integrated ecosystem (D1, Queues, Turnstile)
- No cold start issues

### **Why MailChannels?**
- Reliable email delivery service
- Good reputation and deliverability
- API-based integration
- Cost-effective for transactional emails

### **Why HMAC Tokens?**
- Cryptographically secure
- Stateless verification
- No database lookups required
- Time-based expiration support

### **Why Separate Workers?**
- Clear separation of concerns
- Independent scaling
- Easier testing and debugging
- Queue-based async processing

This architecture provides a robust, scalable, and maintainable newsletter service that can handle global traffic while maintaining high security and observability standards.