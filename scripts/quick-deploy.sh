#!/bin/bash

# Quick deployment commands for Newsletter Backend Service
# These provide convenient shortcuts for common deployment scenarios

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_usage() {
    echo -e "${BLUE}Newsletter Backend Service - Quick Deploy Commands${NC}"
    echo ""
    echo "Available commands:"
    echo "  dev              Start local development server"
    echo "  test             Run full test suite locally"
    echo "  staging          Deploy to staging with full tests"
    echo "  staging-quick    Deploy to staging, skip tests"
    echo "  production       Deploy to production with confirmations"
    echo "  production-force Deploy to production without confirmations"
    echo "  cleanup          Clean up test data from production"
    echo "  rollback         Rollback last deployment"
    echo "  status           Check deployment status"
    echo "  logs             View deployment logs"
    echo ""
    echo "Examples:"
    echo "  $0 staging"
    echo "  $0 production"
    echo "  $0 cleanup"
    echo ""
}

# Function to start local development
dev() {
    echo -e "${BLUE}🚀 Starting local development server...${NC}"
    npm run dev
}

# Function to run tests
test() {
    echo -e "${BLUE}🧪 Running full test suite...${NC}"
    npm run test:local
}

# Function to deploy to staging
staging() {
    echo -e "${BLUE}📦 Deploying to staging...${NC}"
    "$DEPLOY_SCRIPT" staging
}

# Function to deploy to staging quickly
staging_quick() {
    echo -e "${YELLOW}⚡ Quick staging deployment (skipping tests)...${NC}"
    "$DEPLOY_SCRIPT" staging --skip-tests
}

# Function to deploy to production
production() {
    echo -e "${GREEN}🌟 Deploying to production...${NC}"
    "$DEPLOY_SCRIPT" production
}

# Function to force deploy to production
production_force() {
    echo -e "${YELLOW}🌟 Force deploying to production...${NC}"
    "$DEPLOY_SCRIPT" production --force
}

# Function to cleanup test data
cleanup() {
    echo -e "${BLUE}🧹 Cleaning up test data...${NC}"
    "$DEPLOY_SCRIPT" production --cleanup-only
}

# Function to rollback deployment
rollback() {
    local env=${1:-production}
    echo -e "${YELLOW}⏪ Rolling back $env deployment...${NC}"
    
    echo "Available environments: staging, production"
    if [[ -z "$1" ]]; then
        read -p "Which environment to rollback? (staging/production): " env
    fi
    
    case $env in
        staging|production)
            npx wrangler rollback --env "$env"
            ;;
        *)
            echo "Invalid environment: $env"
            exit 1
            ;;
    esac
}

# Function to check deployment status
status() {
    echo -e "${BLUE}📊 Checking deployment status...${NC}"
    
    echo ""
    echo "=== Staging Status ==="
    if curl -s https://api-staging.rnwolf.net/health | jq . 2>/dev/null; then
        echo -e "${GREEN}✅ Staging is healthy${NC}"
    else
        echo -e "${YELLOW}⚠️  Staging health check failed${NC}"
    fi
    
    echo ""
    echo "=== Production Status ==="
    if curl -s https://api.rnwolf.net/health | jq . 2>/dev/null; then
        echo -e "${GREEN}✅ Production is healthy${NC}"
    else
        echo -e "${YELLOW}⚠️  Production health check failed${NC}"
    fi
    
    echo ""
    echo "=== Recent Deployments ==="
    npx wrangler deployments list --env production 2>/dev/null | head -10 || echo "Unable to fetch deployment history"
}

# Function to view logs
logs() {
    local env=${1:-production}
    echo -e "${BLUE}📋 Viewing $env logs...${NC}"
    
    if [[ -z "$1" ]]; then
        read -p "Which environment logs? (staging/production): " env
    fi
    
    case $env in
        staging|production)
            npx wrangler tail --env "$env"
            ;;
        *)
            echo "Invalid environment: $env"
            exit 1
            ;;
    esac
}

# Function to run smoke tests only
smoke() {
    echo -e "${BLUE}💨 Running smoke tests...${NC}"
    npm run test:smoke:production
}

# Function to show quick help
help() {
    print_usage
}

# Main command dispatcher
main() {
    case ${1:-help} in
        dev)
            dev
            ;;
        test)
            test
            ;;
        staging)
            staging
            ;;
        staging-quick)
            staging_quick
            ;;
        production)
            production
            ;;
        production-force)
            production_force
            ;;
        cleanup)
            cleanup
            ;;
        rollback)
            rollback "$2"
            ;;
        status)
            status
            ;;
        logs)
            logs "$2"
            ;;
        smoke)
            smoke
            ;;
        help|--help|-h)
            print_usage
            ;;
        *)
            echo "Unknown command: $1"
            echo ""
            print_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"