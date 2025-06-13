#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = ["requests", "click", "rich"]
# [tool.uv]
# exclude-newer = "2025-06-06T00:00:00Z"
# ///

"""
Newsletter Database Backup and Restore Utility (Python Version)
Features:
- Create backups from Cloudflare D1 databases
- Restore databases from backup files
- Verify backup integrity
- Migrate data between environments
- Rich CLI interface with progress indicators
- Comprehensive logging and error handling
"""

import os
import sys
import json
import gzip
import shutil
import subprocess
import logging
from datetime import datetime, timedelta
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
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
BACKUP_DIR = PROJECT_DIR / "backups" / "database"
LOG_FILE = PROJECT_DIR / "db-backup-restore.log"

# Database configuration - IDs from environment variables or wrangler.jsonc
def load_database_config():
    """Load database configuration from environment variables or wrangler.jsonc"""
    config = {
        "local": {
            "id": os.getenv('LOCAL_DB_ID'),
            "name": "rnwolf-newsletter-db-local",
            "remote": False
        },
        "staging": {
            "id": os.getenv('STAGING_DB_ID'),
            "name": "rnwolf-newsletter-db-staging",
            "remote": True
        },
        "production": {
            "id": os.getenv('PRODUCTION_DB_ID'),
            "name": "rnwolf-newsletter-db-production",
            "remote": True
        }
    }

    # Fallback: Try to read from wrangler.jsonc if environment variables are not set
    wrangler_config_path = PROJECT_DIR / "wrangler.jsonc"
    if wrangler_config_path.exists():
        try:
            import json
            import re

            with open(wrangler_config_path, 'r') as f:
                content = f.read()

            # Remove comments from JSONC
            content = re.sub(r'//.*?\n', '\n', content)
            content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)

            wrangler_config = json.loads(content)

            # Extract database IDs from wrangler.jsonc
            for env_name in ["local", "staging", "production"]:
                if not config[env_name]["id"]:  # Only if not set by environment variable
                    env_config = wrangler_config.get("env", {}).get(env_name, {})
                    d1_databases = env_config.get("d1_databases", [])

                    if d1_databases and len(d1_databases) > 0:
                        db_config = d1_databases[0]  # Assume first database is the main one
                        config[env_name]["id"] = db_config.get("database_id")

                        # Also update name if specified in wrangler.jsonc
                        if "database_name" in db_config:
                            config[env_name]["name"] = db_config["database_name"]

        except Exception as e:
            console.print(f"[yellow]Warning: Could not parse wrangler.jsonc: {e}[/yellow]")

    return config

DATABASE_CONFIG = load_database_config()

# Cloudflare API Configuration
CLOUDFLARE_ACCOUNT_ID = os.getenv('CLOUDFLARE_ACCOUNT_ID')
CLOUDFLARE_API_TOKEN = os.getenv('CLOUDFLARE_API_TOKEN')

console = Console()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)

