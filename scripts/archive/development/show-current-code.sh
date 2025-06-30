#!/bin/bash

# Script: show-current-code.sh
# Purpose: Display the current source code to help identify what needs to be changed
# Usage: ./scripts/show-current-code.sh [filename]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

FILENAME=${1:-}

echo -e "${BLUE}Current Source Code Display${NC}"
echo -e "${BLUE}=========================${NC}"
echo ""

# If filename provided, show that specific file
if [ ! -z "$FILENAME" ]; then
    if [ -f "$FILENAME" ]; then
        echo -e "${GREEN}📄 Contents of: $FILENAME${NC}"
        echo -e "${CYAN}$(printf '=%.0s' {1..60})${NC}"
        cat -n "$FILENAME"
        echo ""
        echo -e "${CYAN}$(printf '=%.0s' {1..60})${NC}"
    else
        echo -e "${RED}✗${NC} File not found: $FILENAME"
        exit 1
    fi
    exit 0
fi

# Otherwise, show all files in src directory
if [ ! -d "src" ]; then
    echo -e "${RED}✗${NC} src directory not found!"
    echo "Available directories:"
    ls -la | grep '^d' | sed 's/^/  /'
    exit 1
fi

echo -e "${GREEN}📁 src/ directory contents:${NC}"
echo ""

# List all TypeScript/JavaScript files
find src -type f \( -name "*.ts" -o -name "*.js" \) | sort | while read file; do
    echo -e "${YELLOW}📄 $file${NC} ($(wc -l < "$file") lines)"
done

echo ""
echo -e "${CYAN}Choose a file to display:${NC}"
echo "1. Show src/index.ts (if exists)"
echo "2. Show all files with subscription-related content"
echo "3. Show main worker file"
echo ""

# Auto-detect and show the most likely main file
MAIN_FILE=""

if [ -f "src/index.ts" ]; then
    MAIN_FILE="src/index.ts"
    echo -e "${GREEN}🎯 Detected main file: $MAIN_FILE${NC}"
elif [ -f "src/index.js" ]; then
    MAIN_FILE="src/index.js"
    echo -e "${GREEN}🎯 Detected main file: $MAIN_FILE${NC}"
elif [ -f "src/worker.ts" ]; then
    MAIN_FILE="src/worker.ts"
    echo -e "${GREEN}🎯 Detected main file: $MAIN_FILE${NC}"
else
    # Find the largest TypeScript file
    MAIN_FILE=$(find src -name "*.ts" -exec wc -l {} + | sort -rn | head -1 | awk '{print $2}')
    if [ ! -z "$MAIN_FILE" ]; then
        echo -e "${YELLOW}🎯 Guessing main file (largest): $MAIN_FILE${NC}"
    fi
fi

if [ ! -z "$MAIN_FILE" ] && [ -f "$MAIN_FILE" ]; then
    echo ""
    echo -e "${BLUE}📖 Contents of main file: $MAIN_FILE${NC}"
    echo -e "${CYAN}$(printf '=%.0s' {1..80})${NC}"
    cat -n "$MAIN_FILE"
    echo ""
    echo -e "${CYAN}$(printf '=%.0s' {1..80})${NC}"

    echo ""
    echo -e "${YELLOW}🔍 Analysis of $MAIN_FILE:${NC}"

    # Check for subscription-related patterns
    if grep -q "Thank you for subscribing" "$MAIN_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Found current success message (needs to be changed)"
        grep -n "Thank you for subscribing" "$MAIN_FILE" | sed 's/^/  Line /'
    fi

    if grep -q "INSERT INTO subscribers" "$MAIN_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Found database INSERT (needs email verification fields)"
        grep -n -A3 -B1 "INSERT INTO subscribers" "$MAIN_FILE" | sed 's/^/  /'
    fi

    if grep -q "email_verified" "$MAIN_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Already has email_verified field - good!"
    else
        echo -e "${YELLOW}!${NC} Missing email_verified field - needs to be added"
    fi

    if grep -q "verification_token" "$MAIN_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Already has verification_token field - good!"
    else
        echo -e "${YELLOW}!${NC} Missing verification_token field - needs to be added"
    fi

    if grep -q "QUEUE" "$MAIN_FILE" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Found queue reference"
    else
        echo -e "${YELLOW}!${NC} Missing queue integration - needs to be added"
    fi

else
    echo -e "${RED}✗${NC} Could not determine main file"
    echo ""
    echo "Available files in src/:"
    find src -type f \( -name "*.ts" -o -name "*.js" \) | sort | sed 's/^/  📄 /'
    echo ""
    echo "To view a specific file:"
    echo -e "  ${YELLOW}./scripts/show-current-code.sh src/filename.ts${NC}"
fi

echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "=========="
echo "1. Review the main file content above"
echo "2. Look for the subscription handling logic"
echo "3. Identify what needs to be changed:"
echo "   • Change success message"
echo "   • Add email_verified = FALSE to database INSERT"
echo "   • Add verification_token generation"
echo "   • Add queue integration"
echo ""
echo "To view other files:"
echo -e "  ${YELLOW}./scripts/show-current-code.sh src/other-file.ts${NC}"