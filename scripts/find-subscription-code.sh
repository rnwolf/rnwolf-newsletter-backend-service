#!/bin/bash

# Script: find-subscription-code.sh
# Purpose: Find the current subscription implementation in your codebase
# Usage: ./scripts/find-subscription-code.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}Finding Current Subscription Implementation${NC}"
echo -e "${BLUE}=========================================${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}✗${NC} Not in project root directory (package.json not found)"
    exit 1
fi

echo -e "${CYAN}Searching for subscription-related code...${NC}"
echo ""

# Function to search for patterns and show results
search_pattern() {
    local pattern="$1"
    local description="$2"

    echo -e "${YELLOW}🔍 Searching for: $description${NC}"
    echo "Pattern: $pattern"
    echo ""

    # Search in TypeScript and JavaScript files
    local found=false

    # Search in src directory
    if [ -d "src" ]; then
        local results=$(find src -name "*.ts" -o -name "*.js" | xargs grep -l "$pattern" 2>/dev/null || true)
        if [ ! -z "$results" ]; then
            found=true
            echo -e "${GREEN}Found in:${NC}"
            for file in $results; do
                echo -e "  📄 $file"

                # Show the actual lines with context
                echo -e "${CYAN}    Context:${NC}"
                grep -n -B2 -A2 "$pattern" "$file" 2>/dev/null | sed 's/^/      /' || true
                echo ""
            done
        fi
    fi

    if [ "$found" = false ]; then
        echo -e "${YELLOW}  Not found${NC}"
    fi

    echo ""
}

# Search for key patterns
search_pattern "Thank you for subscribing" "Current success message"
search_pattern "monthly newsletter" "Newsletter reference"
search_pattern "storeSubscription" "storeSubscription function"
search_pattern "INSERT INTO subscribers" "Database insert operations"
search_pattern "ON CONFLICT.*email.*DO UPDATE" "Conflict handling for email"
search_pattern "/v1/newsletter/subscribe" "Subscription endpoint"
search_pattern "handleSubscription" "Subscription handler function"
search_pattern "newsletter.*subscribe" "General newsletter subscription"

echo -e "${CYAN}Checking src directory structure...${NC}"
echo ""

if [ -d "src" ]; then
    echo -e "${GREEN}src/ directory contents:${NC}"
    find src -type f -name "*.ts" -o -name "*.js" | sort | sed 's/^/  📄 /'
else
    echo -e "${RED}src/ directory not found!${NC}"
fi

echo ""
echo -e "${CYAN}Checking for main entry points...${NC}"
echo ""

# Check common entry point files
ENTRY_FILES=(
    "src/index.ts"
    "src/index.js"
    "src/worker.ts"
    "src/worker.js"
    "src/main.ts"
    "src/main.js"
)

for file in "${ENTRY_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} Found: $file"
        echo "  File size: $(wc -l < "$file") lines"

        # Check if it contains subscription logic
        if grep -q "subscribe\|newsletter" "$file" 2>/dev/null; then
            echo -e "  ${YELLOW}Contains subscription-related code${NC}"
        fi
    else
        echo -e "${YELLOW}○${NC} Not found: $file"
    fi
done

echo ""
echo -e "${CYAN}Checking wrangler.jsonc for entry point...${NC}"
echo ""

if [ -f "wrangler.jsonc" ]; then
    echo "Main entry from wrangler.jsonc:"
    grep -A1 -B1 '"main"' wrangler.jsonc || echo "No main field found"
elif [ -f "wrangler.toml" ]; then
    echo "Main entry from wrangler.toml:"
    grep -A1 -B1 'main' wrangler.toml || echo "No main field found"
else
    echo -e "${YELLOW}No wrangler config file found${NC}"
fi

echo ""
echo -e "${CYAN}Looking for function exports...${NC}"
echo ""

if [ -d "src" ]; then
    echo "Exported functions that might handle subscriptions:"
    find src -name "*.ts" -o -name "*.js" | xargs grep -n "export.*function\|export.*=\|export default" 2>/dev/null | grep -i "subscr\|newsletter\|handle" || echo "No matching exports found"
fi

echo ""
echo -e "${BLUE}Summary and Next Steps${NC}"
echo "====================="
echo ""

# Provide guidance based on what we found
if [ -d "src" ]; then
    if [ -f "src/index.ts" ]; then
        echo -e "${GREEN}✓${NC} src/index.ts exists - this is likely your main worker file"
        echo -e "   ${CYAN}Start here: Check src/index.ts for subscription logic${NC}"
    elif [ -f "src/index.js" ]; then
        echo -e "${GREEN}✓${NC} src/index.js exists - this is likely your main worker file"
        echo -e "   ${CYAN}Start here: Check src/index.js for subscription logic${NC}"
    else
        echo -e "${YELLOW}!${NC} No obvious main file found in src/"
        echo -e "   ${CYAN}Check the largest .ts file in src/ directory${NC}"
    fi

    echo ""
    echo "To examine a specific file in detail:"
    echo -e "   ${YELLOW}cat src/index.ts${NC}  # or whatever file you want to check"
    echo ""
    echo "To search for specific patterns in a file:"
    echo -e "   ${YELLOW}grep -n 'subscribers\\|newsletter' src/index.ts${NC}"

else
    echo -e "${RED}✗${NC} No src directory found!"
    echo -e "   Your code might be in a different location"
    echo -e "   Check: root directory, lib/, app/, or other folders"
fi

echo ""
echo -e "${YELLOW}If you find the subscription code, look for:${NC}"
echo "1. Database INSERT statements with 'subscribers' table"
echo "2. Response messages like 'Thank you for subscribing'"
echo "3. Functions that handle POST requests to subscription endpoints"
echo "4. CORS response creation functions"