class DatabaseBackupRestore:
    def __init__(self):
        self.console = console
        self.backup_dir = BACKUP_DIR
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.database_config = load_database_config()

        # Validate database configuration
        self._validate_database_config()

    def _validate_database_config(self):
        """Validate that all required database IDs are available"""
        missing_configs = []

        for env_name, config in self.database_config.items():
            if not config.get("id"):
                missing_configs.append(env_name)

        if missing_configs:
            self.console.print("[red]❌ Missing database configuration for environments:[/red]")
            for env in missing_configs:
                self.console.print(f"  - {env}")

            self.console.print("\n[yellow]💡 To fix this, set these environment variables:[/yellow]")
            if "local" in missing_configs:
                self.console.print("  export LOCAL_DB_ID='your_local_db_id'")
            if "staging" in missing_configs:
                self.console.print("  export STAGING_DB_ID='your_staging_db_id'")
            if "production" in missing_configs:
                self.console.print("  export PRODUCTION_DB_ID='your_production_db_id'")

            self.console.print("\n[blue]📝 Or ensure your wrangler.jsonc file contains the database_id fields[/blue]")
            self.console.print("You can find database IDs by running: npx wrangler d1 list")

            raise click.ClickException("Database configuration incomplete")

    def get_database_config(self, environment: str) -> dict:
        """Get database configuration for specific environment"""
        if environment not in self.database_config:
            raise click.ClickException(f"Unknown environment: {environment}")

        config = self.database_config[environment]
        if not config.get("id"):
            raise click.ClickException(f"Database ID not configured for {environment} environment")

        return config

    def log(self, message: str, level: str = "info"):
        """Log message with timestamp"""
        getattr(logging, level.lower())(message)

    def run_wrangler_command(self, command: List[str]) -> Tuple[bool, str, str]:
        """Run wrangler command and return success, stdout, stderr"""
        try:
            result = subprocess.run(
                ["npx", "wrangler"] + command,
                capture_output=True,
                text=True,
                cwd=PROJECT_DIR,
                timeout=300
            )
            return result.returncode == 0, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return False, "", "Command timed out after 300 seconds"
        except Exception as e:
            return False, "", str(e)

    def query_d1_database(self, sql_query: str, environment: str) -> Optional[Dict[str, Any]]:
        """Execute SQL query against Cloudflare D1 database via API"""
        if not all([CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN]):
            self.console.print("[red]Missing Cloudflare credentials[/red]")
            self.console.print("Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN environment variables")
            return None

        db_config = self.get_database_config(environment)
        db_id = db_config["id"]

        url = f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{db_id}/query"

        headers = {
            "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
            "Content-Type": "application/json"
        }

        payload = {"sql": sql_query}

        try:
            response = requests.post(url, headers=headers, json=payload, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            self.log(f"Database query failed for {environment}: {e}", "error")
            return None

    def generate_backup_filename(self, environment: str, suffix: str = "", compression: bool = True) -> str:
        """Generate backup filename with timestamp"""
        timestamp = datetime.now().strftime('%Y%m%d-%H%M%S')
        base_name = f"backup-{environment}-{timestamp}"
        if suffix:
            base_name += f"-{suffix}"
        base_name += ".sql"
        if compression:
            base_name += ".gz"
        return base_name

    def get_subscriber_count(self, environment: str) -> int:
        """Get current subscriber count"""
        try:
            # First try using wrangler CLI
            db_config = self.get_database_config(environment)
            command = ["d1", "execute", "DB", "--env", environment]
            if db_config["remote"]:
                command.append("--remote")
            command.extend(["--command", "SELECT COUNT(*) as count FROM subscribers"])

            success, stdout, stderr = self.run_wrangler_command(command)
            if success and stdout:
                # Parse the output to extract count
                lines = stdout.strip().split('\n')

                # Look for the actual count in various formats
                for line in lines:
                    line = line.strip()

                    # Skip empty lines and headers
                    if not line or 'count' in line.lower() or '─' in line or '┌' in line or '└' in line:
                        continue

                    # Try to extract number from table format (│ count │)
                    if '│' in line:
                        parts = [p.strip() for p in line.split('│')]
                        for part in parts:
                            if part.isdigit():
                                return int(part)

                    # Try direct number
                    if line.isdigit():
                        return int(line)

                    # Try to find number in line with other text
                    import re
                    numbers = re.findall(r'\b\d+\b', line)
                    if numbers:
                        # Take the first number that looks like a count
                        for num in numbers:
                            count_val = int(num)
                            # Reasonable range for subscriber count
                            if 0 <= count_val <= 1000000:
                                return count_val

                # If wrangler parsing fails, try API approach for remote databases
                if db_config["remote"]:
                    self.log(f"Wrangler parsing failed, trying API approach for {environment}", "warning")
                    return self._get_subscriber_count_via_api(environment)

                # If we can't parse it, log the output for debugging
                self.log(f"Could not parse subscriber count from wrangler output for {environment}", "warning")
                if self.console.is_terminal:  # Only show debug in interactive mode
                    self.console.print(f"[yellow]Debug - Raw wrangler output for {environment}:[/yellow]")
                    self.console.print(f"[dim]{stdout[:500]}{'...' if len(stdout) > 500 else ''}[/dim]")

            else:
                self.log(f"Wrangler command failed for {environment}: {stderr}", "error")
                # Try API approach for remote databases as fallback
                if db_config["remote"]:
                    return self._get_subscriber_count_via_api(environment)

            return 0
        except Exception as e:
            self.log(f"Failed to get subscriber count for {environment}: {e}", "error")
            return 0

    def _get_subscriber_count_via_api(self, environment: str) -> int:
        """Get subscriber count via Cloudflare API as fallback"""
        try:
            result = self.query_d1_database("SELECT COUNT(*) as count FROM subscribers", environment)
            if result and result.get('success'):
                results = result.get('result', [])
                if results and len(results) > 0:
                    rows = results[0].get('results', [])
                    if rows and len(rows) > 0:
                        return rows[0].get('count', 0)
            return 0
        except Exception as e:
            self.log(f"API fallback failed for {environment}: {e}", "error")
            return 0

    def create_backup(self, environment: str, compression: bool = True, verify: bool = True) -> Optional[str]:
        """Create database backup"""
        backup_filename = self.generate_backup_filename(environment, compression=compression)
        backup_path = self.backup_dir / backup_filename

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console
        ) as progress:
            task = progress.add_task(f"Creating backup for {environment}...", total=None)

            try:
                # Get current subscriber count for verification
                initial_count = self.get_subscriber_count(environment)
                self.log(f"Creating backup for {environment} ({initial_count} subscribers)")

                db_config = self.get_database_config(environment)
                temp_file = self.backup_dir / f"temp_{environment}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"

                # Create backup header
                with open(temp_file, 'w') as f:
                    f.write(f"""-- Newsletter Database Backup
-- Generated by db-backup-restore.py
-- Timestamp: {datetime.now().isoformat()}
-- Environment: {environment}
-- Database ID: {db_config['id']}
-- Database Name: {db_config['name']}
-- Subscriber Count: {initial_count}

-- Schema Creation
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

CREATE INDEX IF NOT EXISTS idx_email ON subscribers(email);
CREATE INDEX IF NOT EXISTS idx_subscribed_at ON subscribers(subscribed_at);

-- Data Export
""")

                # Export data using wrangler
                progress.update(task, description="Exporting subscriber data...")

                # Build the SQL command to export data as INSERT statements
                export_sql = """
SELECT
    'INSERT INTO subscribers (id, email, subscribed_at, unsubscribed_at, ip_address, user_agent, country, city, created_at, updated_at) VALUES (' ||
    COALESCE(id, 'NULL') || ', ' ||
    QUOTE(email) || ', ' ||
    QUOTE(subscribed_at) || ', ' ||
    COALESCE(QUOTE(unsubscribed_at), 'NULL') || ', ' ||
    COALESCE(QUOTE(ip_address), 'NULL') || ', ' ||
    COALESCE(QUOTE(user_agent), 'NULL') || ', ' ||
    COALESCE(QUOTE(country), 'NULL') || ', ' ||
    COALESCE(QUOTE(city), 'NULL') || ', ' ||
    COALESCE(QUOTE(created_at), 'NULL') || ', ' ||
    COALESCE(QUOTE(updated_at), 'NULL') || ');' as sql_statement
FROM subscribers
ORDER BY id;
"""

                command = ["d1", "execute", "DB", "--env", environment]
                if db_config["remote"]:
                    command.append("--remote")
                command.extend(["--command", export_sql])

                success, stdout, stderr = self.run_wrangler_command(command)

                if not success:
                    self.log(f"Failed to export data from {environment}: {stderr}", "error")
                    temp_file.unlink(missing_ok=True)
                    return None

                # Parse and clean the output
                with open(temp_file, 'a') as f:
                    lines = stdout.strip().split('\n')
                    insert_count = 0
                    for line in lines:
                        line = line.strip()
                        if line.startswith('INSERT INTO subscribers'):
                            f.write(line + '\n')
                            insert_count += 1

                    f.write(f"\n-- Backup completed at {datetime.now().isoformat()}\n")
                    f.write(f"-- Total records exported: {insert_count}\n")

                # Compress if requested
                progress.update(task, description="Compressing backup...")
                if compression:
                    with open(temp_file, 'rb') as f_in:
                        with gzip.open(backup_path, 'wb') as f_out:
                            shutil.copyfileobj(f_in, f_out)
                    temp_file.unlink()
                else:
                    temp_file.rename(backup_path)

                # Verify backup
                if verify:
                    progress.update(task, description="Verifying backup...")
                    if not self.verify_backup(backup_filename):
                        self.log("Backup verification failed", "error")
                        backup_path.unlink(missing_ok=True)
                        return None

                file_size = backup_path.stat().st_size
                self.log(f"Backup created: {backup_filename} ({file_size} bytes)")

                return backup_filename

            except Exception as e:
                self.log(f"Backup creation failed for {environment}: {e}", "error")
                return None

    def verify_backup(self, backup_filename: str) -> bool:
        """Verify backup file integrity"""
        backup_path = self.backup_dir / backup_filename

        if not backup_path.exists():
            self.console.print(f"[red]Backup file not found: {backup_filename}[/red]")
            return False

        try:
            # Check if compressed
            if backup_filename.endswith('.gz'):
                with gzip.open(backup_path, 'rt') as f:
                    content = f.read(1000)  # Read first 1000 chars
            else:
                with open(backup_path, 'r') as f:
                    content = f.read(1000)

            # Verify SQL content
            if not any(keyword in content for keyword in ['CREATE TABLE', 'INSERT INTO', '--']):
                self.console.print("[red]Backup file does not contain valid SQL content[/red]")
                return False

            return True

        except Exception as e:
            self.console.print(f"[red]Backup verification failed: {e}[/red]")
            return False

    def restore_database(self, environment: str, backup_filename: str,
                        create_safety_backup: bool = True, verify_restore: bool = True) -> bool:
        """Restore database from backup file"""
        backup_path = self.backup_dir / backup_filename

        if not self.verify_backup(backup_filename):
            return False

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=self.console
        ) as progress:
            try:
                # Create safety backup
                if create_safety_backup:
                    task = progress.add_task("Creating safety backup...", total=None)
                    safety_backup = self.create_backup(environment, compression=True, verify=False)
                    if safety_backup:
                        self.console.print(f"[green]Safety backup created: {safety_backup}[/green]")
                    else:
                        self.console.print("[yellow]Warning: Could not create safety backup[/yellow]")

                # Prepare restore file
                task = progress.add_task("Preparing restore file...", total=None)
                temp_sql = self.backup_dir / f"restore_temp_{datetime.now().strftime('%Y%m%d_%H%M%S')}.sql"

                if backup_filename.endswith('.gz'):
                    with gzip.open(backup_path, 'rb') as f_in:
                        with open(temp_sql, 'wb') as f_out:
                            shutil.copyfileobj(f_in, f_out)
                else:
                    shutil.copy2(backup_path, temp_sql)

                # Clear existing data
                progress.update(task, description="Clearing existing data...")
                db_config = self.get_database_config(environment)

                clear_command = ["d1", "execute", "DB", "--env", environment]
                if db_config["remote"]:
                    clear_command.append("--remote")
                clear_command.extend(["--command", "DELETE FROM subscribers;"])

                success, stdout, stderr = self.run_wrangler_command(clear_command)
                if not success:
                    self.log(f"Warning: Failed to clear existing data in {environment}: {stderr}", "warning")

                # Restore data
                progress.update(task, description="Restoring data from backup...")

                restore_command = ["d1", "execute", "DB", "--env", environment]
                if db_config["remote"]:
                    restore_command.append("--remote")
                restore_command.extend(["--file", str(temp_sql)])

                success, stdout, stderr = self.run_wrangler_command(restore_command)

                # Clean up temp file
                temp_sql.unlink(missing_ok=True)

                if not success:
                    self.log(f"Restore failed for {environment}: {stderr}", "error")
                    return False

                # Verify restore
                if verify_restore:
                    progress.update(task, description="Verifying restore...")
                    restored_count = self.get_subscriber_count(environment)
                    if restored_count > 0:
                        self.console.print(f"[green]Restore verified: {restored_count} records restored[/green]")
                    else:
                        self.console.print("[yellow]Warning: No records found after restore[/yellow]")

                self.log(f"Database restore completed for {environment}")
                return True

            except Exception as e:
                self.log(f"Restore failed for {environment}: {e}", "error")
                return False

    def list_backups(self, environment_filter: Optional[str] = None) -> List[Dict[str, Any]]:
        """List available backup files"""
        backups = []

        pattern = "backup-*.sql*"
        for backup_file in self.backup_dir.glob(pattern):
            if backup_file.is_file():
                try:
                    # Parse filename
                    name = backup_file.name
                    parts = name.replace('.sql.gz', '').replace('.sql', '').split('-')

                    if len(parts) >= 3 and parts[0] == 'backup':
                        env = parts[1]
                        timestamp_str = parts[2]

                        # Filter by environment if specified
                        if environment_filter and env != environment_filter:
                            continue

                        # Parse timestamp
                        try:
                            timestamp = datetime.strptime(timestamp_str, '%Y%m%d')
                            formatted_date = timestamp.strftime('%Y-%m-%d')
                        except ValueError:
                            try:
                                timestamp = datetime.strptime(timestamp_str, '%Y%m%d-%H%M%S')
                                formatted_date = timestamp.strftime('%Y-%m-%d %H:%M:%S')
                            except ValueError:
                                formatted_date = timestamp_str

                        file_size = backup_file.stat().st_size

                        backups.append({
                            'filename': name,
                            'environment': env,
                            'date': formatted_date,
                            'size': file_size,
                            'compressed': name.endswith('.gz'),
                            'path': backup_file
                        })

                except Exception as e:
                    self.log(f"Error parsing backup file {backup_file}: {e}", "warning")

        return sorted(backups, key=lambda x: x['filename'], reverse=True)

    def cleanup_old_backups(self, retention_days: int = 30, max_backups_per_env: int = 50) -> int:
        """Clean up old backup files"""
        deleted_count = 0

        # Get all backups
        backups = self.list_backups()

        # Group by environment
        env_backups = {}
        for backup in backups:
            env = backup['environment']
            if env not in env_backups:
                env_backups[env] = []
            env_backups[env].append(backup)

        # Clean by retention period
        cutoff_date = datetime.now() - timedelta(days=retention_days)

        for backup in backups:
            try:
                file_mtime = datetime.fromtimestamp(backup['path'].stat().st_mtime)
                if file_mtime < cutoff_date:
                    self.console.print(f"[yellow]Deleting old backup: {backup['filename']}[/yellow]")
                    backup['path'].unlink()
                    deleted_count += 1
                    self.log(f"Deleted old backup: {backup['filename']}")
            except Exception as e:
                self.log(f"Error deleting backup {backup['filename']}: {e}", "error")

        # Clean by max count per environment
        for env, env_backup_list in env_backups.items():
            if len(env_backup_list) > max_backups_per_env:
                # Sort by date (newest first) and keep only the newest max_backups_per_env
                sorted_backups = sorted(env_backup_list,
                                      key=lambda x: x['path'].stat().st_mtime,
                                      reverse=True)

                for backup in sorted_backups[max_backups_per_env:]:
                    try:
                        if backup['path'].exists():  # Check if not already deleted
                            self.console.print(f"[yellow]Deleting excess backup for {env}: {backup['filename']}[/yellow]")
                            backup['path'].unlink()
                            deleted_count += 1
                            self.log(f"Deleted excess backup: {backup['filename']}")
                    except Exception as e:
                        self.log(f"Error deleting backup {backup['filename']}: {e}", "error")

        return deleted_count

