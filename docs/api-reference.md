# Newsletter Backend Service - API Reference

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Common Response Formats](#common-response-formats)
4. [Error Handling](#error-handling)
5. [Endpoints](#endpoints)
6. [Examples](#examples)
7. [Rate Limiting](#rate-limiting)
8. [CORS Policy](#cors-policy)

## Overview

The Newsletter Backend Service provides a RESTful API for managing newsletter subscriptions with double opt-in email verification. All endpoints return JSON responses unless otherwise specified.

### Base URLs

- **Production**: `https://api.rnwolf.net`
- **Staging**: `https://api-staging.rnwolf.net`
- **Local Development**: `http://localhost:8787`

### API Version

Current API version: `v1`

All endpoints are prefixed with `/v1/newsletter/` except for health and metrics endpoints.

## Authentication

### Public Endpoints
These endpoints are public and do not require authentication:
- Newsletter subscription (`POST /v1/newsletter/subscribe`)
- Email verification (`GET /v1/newsletter/verify`)
- Unsubscribe (`GET /v1/newsletter/unsubscribe`)
- Health checks (`GET /health`, `GET /`)

### Authenticated Endpoints
Metrics endpoints require Bearer token authentication:
- **Header**: `Authorization: Bearer <GRAFANA_API_KEY>`
- **Usage**: Monitoring and observability

## Common Response Formats

### Success Response
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {}
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information"
}
```

### HTML Responses
Email verification and unsubscribe endpoints return HTML pages for user-friendly confirmation.

## Error Handling

### HTTP Status Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Missing or invalid authentication |
| 404 | Not Found - Resource not found |
| 405 | Method Not Allowed - Invalid HTTP method |
| 500 | Internal Server Error - Server-side error |
| 503 | Service Unavailable - Temporary service issue |

### Error Response Examples

**Invalid Email Format**:
```json
{
  "success": false,
  "message": "Invalid email address"
}
```

**Missing Required Fields**:
```json
{
  "success": false,
  "message": "Email address is required"
}
```

**Database Error**:
```json
{
  "success": false,
  "message": "Our subscription service is temporarily unavailable. Please try again later."
}
```

## Endpoints

### 1. Newsletter Subscription

Subscribe a user to the newsletter with optional bot protection.

**Endpoint**: `POST /v1/newsletter/subscribe`

**Request Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "user@example.com",
  "turnstileToken": "optional-turnstile-token"
}
```

**Parameters**:
- `email` (string, required): Valid email address
- `turnstileToken` (string, optional): Cloudflare Turnstile token for bot protection

**Success Response** (200):
```json
{
  "success": true,
  "message": "Thank you for subscribing! Please check your email and click the verification link to complete your subscription."
}
```

**Error Responses**:
- **400**: Invalid email format or missing email
- **400**: Turnstile verification failed
- **500**: Database or service error

**Example Request**:
```bash
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "turnstileToken": "1x00000000000000000000AA"
  }'
```

### 2. Email Verification

Verify a user's email address using the verification link sent via email.

**Endpoint**: `GET /v1/newsletter/verify`

**Query Parameters**:
- `token` (string, required): Base64-encoded HMAC verification token
- `email` (string, required): Email address to verify

**Success Response** (200):
Returns HTML confirmation page with success message.

**Error Responses**:
- **400**: Missing or invalid token/email parameters
- **400**: Invalid or expired verification token
- **404**: Email address not found in subscription list
- **500**: Database error

**Example Request**:
```bash
curl "https://api.rnwolf.net/v1/newsletter/verify?token=eyJ0b2tlbiI6ImFiYzEyMyIsInRpbWVzdGFtcCI6IjE2MjM0NTY3ODkifQ&email=user@example.com"
```

### 3. Unsubscribe

Unsubscribe a user from the newsletter using a secure unsubscribe link.

**Endpoint**: `GET /v1/newsletter/unsubscribe`

**Query Parameters**:
- `token` (string, required): Base64-encoded HMAC unsubscribe token
- `email` (string, required): Email address to unsubscribe

**Success Response** (200):
Returns HTML confirmation page with unsubscribe confirmation.

**Error Responses**:
- **400**: Missing or invalid token/email parameters
- **400**: Invalid unsubscribe token
- **404**: Email address not found
- **500**: Database error

**Example Request**:
```bash
curl "https://api.rnwolf.net/v1/newsletter/unsubscribe?token=dGVzdC10b2tlbi1mb3ItdW5zdWJzY3JpYmU&email=user@example.com"
```

### 4. Health Check

Check the health and status of the newsletter service.

**Endpoint**: `GET /health` or `GET /`

**Success Response** (200):
```json
{
  "success": true,
  "message": "Newsletter API is running!",
  "database": "Connected",
  "environment": "production",
  "requestId": "req_1234567890_abcdef",
  "timestamp": "2024-06-30T18:00:00.000Z",
  "performance": {
    "database_response_time": 15
  }
}
```

**Error Response** (500):
```json
{
  "success": false,
  "message": "Database connection failed",
  "error": "Connection timeout",
  "requestId": "req_1234567890_abcdef"
}
```

### 5. Metrics (Authenticated)

Retrieve system metrics in Prometheus format for monitoring.

**Endpoint**: `GET /metrics`

**Authentication**: Required
```
Authorization: Bearer <GRAFANA_API_KEY>
```

**Success Response** (200):
```
# HELP up Whether the service is up
# TYPE up gauge
up{environment="production"} 1

# HELP newsletter_subscribers_total Total number of newsletter subscribers
# TYPE newsletter_subscribers_total gauge
newsletter_subscribers_total{environment="production"} 1250

# HELP newsletter_subscribers_active Number of active newsletter subscribers
# TYPE newsletter_subscribers_active gauge
newsletter_subscribers_active{environment="production"} 1180
```

**Error Responses**:
- **401**: Missing or invalid API key
- **500**: Metrics collection error

### 6. Metrics (JSON Format)

Retrieve metrics in JSON format for custom integrations.

**Endpoint**: `GET /metrics/json`

**Authentication**: Required

**Success Response** (200):
```json
{
  "timestamp": 1625097600000,
  "environment": "production",
  "database": {
    "newsletter_subscribers_total": 1250,
    "newsletter_subscribers_active": 1180,
    "newsletter_subscriptions_24h": 15,
    "newsletter_unsubscribes_24h": 2,
    "database_status": "connected"
  },
  "application": {
    "metrics": [],
    "traces": []
  },
  "system": {
    "worker_memory_used": 25600000,
    "worker_memory_total": 134217728,
    "uptime": 1625097600000
  }
}
```

### 7. Health Metrics

Detailed health information for monitoring systems.

**Endpoint**: `GET /metrics/health`

**Authentication**: Required

**Success Response** (200):
```json
{
  "overall_status": "healthy",
  "database": {
    "healthy": true,
    "response_time": 12
  },
  "application": {
    "healthy": true,
    "memory_usage": 0.19
  },
  "environment": "production",
  "timestamp": 1625097600000
}
```

## Examples

### Complete Subscription Flow

1. **Subscribe to Newsletter**:
```bash
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "newuser@example.com"}'
```

2. **User receives verification email and clicks link**:
```
https://api.rnwolf.net/v1/newsletter/verify?token=abc123&email=newuser@example.com
```

3. **User sees confirmation page** (HTML response)

### Unsubscribe Flow

1. **User clicks unsubscribe link from newsletter**:
```
https://api.rnwolf.net/v1/newsletter/unsubscribe?token=def456&email=user@example.com
```

2. **User sees unsubscribe confirmation page** (HTML response)

### Monitoring Integration

**Grafana Data Source Configuration**:
```bash
curl -H "Authorization: Bearer <GRAFANA_API_KEY>" \
  "https://api.rnwolf.net/metrics/api/v1/query?query=up"
```

## Rate Limiting

Currently, no explicit rate limiting is implemented at the application level. Rate limiting is handled by Cloudflare's edge network:

- **Cloudflare Protection**: DDoS protection and traffic filtering
- **Bot Protection**: Turnstile integration for subscription endpoint
- **Fair Usage**: Reasonable request limits enforced by Cloudflare

## CORS Policy

### Subscription Endpoint
- **Allowed Origins**: Environment-specific (configured via `CORS_ORIGIN`)
- **Methods**: `POST, OPTIONS`
- **Headers**: `Content-Type`

### Email Verification & Unsubscribe
- **Allowed Origins**: `*` (permissive for email client compatibility)
- **Methods**: `GET, OPTIONS`
- **Headers**: `Content-Type`

### Health Endpoints
- **Allowed Origins**: `*`
- **Methods**: `GET, OPTIONS`
- **Headers**: `Content-Type`

### Metrics Endpoints
- **Allowed Origins**: `*`
- **Methods**: `GET, OPTIONS`
- **Headers**: `Content-Type, Authorization`

## SDK and Integration Examples

### JavaScript/TypeScript

```typescript
class NewsletterAPI {
  constructor(private baseUrl: string) {}

  async subscribe(email: string, turnstileToken?: string) {
    const response = await fetch(`${this.baseUrl}/v1/newsletter/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, turnstileToken })
    });
    return response.json();
  }

  async checkHealth() {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }
}

