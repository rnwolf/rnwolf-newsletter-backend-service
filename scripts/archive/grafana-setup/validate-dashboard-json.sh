#!/bin/bash
# validate-dashboard-json.sh - Validate JSON files in the project

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRAFANA_DIR="$PROJECT_DIR/grafana"

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

validate_json_file() {
    local file="$1"
    local filename=$(basename "$file")

    echo "Validating $filename..."

    if [[ ! -f "$file" ]]; then
        print_error "$filename: File not found"
        return 1
    fi

    # Check if file is valid JSON
    if python3 -m json.tool "$file" > /dev/null 2>&1; then
        print_success "$filename: Valid JSON"
        return 0
    else
        print_error "$filename: Invalid JSON"

        # Try to show the error details
        echo "Error details:"
        python3 -m json.tool "$file" 2>&1 | head -5
        return 1
    fi
}

main() {
    echo "JSON Validation for Newsletter Backend Service"
    echo "============================================="
    echo ""

    local files=(
        "$GRAFANA_DIR/grafana-dashboard-config_staging.json"
        "$GRAFANA_DIR/grafana-dashboard-config_production.json"
        "$GRAFANA_DIR/grafana-datasources.yml"
    )

    local errors=0

    for file in "${files[@]}"; do
        if [[ "$file" == *.json ]]; then
            if ! validate_json_file "$file"; then
                ((errors++))
            fi
        elif [[ "$file" == *.yml || "$file" == *.yaml ]]; then
            # For YAML files, just check if they exist
            if [[ -f "$file" ]]; then
                print_success "$(basename "$file"): File exists"
            else
                print_error "$(basename "$file"): File not found"
                ((errors++))
            fi
        fi
        echo ""
    done

    if [[ $errors -eq 0 ]]; then
        print_success "All configuration files are valid!"
        return 0
    else
        print_error "Found $errors validation error(s)"
        return 1
    fi
}

main "$@"