# CLI Interface
@click.group()
@click.option('--verbose', '-v', is_flag=True, help='Enable verbose logging')
def cli(verbose):
    """Newsletter Database Backup and Restore Utility"""
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

@cli.command()
@click.argument('environment', type=click.Choice(['local', 'staging', 'production']))
@click.option('--no-compression', is_flag=True, help='Disable backup compression')
@click.option('--no-verify', is_flag=True, help='Skip backup verification')
def backup(environment, no_compression, no_verify):
    """Create a database backup"""
    db_util = DatabaseBackupRestore()

    rprint(Panel.fit(
        f"[bold blue]Creating backup for {environment} environment[/bold blue]",
        border_style="blue"
    ))

    backup_filename = db_util.create_backup(
        environment=environment,
        compression=not no_compression,
        verify=not no_verify
    )

    if backup_filename:
        rprint(f"[green]✅ Backup created successfully: {backup_filename}[/green]")
        rprint(f"[blue]📁 Location: {db_util.backup_dir / backup_filename}[/blue]")
    else:
        rprint("[red]❌ Backup creation failed[/red]")
        sys.exit(1)

@cli.command()
@click.argument('environment', type=click.Choice(['local', 'staging', 'production']))
@click.option('--file', 'backup_file', help='Specific backup file to restore')
@click.option('--no-safety-backup', is_flag=True, help='Skip creating safety backup')
@click.option('--no-verify', is_flag=True, help='Skip restore verification')
@click.option('--force', is_flag=True, help='Force restore without confirmation')
def restore(environment, backup_file, no_safety_backup, no_verify, force):
    """Restore database from backup"""
    db_util = DatabaseBackupRestore()

    # List available backups if none specified
    if not backup_file:
        backups = db_util.list_backups(environment)
        if not backups:
            rprint(f"[red]No backups found for {environment} environment[/red]")
            sys.exit(1)

        rprint(f"[blue]Available backups for {environment}:[/blue]")
        table = Table()
        table.add_column("Filename", style="cyan")
        table.add_column("Date", style="green")
        table.add_column("Size", style="yellow")

        for backup_info in backups[:10]:  # Show last 10
            size_mb = backup_info['size'] / (1024 * 1024)
            table.add_row(
                backup_info['filename'],
                backup_info['date'],
                f"{size_mb:.2f} MB"
            )

        console.print(table)
        backup_file = Prompt.ask("Enter backup filename")

    if not backup_file:
        rprint("[red]No backup file specified[/red]")
        sys.exit(1)

    # Confirmation
    if not force:
        warning_text = f"⚠️  This will replace ALL data in the {environment} database!"
        if not Confirm.ask(f"[yellow]{warning_text}[/yellow]\nContinue?"):
            rprint("[yellow]Restore cancelled[/yellow]")
            sys.exit(0)

    rprint(Panel.fit(
        f"[bold red]Restoring {environment} database from {backup_file}[/bold red]",
        border_style="red"
    ))

    success = db_util.restore_database(
        environment=environment,
        backup_filename=backup_file,
        create_safety_backup=not no_safety_backup,
        verify_restore=not no_verify
    )

    if success:
        rprint("[green]✅ Database restore completed successfully[/green]")
    else:
        rprint("[red]❌ Database restore failed[/red]")
        sys.exit(1)