// Usage
const api = new NewsletterAPI('https://api.rnwolf.net');
const result = await api.subscribe('user@example.com');
```

### Python

```python
import requests

class NewsletterAPI:
    def __init__(self, base_url):
        self.base_url = base_url
    
    def subscribe(self, email, turnstile_token=None):
        data = {'email': email}
        if turnstile_token:
            data['turnstileToken'] = turnstile_token
        
        response = requests.post(
            f'{self.base_url}/v1/newsletter/subscribe',
            json=data
        )
        return response.json()
    
    def check_health(self):
        response = requests.get(f'{self.base_url}/health')
        return response.json()

# Usage
api = NewsletterAPI('https://api.rnwolf.net')
result = api.subscribe('user@example.com')
```

### cURL Scripts

**Subscription with Error Handling**:
```bash
#!/bin/bash
EMAIL="$1"
API_URL="https://api.rnwolf.net"

if [ -z "$EMAIL" ]; then
    echo "Usage: $0 <email>"
    exit 1
fi

response=$(curl -s -w "%{http_code}" -X POST "$API_URL/v1/newsletter/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$EMAIL\"}")

http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" -eq 200 ]; then
    echo "✓ Subscription successful"
    echo "$body" | jq -r '.message'
else
    echo "✗ Subscription failed (HTTP $http_code)"
    echo "$body" | jq -r '.message // .error // "Unknown error"'
fi
```

## Troubleshooting

### Common Issues

1. **CORS Errors**: Check `CORS_ORIGIN` environment variable configuration
2. **Email Not Received**: Check MailChannels integration and email filtering
3. **Token Validation Failures**: Verify HMAC secret key consistency
4. **Database Errors**: Check D1 database connectivity and schema

### Debug Endpoints

**Health Check with Detailed Info**:
```bash
curl -v https://api.rnwolf.net/health
```

**Metrics for System Status**:
```bash
curl -H "Authorization: Bearer <API_KEY>" \
  https://api.rnwolf.net/metrics/health
```

For more troubleshooting information, see the [Troubleshooting Guide](troubleshooting-guide.md).

## Related Documentation

- **[Architecture Overview](architecture-overview.md)**: System design and components
- **[Testing Guide](testing-guide.md)**: API testing procedures
- **[Deployment Guide](newsletter_backend_deployment.md)**: Environment setup
- **[Troubleshooting Guide](troubleshooting-guide.md)**: Common issues and solutions