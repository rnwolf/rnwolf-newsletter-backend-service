#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "click", "rich"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///

"""
Newsletter Grafana Integration - Complete Reset & Rebuild Script (Python)

This script provides a more robust and debuggable approach to resetting and rebuilding
the Grafana integration with better error handling and step-by-step visibility.

Features:
- Interactive debugging and confirmation
- Proper token rotation strategy
- Better error handling and reporting
- Step-by-step execution with detailed logging
- Handles Grafana service account permission limitations
"""

import os
import sys
import json
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import requests
import click
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.prompt import Confirm, Prompt
from rich.panel import Panel
from rich import print as rprint

# Configuration
GRAFANA_URL = "https://throughputfocus.grafana.net"
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent

console = Console()

class GrafanaAPI:
    """Wrapper for Grafana API calls with proper error handling"""

    def __init__(self, api_key: str, base_url: str = GRAFANA_URL):
        self.api_key = api_key
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        })

    def get(self, endpoint: str) -> Tuple[bool, Any]:
        """Make GET request to Grafana API"""
        try:
            response = self.session.get(f"{self.base_url}{endpoint}", timeout=30)
            return response.status_code < 400, response.json() if response.content else {}
        except Exception as e:
            return False, {'error': str(e)}

    def post(self, endpoint: str, data: Dict) -> Tuple[bool, Any]:
        """Make POST request to Grafana API"""
        try:
            response = self.session.post(f"{self.base_url}{endpoint}", json=data, timeout=30)
            return response.status_code < 400, response.json() if response.content else {}
        except Exception as e:
            return False, {'error': str(e)}

    def delete(self, endpoint: str) -> Tuple[bool, Any]:
        """Make DELETE request to Grafana API"""
        try:
            response = self.session.delete(f"{self.base_url}{endpoint}", timeout=30)
            return response.status_code < 400, response.json() if response.content else {}
        except Exception as e:
            return False, {'error': str(e)}