@cli.command()
@click.argument('environment', type=click.Choice(['local', 'staging', 'production']), required=False)
def list_backups(environment):
    """List available backup files"""
    db_util = DatabaseBackupRestore()
    backups = db_util.list_backups(environment)

    if not backups:
        env_text = f" for {environment}" if environment else ""
        rprint(f"[yellow]No backups found{env_text}[/yellow]")
        return

    table = Table(title=f"Available Backups{' for ' + environment if environment else ''}")
    table.add_column("Filename", style="cyan", no_wrap=True)
    table.add_column("Environment", style="blue")
    table.add_column("Date", style="green")
    table.add_column("Size", style="yellow")
    table.add_column("Compressed", style="magenta")

    for backup_info in backups:
        size_mb = backup_info['size'] / (1024 * 1024)
        table.add_row(
            backup_info['filename'],
            backup_info['environment'],
            backup_info['date'],
            f"{size_mb:.2f} MB",
            "Yes" if backup_info['compressed'] else "No"
        )

    console.print(table)

@cli.command()
@click.option('--retention-days', default=30, help='Delete backups older than N days')
@click.option('--max-per-env', default=50, help='Maximum backups to keep per environment')
@click.option('--dry-run', is_flag=True, help='Show what would be deleted without actually deleting')
def cleanup(retention_days, max_per_env, dry_run):
    """Clean up old backup files"""
    db_util = DatabaseBackupRestore()

    if dry_run:
        rprint("[yellow]DRY RUN - No files will be deleted[/yellow]")

    rprint(Panel.fit(
        f"[bold yellow]Cleaning up backups older than {retention_days} days[/bold yellow]",
        border_style="yellow"
    ))

    if not dry_run:
        deleted_count = db_util.cleanup_old_backups(retention_days, max_per_env)
        rprint(f"[green]✅ Cleanup completed: {deleted_count} backups deleted[/green]")
    else:
        # Show what would be deleted
        backups = db_util.list_backups()
        cutoff_date = datetime.now() - timedelta(days=retention_days)
        would_delete = []

        for backup in backups:
            file_mtime = datetime.fromtimestamp(backup['path'].stat().st_mtime)
            if file_mtime < cutoff_date:
                would_delete.append(backup)

        if would_delete:
            rprint(f"[yellow]Would delete {len(would_delete)} old backups:[/yellow]")
            for backup in would_delete:
                rprint(f"  - {backup['filename']}")
        else:
            rprint("[green]No old backups to delete[/green]")

