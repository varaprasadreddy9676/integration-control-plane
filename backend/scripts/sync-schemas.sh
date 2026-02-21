#!/bin/bash

################################################################################
# Event Schema Sync Script
#
# Easy wrapper for syncing event schemas from MySQL to MongoDB
#
# Usage:
#   ./scripts/sync-schemas.sh                    # Interactive menu
#   ./scripts/sync-schemas.sh preview            # Dry-run preview
#   ./scripts/sync-schemas.sh apply              # Apply changes with backup
#   ./scripts/sync-schemas.sh restore            # Restore from backup
#   ./scripts/sync-schemas.sh list-backups       # List available backups
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Change to backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
cd "$BACKEND_DIR"

# Functions
print_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# List available backups
list_backups() {
    print_header "Available Backups"

    # Use MongoDB to list backups
    mongosh webhook_manager --quiet --eval "
        db.getCollectionNames()
          .filter(n => n.startsWith('event_types_backup_'))
          .sort()
          .reverse()
          .forEach((name, idx) => {
              const count = db.getCollection(name).countDocuments();
              const date = name.replace('event_types_backup_', '').replace(/_/g, ' ').replace(/-/g, ':');
              print(\`\${idx + 1}. \${name} (\${count} documents) - \${date}\`);
          });
    " 2>/dev/null || {
        print_error "Failed to list backups"
        print_info "Make sure MongoDB is running and accessible"
        exit 1
    }

    echo ""
}

# Preview changes (dry-run)
preview_changes() {
    print_header "Preview Schema Changes (Dry-Run)"

    print_info "Analyzing production events..."
    echo ""

    node scripts/sync-event-schemas.js "$@"

    echo ""
    print_info "This was a dry-run - no changes were made to MongoDB"
    print_info "To apply changes, run: $0 apply"
    echo ""
}

# Apply changes with confirmation
apply_changes() {
    print_header "Apply Schema Changes"

    print_warning "This will update MongoDB event_types collection"
    print_info "A backup will be created automatically before changes"
    echo ""

    # Show preview first
    print_info "First, let's preview the changes..."
    echo ""
    node scripts/sync-event-schemas.js "$@"

    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Ready to apply changes?${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    read -p "Type 'yes' to continue with update: " confirm

    if [ "$confirm" != "yes" ]; then
        print_warning "Update cancelled"
        exit 0
    fi

    echo ""
    print_info "Applying changes..."
    echo ""

    node scripts/sync-event-schemas.js --apply "$@"

    echo ""
    print_success "Schema sync completed!"
    echo ""
}

# Restore from backup
restore_backup() {
    print_header "Restore from Backup"

    # List backups
    echo "Available backups:"
    echo ""

    backups=$(mongosh webhook_manager --quiet --eval "
        db.getCollectionNames()
          .filter(n => n.startsWith('event_types_backup_'))
          .sort()
          .reverse()
          .forEach((name, idx) => {
              const count = db.getCollection(name).countDocuments();
              const date = name.replace('event_types_backup_', '').replace(/_/g, ' ').replace(/-/g, ':');
              print(\`\${idx + 1}. \${name} (\${count} documents)\`);
          });
    " 2>/dev/null)

    if [ -z "$backups" ]; then
        print_error "No backups found"
        exit 1
    fi

    echo "$backups"
    echo ""

    # Get backup name from user
    if [ -z "$1" ]; then
        read -p "Enter backup collection name: " backup_name
    else
        backup_name="$1"
    fi

    if [ -z "$backup_name" ]; then
        print_error "Backup name required"
        exit 1
    fi

    echo ""
    print_warning "This will restore event_types from: $backup_name"
    print_info "Current event_types will be backed up before restoration"
    echo ""

    read -p "Type 'yes' to continue with restore: " confirm

    if [ "$confirm" != "yes" ]; then
        print_warning "Restore cancelled"
        exit 0
    fi

    echo ""
    print_info "Restoring..."
    echo ""

    node scripts/restore-from-backup.js "$backup_name"

    echo ""
    print_success "Restore completed!"
    echo ""
}

# Interactive menu
interactive_menu() {
    print_header "Event Schema Sync - Interactive Menu"

    echo "What would you like to do?"
    echo ""
    echo "  1. Preview changes (dry-run, safe)"
    echo "  2. Apply changes (updates MongoDB with backup)"
    echo "  3. Restore from backup"
    echo "  4. List available backups"
    echo "  5. Custom options (advanced)"
    echo "  6. Exit"
    echo ""

    read -p "Enter choice [1-6]: " choice

    case $choice in
        1)
            preview_changes
            ;;
        2)
            apply_changes
            ;;
        3)
            restore_backup
            ;;
        4)
            list_backups
            ;;
        5)
            echo ""
            print_info "Custom Options"
            echo ""
            echo "Examples:"
            echo "  --limit 500              Sample 500 events per type"
            echo "  --threshold 0.8          80% inclusion threshold"
            echo "  --event-types TYPE1,TYPE2  Only process specific types"
            echo "  --create-missing         Auto-create new event types"
            echo ""
            read -p "Enter custom options: " custom_opts

            echo ""
            read -p "Preview or Apply? [p/a]: " mode

            if [ "$mode" = "a" ]; then
                apply_changes $custom_opts
            else
                preview_changes $custom_opts
            fi
            ;;
        6)
            print_info "Goodbye!"
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            exit 1
            ;;
    esac
}

# Main script logic
case "$1" in
    preview|dry-run)
        shift
        preview_changes "$@"
        ;;
    apply|sync)
        shift
        apply_changes "$@"
        ;;
    restore)
        shift
        restore_backup "$@"
        ;;
    list-backups|backups)
        list_backups
        ;;
    help|--help|-h)
        print_header "Event Schema Sync Script - Help"
        echo "Usage:"
        echo "  $0                          Interactive menu"
        echo "  $0 preview                  Preview changes (dry-run)"
        echo "  $0 apply                    Apply changes with backup"
        echo "  $0 restore [backup-name]    Restore from backup"
        echo "  $0 list-backups             List available backups"
        echo ""
        echo "Advanced options (preview/apply):"
        echo "  $0 preview --limit 500"
        echo "  $0 apply --threshold 0.8"
        echo "  $0 apply --event-types OP_VISIT_CREATED,APPOINTMENT_CONFIRMATION"
        echo ""
        echo "Examples:"
        echo "  $0                          # Interactive menu"
        echo "  $0 preview                  # Safe preview"
        echo "  $0 apply                    # Apply with confirmation"
        echo "  $0 restore event_types_backup_2026-02-02_14-30-25"
        echo ""
        ;;
    "")
        # No arguments - show interactive menu
        interactive_menu
        ;;
    *)
        print_error "Unknown command: $1"
        echo ""
        print_info "Run '$0 help' for usage information"
        exit 1
        ;;
esac