class GrafanaResetRebuild:
    """Main class for Grafana reset and rebuild operations"""

    def __init__(self):
        self.console = console
        self.admin_api = None
        self.staging_api = None
        self.production_api = None
        self.new_tokens = {}

        # Load environment variables
        self.admin_token = os.getenv('GRAFANA_API_SERVICE_ACCOUNT')
        self.staging_token = os.getenv('GRAFANA_API_KEY_STAGING')
        self.production_token = os.getenv('GRAFANA_API_KEY_PRODUCTION')
        self.organization = os.getenv('GRAFANA_ORGANIZATION', 'throughputfocus')

        # Admin API for service account management
        if self.admin_token:
            self.admin_api = GrafanaAPI(self.admin_token)

        # Environment-specific APIs (if tokens exist)
        if self.staging_token:
            self.staging_api = GrafanaAPI(self.staging_token)
        if self.production_token:
            self.production_api = GrafanaAPI(self.production_token)

    def check_prerequisites(self) -> bool:
        """Check if all prerequisites are met"""
        rprint(Panel.fit("[bold blue]Checking Prerequisites[/bold blue]", border_style="blue"))

        # Check required tools
        tools = ['curl', 'npx']
        for tool in tools:
            if not self._command_exists(tool):
                rprint(f"[red]❌ Required tool not found: {tool}[/red]")
                return False

        # Check wrangler
        try:
            subprocess.run(['npx', 'wrangler', '--version'],
                         capture_output=True, check=True, timeout=10)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            rprint("[red]❌ Wrangler CLI not available[/red]")
            return False

        # Check project structure
        if not (PROJECT_DIR / 'wrangler.jsonc').exists():
            rprint("[red]❌ wrangler.jsonc not found[/red]")
            return False

        if not (PROJECT_DIR / 'grafana').exists():
            rprint("[red]❌ grafana/ directory not found[/red]")
            return False

        rprint("[green]✅ All prerequisites met[/green]")
        return True

    def check_api_permissions(self) -> bool:
        """Check API token permissions and capabilities"""
        rprint(Panel.fit("[bold blue]Checking API Permissions[/bold blue]", border_style="blue"))

        # First check admin service account
        if not self.admin_token:
            rprint("[red]❌ GRAFANA_API_SERVICE_ACCOUNT not set[/red]")
            rprint("Please create an admin service account in Grafana UI and set the token")
            return False

        if not self.admin_api:
            rprint("[red]❌ Could not initialize admin API[/red]")
            return False

        # Test admin API
        success, user_info = self.admin_api.get('/api/user')
        if not success:
            rprint(f"[red]❌ Admin token authentication failed: {user_info}[/red]")
            return False

        login = user_info.get('login', 'unknown')
        role = user_info.get('orgRole', 'unknown')

        # Debug: Show full user info to understand the response format
        rprint(f"[blue]🔍 Debug - User info response: {user_info}[/blue]")

        # Check if this is a service account (starts with 'sa-')
        if login.startswith('sa-'):
            rprint(f"[green]✅ Detected service account: {login}[/green]")

            # For service accounts, role might not be in the /api/user response
            # Let's try to get service account details directly
            # Extract the service account ID from the login (sa-{org_id}-{sa_name})
            if '-' in login:
                try:
                    sa_name = login.split('-', 2)[2]  # Get the part after 'sa-{org_id}-'

                    # Search for this service account to get its role
                    search_success, search_response = self.admin_api.get(f'/api/serviceaccounts/search?query={sa_name}')
                    if search_success and 'serviceAccounts' in search_response:
                        for sa in search_response['serviceAccounts']:
                            if sa.get('login') == login or sa.get('name') == sa_name:
                                role = sa.get('role', 'unknown')
                                rprint(f"[blue]Found service account role: {role}[/blue]")
                                break
                except Exception as e:
                    rprint(f"[yellow]Could not parse service account details: {e}[/yellow]")

        # If we still don't have a role, try checking permissions directly
        if role == 'unknown' or not role:
            rprint("[yellow]⚠️ Could not determine role from API, testing permissions directly...[/yellow]")

            # Test if we can perform admin actions (like listing service accounts)
            test_success, test_response = self.admin_api.get('/api/serviceaccounts/search')
            if test_success:
                rprint("[green]✅ Can list service accounts - appears to have admin permissions[/green]")
                role = 'Admin'  # Assume admin if we can perform admin actions
            else:
                rprint(f"[red]❌ Cannot list service accounts: {test_response}[/red]")
                rprint("Service account appears to lack admin permissions")
                return False

        # Final role check
        if role != 'Admin':
            rprint(f"[red]❌ Service account role is '{role}', must be 'Admin'[/red]")
            rprint("Please update the service account role in Grafana UI")
            return False

        rprint(f"[green]✅ Admin service account: {login} (role: {role})[/green]")

        # Test service account management permissions
        success, sa_list = self.admin_api.get('/api/serviceaccounts/search')
        if not success:
            rprint(f"[red]❌ Cannot list service accounts: {sa_list}[/red]")
            return False

        rprint("[green]✅ Admin token can manage service accounts[/green]")

        # Check existing environment tokens (optional)
        if self.staging_api:
            success, user_info = self.staging_api.get('/api/user')
            if success:
                login = user_info.get('login', 'unknown')
                rprint(f"[blue]ℹ️ Existing staging token: {login}[/blue]")

        if self.production_api:
            success, user_info = self.production_api.get('/api/user')
            if success:
                login = user_info.get('login', 'unknown')
                rprint(f"[blue]ℹ️ Existing production token: {login}[/blue]")

        return True

    def list_existing_resources(self) -> Dict[str, Any]:
        """List existing dashboards and datasources"""
        rprint(Panel.fit("[bold blue]Scanning Existing Resources[/bold blue]", border_style="blue"))

        resources = {
            'dashboards': [],
            'datasources': [],
            'service_accounts': []
        }

        # Use admin API for comprehensive listing
        if not self.admin_api:
            rprint("[red]❌ No admin API available for scanning[/red]")
            return resources

        # Get dashboards
        success, dashboards = self.admin_api.get('/api/search?query=newsletter&type=dash-db')
        if success and isinstance(dashboards, list):
            resources['dashboards'] = [
                {'uid': d.get('uid'), 'title': d.get('title')}
                for d in dashboards if 'newsletter' in d.get('title', '').lower()
            ]

        # Get datasources
        success, datasources = self.admin_api.get('/api/datasources')
        if success and isinstance(datasources, list):
            resources['datasources'] = [
                {'uid': d.get('uid'), 'name': d.get('name')}
                for d in datasources if 'newsletter' in d.get('name', '').lower()
            ]

        # Get service accounts
        success, sa_data = self.admin_api.get('/api/serviceaccounts/search?query=newsletter')
        if success and 'serviceAccounts' in sa_data:
            resources['service_accounts'] = [
                {'id': sa.get('id'), 'name': sa.get('name')}
                for sa in sa_data['serviceAccounts']
                if 'newsletter' in sa.get('name', '').lower()
            ]

        # Display what we found
        if resources['dashboards']:
            rprint(f"[yellow]📊 Found {len(resources['dashboards'])} newsletter dashboards[/yellow]")
            for dashboard in resources['dashboards']:
                rprint(f"  - {dashboard['title']} ({dashboard['uid']})")

        if resources['datasources']:
            rprint(f"[yellow]🔗 Found {len(resources['datasources'])} newsletter datasources[/yellow]")
            for datasource in resources['datasources']:
                rprint(f"  - {datasource['name']} ({datasource['uid']})")

        if resources['service_accounts']:
            rprint(f"[yellow]👤 Found {len(resources['service_accounts'])} newsletter service accounts[/yellow]")
            for sa in resources['service_accounts']:
                rprint(f"  - {sa['name']} (ID: {sa['id']})")

        return resources

    def cleanup_resources(self, resources: Dict[str, Any], nuclear: bool = False) -> bool:
        """Clean up existing resources"""
        rprint(Panel.fit("[bold red]Cleaning Up Resources[/bold red]", border_style="red"))

        if not self.admin_api:
            rprint("[red]❌ No admin API available for cleanup[/red]")
            return False

        success = True

        # Delete dashboards
        for dashboard in resources['dashboards']:
            uid = dashboard['uid']
            title = dashboard['title']
            rprint(f"[yellow]🗑️ Deleting dashboard: {title}[/yellow]")

            delete_success, response = self.admin_api.delete(f'/api/dashboards/uid/{uid}')
            if delete_success:
                rprint(f"[green]✅ Deleted dashboard: {title}[/green]")
            else:
                rprint(f"[red]❌ Failed to delete dashboard: {title} - {response}[/red]")
                success = False

        # Delete datasources
        for datasource in resources['datasources']:
            uid = datasource['uid']
            name = datasource['name']
            rprint(f"[yellow]🗑️ Deleting datasource: {name}[/yellow]")

            delete_success, response = self.admin_api.delete(f'/api/datasources/uid/{uid}')
            if delete_success:
                rprint(f"[green]✅ Deleted datasource: {name}[/green]")
            else:
                rprint(f"[red]❌ Failed to delete datasource: {name} - {response}[/red]")
                success = False

        # Delete service accounts (only in nuclear mode)
        if nuclear and resources['service_accounts']:
            rprint("[red]🚨 NUCLEAR MODE: Deleting service accounts[/red]")

            for sa in resources['service_accounts']:
                sa_id = sa['id']
                name = sa['name']

                # Don't delete the admin service account we're using
                if 'rnwolf-newsletter-service-account' in name:
                    rprint(f"[yellow]⚠️ Skipping admin service account: {name}[/yellow]")
                    continue

                rprint(f"[yellow]🗑️ Deleting service account: {name}[/yellow]")

                delete_success, response = self.admin_api.delete(f'/api/serviceaccounts/{sa_id}')
                if delete_success:
                    rprint(f"[green]✅ Deleted service account: {name}[/green]")
                else:
                    rprint(f"[red]❌ Failed to delete service account: {name} - {response}[/red]")
                    success = False

        return success

    def create_service_accounts_and_tokens(self) -> bool:
        """Create new service accounts and tokens for staging and production"""
        rprint(Panel.fit("[bold blue]Creating Service Accounts and Tokens[/bold blue]", border_style="blue"))

        if not self.admin_api:
            rprint("[red]❌ No admin API available[/red]")
            return False

        environments = ['staging', 'production']
        success = True

        for env in environments:
            rprint(f"[cyan]👤 Creating {env} service account...[/cyan]")

            sa_name = f"newsletter-backend-metrics-{env}"

            # Create service account
            sa_data = {
                'name': sa_name,
                'displayName': f'Newsletter Backend Metrics ({env.title()})',
                'role': 'Admin'
            }

            create_success, response = self.admin_api.post('/api/serviceaccounts', sa_data)

            if not create_success:
                if 'already exists' in str(response).lower():
                    rprint(f"[yellow]⚠️ Service account {sa_name} already exists, finding it...[/yellow]")

                    # Find existing service account
                    list_success, sa_list = self.admin_api.get(f'/api/serviceaccounts/search?query={sa_name}')
                    if list_success and 'serviceAccounts' in sa_list:
                        for sa in sa_list['serviceAccounts']:
                            if sa.get('name') == sa_name:
                                sa_id = sa.get('id')
                                rprint(f"[green]✅ Found existing service account: {sa_name} (ID: {sa_id})[/green]")
                                break
                        else:
                            rprint(f"[red]❌ Could not find service account {sa_name}[/red]")
                            success = False
                            continue
                    else:
                        rprint(f"[red]❌ Could not list service accounts: {sa_list}[/red]")
                        success = False
                        continue
                else:
                    rprint(f"[red]❌ Failed to create service account {sa_name}: {response}[/red]")
                    success = False
                    continue
            else:
                sa_id = response.get('id')
                rprint(f"[green]✅ Created service account: {sa_name} (ID: {sa_id})[/green]")

            if not sa_id:
                rprint(f"[red]❌ No service account ID for {env}[/red]")
                success = False
                continue

            # Delete existing tokens for this service account
            rprint(f"[yellow]🔧 Managing tokens for {sa_name}...[/yellow]")

            tokens_success, tokens_response = self.admin_api.get(f'/api/serviceaccounts/{sa_id}/tokens')
            if tokens_success:
                for token in tokens_response:
                    token_id = token.get('id')
                    if token_id:
                        self.admin_api.delete(f'/api/serviceaccounts/{sa_id}/tokens/{token_id}')
                        rprint(f"[yellow]🗑️ Deleted existing token: {token_id}[/yellow]")

            # Create new token
            token_name = f'newsletter-{env}-token-{int(time.time())}'
            token_data = {'name': token_name}

            token_success, token_response = self.admin_api.post(f'/api/serviceaccounts/{sa_id}/tokens', token_data)

            if token_success:
                new_token = token_response.get('key')
                if new_token:
                    self.new_tokens[env] = new_token
                    rprint(f"[green]✅ Created token for {env}: {token_name}[/green]")

                    # Update API instances
                    if env == 'staging':
                        self.staging_api = GrafanaAPI(new_token)
                    elif env == 'production':
                        self.production_api = GrafanaAPI(new_token)
                else:
                    rprint(f"[red]❌ No token returned for {env}[/red]")
                    success = False
            else:
                rprint(f"[red]❌ Failed to create token for {env}: {token_response}[/red]")
                success = False

        if self.new_tokens:
            # Save tokens to file for reference
            token_file = PROJECT_DIR / f".grafana-tokens-{datetime.now().strftime('%Y%m%d-%H%M%S')}.env"
            with open(token_file, 'w') as f:
                f.write("# New Grafana API Tokens\n")
                f.write(f"# Generated: {datetime.now().isoformat()}\n\n")
                for env, token in self.new_tokens.items():
                    f.write(f"GRAFANA_API_KEY_{env.upper()}={token}\n")

            rprint(f"[green]💾 New tokens saved to: {token_file}[/green]")

        return success

    def create_datasources(self) -> bool:
        """Create new datasources"""
        rprint(Panel.fit("[bold blue]Creating Datasources[/bold blue]", border_style="blue"))

        datasource_configs = {
            'staging': {
                'name': 'Newsletter-API-Staging',
                'url': 'https://api-staging.rnwolf.net/metrics',
                'api_key': self.new_tokens.get('staging') or self.staging_token,
                'api': self.staging_api
            },
            'production': {
                'name': 'Newsletter-API-Production',
                'url': 'https://api.rnwolf.net/metrics',
                'api_key': self.new_tokens.get('production') or self.production_token,
                'api': self.production_api
            }
        }

        success = True

        for env, config in datasource_configs.items():
            if not config['api']:
                rprint(f"[yellow]⚠️ Skipping {env} datasource (no API token)[/yellow]")
                continue

            rprint(f"[cyan]🔗 Creating {env} datasource...[/cyan]")

            datasource_data = {
                'name': config['name'],
                'type': 'prometheus',
                'access': 'proxy',
                'url': config['url'],
                'isDefault': env == 'production',
                'jsonData': {
                    'timeInterval': '30s',
                    'httpMethod': 'GET',
                    'httpHeaderName1': 'Authorization'
                },
                'secureJsonData': {
                    'httpHeaderValue1': f"Bearer {config['api_key']}"
                },
                'editable': True
            }

            create_success, response = config['api'].post('/api/datasources', datasource_data)
            if create_success:
                ds_id = response.get('id', 'unknown')
                rprint(f"[green]✅ Created {env} datasource (ID: {ds_id})[/green]")
            else:
                rprint(f"[red]❌ Failed to create {env} datasource: {response}[/red]")
                success = False

        return success

    def create_dashboards(self) -> bool:
        """Create new dashboards"""
        rprint(Panel.fit("[bold blue]Creating Dashboards[/bold blue]", border_style="blue"))

        dashboard_configs = {
            'staging': {
                'file': PROJECT_DIR / 'grafana' / 'grafana-dashboard-config_staging.json',
                'api': self.staging_api,
                'token': self.new_tokens.get('staging') or self.staging_token
            },
            'production': {
                'file': PROJECT_DIR / 'grafana' / 'grafana-dashboard-config_production.json',
                'api': self.production_api,
                'token': self.new_tokens.get('production') or self.production_token
            }
        }

        success = True

        for env, config in dashboard_configs.items():
            if not config['api'] or not config['file'].exists():
                rprint(f"[yellow]⚠️ Skipping {env} dashboard (missing API or config file)[/yellow]")
                continue

            rprint(f"[cyan]📊 Creating {env} dashboard...[/cyan]")

            # Read and process dashboard config
            with open(config['file'], 'r') as f:
                dashboard_config = json.load(f)

            # Replace token placeholder
            config_str = json.dumps(dashboard_config)
            config_str = config_str.replace(f'glsa_YOUR_{env.upper()}_TOKEN_HERE', config['token'])
            dashboard_config = json.loads(config_str)

            # Ensure fresh creation
            if 'dashboard' in dashboard_config:
                dashboard_config['dashboard'].pop('id', None)
                dashboard_config['dashboard'].pop('version', None)
                # Generate unique UID
                timestamp = int(time.time())
                dashboard_config['dashboard']['uid'] = f'newsletter-{env}-{timestamp}'

            dashboard_config['overwrite'] = False

            create_success, response = config['api'].post('/api/dashboards/db', dashboard_config)
            if create_success:
                dashboard_url = response.get('url', '')
                rprint(f"[green]✅ Created {env} dashboard[/green]")
                if dashboard_url:
                    rprint(f"[blue]🔗 URL: {GRAFANA_URL}{dashboard_url}[/blue]")
            else:
                rprint(f"[red]❌ Failed to create {env} dashboard: {response}[/red]")
                success = False

        return success

    def update_cloudflare_secrets(self) -> bool:
        """Update Cloudflare Worker secrets with new tokens"""
        rprint(Panel.fit("[bold blue]Updating Cloudflare Secrets[/bold blue]", border_style="blue"))

        success = True

        for env, token in self.new_tokens.items():
            rprint(f"[cyan]🔐 Updating {env} Cloudflare secret...[/cyan]")

            try:
                # Use echo and pipe to wrangler
                process = subprocess.Popen(
                    ['npx', 'wrangler', 'secret', 'put', 'GRAFANA_API_KEY', '--env', env],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd=PROJECT_DIR
                )

                stdout, stderr = process.communicate(input=token, timeout=30)

                if process.returncode == 0:
                    rprint(f"[green]✅ Updated {env} Cloudflare secret[/green]")
                else:
                    rprint(f"[red]❌ Failed to update {env} secret: {stderr}[/red]")
                    success = False

            except Exception as e:
                rprint(f"[red]❌ Error updating {env} secret: {e}[/red]")
                success = False

        return success

    def test_integration(self) -> bool:
        """Test the complete integration"""
        rprint(Panel.fit("[bold blue]Testing Integration[/bold blue]", border_style="blue"))

        test_configs = {
            'staging': 'https://api-staging.rnwolf.net',
            'production': 'https://api.rnwolf.net'
        }

        success = True

        for env, api_url in test_configs.items():
            if env not in self.new_tokens:
                continue

            rprint(f"[cyan]🧪 Testing {env} integration...[/cyan]")

            # Test API health
            try:
                response = requests.get(f"{api_url}/health", timeout=10)
                if response.status_code == 200:
                    rprint(f"[green]✅ {env} API health check passed[/green]")
                else:
                    rprint(f"[red]❌ {env} API health check failed[/red]")
                    success = False
            except Exception as e:
                rprint(f"[red]❌ {env} API connection failed: {e}[/red]")
                success = False

            # Test metrics endpoint with authentication
            try:
                headers = {'Authorization': f'Bearer {self.new_tokens[env]}'}
                response = requests.get(f"{api_url}/metrics", headers=headers, timeout=10)
                if response.status_code == 200:
                    rprint(f"[green]✅ {env} metrics endpoint accessible[/green]")
                else:
                    rprint(f"[yellow]⚠️ {env} metrics endpoint returned {response.status_code}[/yellow]")
            except Exception as e:
                rprint(f"[yellow]⚠️ {env} metrics test failed: {e}[/yellow]")

        return success

    def _command_exists(self, command: str) -> bool:
        """Check if a command exists in PATH"""
        try:
            subprocess.run(['which', command], capture_output=True, check=True)
            return True
        except subprocess.CalledProcessError:
            return False

    def run_complete_reset(self, nuclear: bool = False, dry_run: bool = False) -> bool:
        """Run the complete reset and rebuild process"""
        rprint(Panel.fit(
            "[bold cyan]Newsletter Grafana Integration - Complete Reset & Rebuild[/bold cyan]",
            border_style="cyan"
        ))

        if dry_run:
            rprint("[yellow]🏃 DRY RUN MODE - No changes will be made[/yellow]")

        # Step 1: Prerequisites
        if not self.check_prerequisites():
            return False

        # Step 2: Check permissions
        if not self.check_api_permissions():
            return False

        # Step 3: Scan existing resources
        resources = self.list_existing_resources()

        # Step 4: Confirmation
        if not dry_run:
            if nuclear:
                rprint("[red]🚨 NUCLEAR MODE: This will delete ALL newsletter resources including service accounts![/red]")
            else:
                rprint("[yellow]⚠️ This will delete existing dashboards and datasources[/yellow]")

            if not Confirm.ask("Continue with reset and rebuild?"):
                rprint("[yellow]❌ Operation cancelled[/yellow]")
                return False

        if dry_run:
            rprint("[yellow]✨ DRY RUN: Would proceed with cleanup and rebuild[/yellow]")
            return True

        # Step 5: Cleanup
        if not self.cleanup_resources(resources, nuclear):
            rprint("[red]❌ Cleanup failed[/red]")
            return False

        # Step 6: Create new service accounts and tokens
        if not self.create_service_accounts_and_tokens():
            rprint("[red]❌ Service account and token creation failed[/red]")
            return False

        # Step 7: Update Cloudflare secrets
        if not self.update_cloudflare_secrets():
            rprint("[yellow]⚠️ Some Cloudflare secret updates failed[/yellow]")

        # Step 8: Create datasources
        if not self.create_datasources():
            rprint("[yellow]⚠️ Some datasource creation failed[/yellow]")

        # Step 9: Create dashboards
        if not self.create_dashboards():
            rprint("[yellow]⚠️ Some dashboard creation failed[/yellow]")

        # Step 10: Test integration
        self.test_integration()

        # Step 11: Summary
        rprint(Panel.fit("[bold green]Reset and Rebuild Complete![/bold green]", border_style="green"))

        if self.new_tokens:
            rprint("[bold yellow]🔑 New API Tokens:[/bold yellow]")
            for env, token in self.new_tokens.items():
                rprint(f"[cyan]GRAFANA_API_KEY_{env.upper()}=[/cyan][dim]{token}[/dim]")

        rprint("\n[bold blue]Next Steps:[/bold blue]")
        rprint("1. Update your environment variables with the new tokens")
        rprint("2. Visit Grafana to verify dashboards: https://throughputfocus.grafana.net/dashboards")
        rprint("3. Run validation script: ./scripts/grafana-validation-testing.sh")

        return True

@click.command()
@click.option('--nuclear', is_flag=True, help='Delete service accounts too (DESTRUCTIVE)')
@click.option('--dry-run', is_flag=True, help='Show what would be done without doing it')
@click.option('--cleanup-only', is_flag=True, help='Only cleanup, no rebuild')
def main(nuclear, dry_run, cleanup_only):
    """Newsletter Grafana Integration - Complete Reset & Rebuild"""

    reset_tool = GrafanaResetRebuild()

    if cleanup_only:
        # Just run cleanup
        if not reset_tool.check_prerequisites():
            sys.exit(1)
        if not reset_tool.check_api_permissions():
            sys.exit(1)

        resources = reset_tool.list_existing_resources()

        if not dry_run and not Confirm.ask("Proceed with cleanup only?"):
            sys.exit(0)

        if not dry_run:
            success = reset_tool.cleanup_resources(resources, nuclear)
            sys.exit(0 if success else 1)
        else:
            rprint("[yellow]✨ DRY RUN: Would cleanup resources[/yellow]")
            sys.exit(0)

    # Full reset and rebuild
    success = reset_tool.run_complete_reset(nuclear, dry_run)
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()