@cli.command()
@click.argument('source_env', type=click.Choice(['local', 'staging', 'production']))
@click.argument('target_env', type=click.Choice(['local', 'staging', 'production']))
@click.option('--force', is_flag=True, help='Force migration without confirmation')
def migrate(source_env, target_env, force):
    """Migrate data from source environment to target environment"""
    if source_env == target_env:
        rprint("[red]Source and target environments cannot be the same[/red]")
        sys.exit(1)

    db_util = DatabaseBackupRestore()

    # Confirmation
    if not force:
        warning_text = f"⚠️  This will replace ALL data in {target_env} with data from {source_env}!"
        if not Confirm.ask(f"[red]{warning_text}[/red]\nContinue?"):
            rprint("[yellow]Migration cancelled[/yellow]")
            sys.exit(0)

    rprint(Panel.fit(
        f"[bold purple]Migrating data: {source_env} → {target_env}[/bold purple]",
        border_style="purple"
    ))

    # Create backup of source
    rprint("[blue]Step 1: Creating backup of source environment...[/blue]")
    backup_filename = db_util.create_backup(source_env, compression=True, verify=True)

    if not backup_filename:
        rprint("[red]❌ Failed to create source backup[/red]")
        sys.exit(1)

    # Restore to target
    rprint("[blue]Step 2: Restoring to target environment...[/blue]")
    success = db_util.restore_database(
        environment=target_env,
        backup_filename=backup_filename,
        create_safety_backup=True,
        verify_restore=True
    )

    if success:
        rprint(f"[green]✅ Migration completed: {source_env} → {target_env}[/green]")
        rprint(f"[blue]📁 Migration backup: {backup_filename}[/blue]")
    else:
        rprint("[red]❌ Migration failed[/red]")
        sys.exit(1)

