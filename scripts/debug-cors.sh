#!/bin/bash
# CORS Diagnostic Script for Newsletter API
# Save as: scripts/debug-cors.sh

set -e

STAGING_URL="https://api-staging.rnwolf.net"
PRODUCTION_URL="https://api.rnwolf.net"

echo "🔍 Newsletter API CORS Diagnostic"
echo "=================================="

# Function to test CORS
test_cors() {
    local url=$1
    local env_name=$2
    
    echo ""
    echo "Testing $env_name environment: $url"
    echo "-----------------------------------"
    
    # Test 1: OPTIONS preflight request (what browsers send first)
    echo "1. Testing OPTIONS preflight request..."
    local options_response=$(curl -s -w "HTTP_STATUS:%{http_code}\n" \
        -X OPTIONS \
        -H "Origin: https://www.rnwolf.net" \
        -H "Access-Control-Request-Method: POST" \
        -H "Access-Control-Request-Headers: Content-Type" \
        "$url/v1/newsletter/subscribe")
    
    local options_status=$(echo "$options_response" | grep "HTTP_STATUS:" | cut -d: -f2)
    echo "   Status: $options_status"
    
    if [ "$options_status" = "200" ]; then
        echo "   ✅ OPTIONS request successful"
        echo "   Headers received:"
        curl -s -I -X OPTIONS \
            -H "Origin: https://www.rnwolf.net" \
            -H "Access-Control-Request-Method: POST" \
            -H "Access-Control-Request-Headers: Content-Type" \
            "$url/v1/newsletter/subscribe" | grep -E "(Access-Control|Allow)"
    else
        echo "   ❌ OPTIONS request failed (Status: $options_status)"
        echo "   This could be why your staging test is failing!"
    fi
    
    # Test 2: POST request without Origin header
    echo ""
    echo "2. Testing POST without Origin header..."
    local post_no_origin=$(curl -s -w "HTTP_STATUS:%{http_code}\n" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"email":"test@example.com","turnstileToken":"test"}' \
        "$url/v1/newsletter/subscribe")
    
    local post_no_origin_status=$(echo "$post_no_origin" | grep "HTTP_STATUS:" | cut -d: -f2)
    echo "   Status: $post_no_origin_status"
    
    # Test 3: POST request with correct Origin header
    echo ""
    echo "3. Testing POST with correct Origin header..."
    local post_with_origin=$(curl -s -w "HTTP_STATUS:%{http_code}\n" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Origin: https://www.rnwolf.net" \
        -d '{"email":"test@example.com","turnstileToken":"test"}' \
        "$url/v1/newsletter/subscribe")
    
    local post_with_origin_status=$(echo "$post_with_origin" | grep "HTTP_STATUS:" | cut -d: -f2)
    echo "   Status: $post_with_origin_status"
    
    if [ "$post_with_origin_status" = "200" ] || [ "$post_with_origin_status" = "400" ]; then
        echo "   ✅ POST request with Origin header accepted"
        echo "   (400 is expected due to Turnstile verification failure)"
    elif [ "$post_with_origin_status" = "403" ]; then
        echo "   ❌ POST request forbidden - CORS issue!"
    else
        echo "   ⚠️  Unexpected status: $post_with_origin_status"
    fi
    
    # Test 4: POST request with wrong Origin header
    echo ""
    echo "4. Testing POST with wrong Origin header..."
    local post_wrong_origin=$(curl -s -w "HTTP_STATUS:%{http_code}\n" \
        -X POST \
        -H "Content-Type: application/json" \
        -H "Origin: https://evil-site.com" \
        -d '{"email":"test@example.com","turnstileToken":"test"}' \
        "$url/v1/newsletter/subscribe")
    
    local post_wrong_origin_status=$(echo "$post_wrong_origin" | grep "HTTP_STATUS:" | cut -d: -f2)
    echo "   Status: $post_wrong_origin_status"
    
    if [ "$post_wrong_origin_status" = "403" ]; then
        echo "   ✅ Correctly blocked wrong origin"
    else
        echo "   ⚠️  Expected 403 for wrong origin, got: $post_wrong_origin_status"
    fi
    
    # Test 5: Health endpoint (should always work)
    echo ""
    echo "5. Testing health endpoint..."
    local health_response=$(curl -s -w "HTTP_STATUS:%{http_code}\n" "$url/health")
    local health_status=$(echo "$health_response" | grep "HTTP_STATUS:" | cut -d: -f2)
    echo "   Status: $health_status"
    
    if [ "$health_status" = "200" ]; then
        echo "   ✅ Health endpoint working"
    else
        echo "   ❌ Health endpoint failing - deployment issue!"
    fi
}

# Test staging environment
test_cors "$STAGING_URL" "STAGING"

# Test production environment (light testing only)
test_cors "$PRODUCTION_URL" "PRODUCTION"

echo ""
echo "🎯 CORS Diagnostic Summary"
echo "=========================="
echo "If your staging test is failing with 403:"
echo "1. ❌ OPTIONS request failing → Your worker might not handle OPTIONS properly"
echo "2. ❌ POST with Origin failing → Your CORS configuration is too restrictive"
echo "3. ✅ POST without Origin working → Missing Origin header in test"
echo ""
echo "💡 Quick fixes:"
echo "1. Add 'Origin: https://www.rnwolf.net' header to staging tests"
echo "2. Check that your worker properly handles OPTIONS requests"
echo "3. Verify CORS headers are returned in all responses"
echo ""
echo "🔧 To fix your test, update makeRequest() to include:"
echo "   headers: { 'Origin': 'https://www.rnwolf.net' }"