@cli.command()
@click.argument('backup_file')
def verify(backup_file):
    """Verify backup file integrity"""
    db_util = DatabaseBackupRestore()

    rprint(f"[blue]Verifying backup: {backup_file}[/blue]")

    if db_util.verify_backup(backup_file):
        rprint("[green]✅ Backup verification passed[/green]")
    else:
        rprint("[red]❌ Backup verification failed[/red]")
        sys.exit(1)

@cli.command()
def config():
    """Show current database configuration"""
    db_util = DatabaseBackupRestore()

    rprint(Panel.fit(
        "[bold blue]Database Configuration[/bold blue]",
        border_style="blue"
    ))

    table = Table(title="Environment Configuration")
    table.add_column("Environment", style="cyan", no_wrap=True)
    table.add_column("Database ID", style="green")
    table.add_column("Database Name", style="yellow")
    table.add_column("Remote", style="magenta")
    table.add_column("Status", style="white")

    for env_name, config in db_util.database_config.items():
        db_id = config.get("id", "❌ Not Set")
        db_name = config.get("name", "Unknown")
        remote = "Yes" if config.get("remote") else "No"

        # Determine status
        if not config.get("id"):
            status = "[red]❌ Missing ID[/red]"
        else:
            status = "[green]✅ Ready[/green]"

        table.add_row(env_name, db_id, db_name, remote, status)

    console.print(table)

    # Show environment variable status
    rprint("\n[bold yellow]Environment Variables:[/bold yellow]")
    env_vars = [
        ("CLOUDFLARE_ACCOUNT_ID", CLOUDFLARE_ACCOUNT_ID),
        ("CLOUDFLARE_API_TOKEN", "***" if CLOUDFLARE_API_TOKEN else None),
        ("LOCAL_DB_ID", os.getenv('LOCAL_DB_ID')),
        ("STAGING_DB_ID", os.getenv('STAGING_DB_ID')),
        ("PRODUCTION_DB_ID", os.getenv('PRODUCTION_DB_ID'))
    ]

    for var_name, var_value in env_vars:
        if var_value:
            if var_name == "CLOUDFLARE_API_TOKEN":
                rprint(f"  ✅ {var_name}: Set (hidden)")
            else:
                # Show first 8 chars and last 4 chars for IDs
                if var_name.endswith("_ID") and len(var_value) > 12:
                    masked_value = f"{var_value[:8]}...{var_value[-4:]}"
                    rprint(f"  ✅ {var_name}: {masked_value}")
                else:
                    rprint(f"  ✅ {var_name}: {var_value}")
        else:
            rprint(f"  ❌ {var_name}: Not set")

    # Show helpful commands
    rprint("\n[bold cyan]Helpful Commands:[/bold cyan]")
    rprint("  List D1 databases: [yellow]npx wrangler d1 list[/yellow]")
    rprint("  Test connection: [yellow]npx wrangler whoami[/yellow]")
    rprint("  Show this config: [yellow]uv run scripts/db-backup-restore.py config[/yellow]")

@cli.command()
@click.argument('environment', type=click.Choice(['local', 'staging', 'production']))
def test_connection(environment):
    """Test database connection for an environment"""
    db_util = DatabaseBackupRestore()

    rprint(f"[blue]Testing connection to {environment} database...[/blue]")

    try:
        # Test basic connection
        count = db_util.get_subscriber_count(environment)

        if count >= 0:
            rprint(f"[green]✅ Connection successful![/green]")
            rprint(f"[blue]📊 Current subscriber count: {count}[/blue]")

            # Show database info
            db_config = db_util.get_database_config(environment)
            rprint(f"[yellow]🗄️ Database ID: {db_config['id']}[/yellow]")
            rprint(f"[yellow]🏷️ Database Name: {db_config['name']}[/yellow]")
            rprint(f"[yellow]🌐 Remote: {'Yes' if db_config['remote'] else 'No'}[/yellow]")
        else:
            rprint("[red]❌ Connection failed or returned invalid count[/red]")
            sys.exit(1)

    except Exception as e:
        rprint(f"[red]❌ Connection test failed: {e}[/red]")
        sys.exit(1)

@cli.command()
@click.argument('environment', type=click.Choice(['local', 'staging', 'production']))
def debug_wrangler(environment):
    """Debug wrangler output format for troubleshooting"""
    db_util = DatabaseBackupRestore()

    rprint(f"[blue]🔍 Debugging wrangler output for {environment}...[/blue]")

    try:
        db_config = db_util.get_database_config(environment)
        command = ["d1", "execute", "DB", "--env", environment]
        if db_config["remote"]:
            command.append("--remote")
        command.extend(["--command", "SELECT COUNT(*) as count FROM subscribers"])

        rprint(f"[yellow]Running command: npx wrangler {' '.join(command)}[/yellow]")

        success, stdout, stderr = db_util.run_wrangler_command(command)

        rprint(f"[blue]Success: {success}[/blue]")

        if stdout:
            rprint("[green]📤 STDOUT:[/green]")
            rprint(f"[dim]Raw length: {len(stdout)} characters[/dim]")

            # Show raw output with line numbers
            lines = stdout.split('\n')
            for i, line in enumerate(lines, 1):
                rprint(f"[dim]{i:2d}:[/dim] [yellow]'{line}'[/yellow]")

            # Show parsed analysis
            rprint("\n[blue]📊 Parsing Analysis:[/blue]")
            for i, line in enumerate(lines, 1):
                line = line.strip()
                if not line:
                    continue

                if line.isdigit():
                    rprint(f"  Line {i}: [green]Found pure number: {line}[/green]")
                elif '│' in line:
                    parts = [p.strip() for p in line.split('│')]
                    rprint(f"  Line {i}: Table format with {len(parts)} parts: {parts}")
                    for j, part in enumerate(parts):
                        if part.isdigit():
                            rprint(f"    Part {j}: [green]Found number: {part}[/green]")

        if stderr:
            rprint("[red]📥 STDERR:[/red]")
            rprint(f"[red]{stderr}[/red]")

        # Also try API method
        rprint("\n[blue]🌐 Trying API method as comparison...[/blue]")
        api_count = db_util._get_subscriber_count_via_api(environment)
        rprint(f"[green]API result: {api_count}[/green]")

    except Exception as e:
        rprint(f"[red]❌ Debug failed: {e}[/red]")
        import traceback
        rprint(f"[red]{traceback.format_exc()}[/red]")
    """Test database connection for an environment"""
    db_util = DatabaseBackupRestore()

    rprint(f"[blue]Testing connection to {environment} database...[/blue]")

    try:
        # Test basic connection
        count = db_util.get_subscriber_count(environment)

        if count >= 0:
            rprint(f"[green]✅ Connection successful![/green]")
            rprint(f"[blue]📊 Current subscriber count: {count}[/blue]")

            # Show database info
            db_config = db_util.get_database_config(environment)
            rprint(f"[yellow]🗄️ Database ID: {db_config['id']}[/yellow]")
            rprint(f"[yellow]🏷️ Database Name: {db_config['name']}[/yellow]")
            rprint(f"[yellow]🌐 Remote: {'Yes' if db_config['remote'] else 'No'}[/yellow]")
        else:
            rprint("[red]❌ Connection failed or returned invalid count[/red]")
            sys.exit(1)

    except Exception as e:
        rprint(f"[red]❌ Connection test failed: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli()