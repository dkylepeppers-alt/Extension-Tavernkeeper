#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
ST_ROOT=""
USER_HANDLE="default-user"
DRY_RUN=false

usage() {
    echo "Usage: $0 --sillytavern-root PATH [--user HANDLE] [--dry-run]"
}

while (($#)); do
    case "$1" in
        --sillytavern-root) ST_ROOT="${2:-}"; shift 2 ;;
        --user) USER_HANDLE="${2:-}"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
    esac
done

if [[ -z "$ST_ROOT" || ! -f "$ST_ROOT/config.yaml" || ! -d "$ST_ROOT/plugins" || ! -d "$ST_ROOT/data/$USER_HANDLE/extensions" ]]; then
    echo "Not a valid SillyTavern root/user: ${ST_ROOT:-<empty>} ($USER_HANDLE)" >&2
    exit 2
fi

ST_ROOT="$(cd "$ST_ROOT" && pwd -P)"
PLUGIN_DEST="$ST_ROOT/plugins/tavernkeeper-writer"
UI_DEST="$ST_ROOT/data/$USER_HANDLE/extensions/Extension-Tavernkeeper"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if $DRY_RUN; then
    echo "DRY RUN: would install Tavernkeeper UI extension to $UI_DEST"
    echo "DRY RUN: would install companion plugin to $PLUGIN_DEST"
else
    if [[ -e "$PLUGIN_DEST" ]]; then
        backup_root="$ST_ROOT/backups/_tavernkeeper-writer-plugins"
        mkdir -p "$backup_root"
        backup="$backup_root/tavernkeeper-writer-$STAMP"
        counter=0
        while [[ -e "$backup" ]]; do
            counter=$((counter + 1))
            backup="$backup_root/tavernkeeper-writer-$STAMP-$counter"
        done
        mv "$PLUGIN_DEST" "$backup"
        echo "Backed up existing companion plugin to $backup"
    fi

    plugin_stage="$ST_ROOT/plugins/.tavernkeeper-writer-stage-$$"
    ui_stage="$ST_ROOT/data/$USER_HANDLE/extensions/.Extension-Tavernkeeper-stage-$$"
    trap 'rm -rf "${plugin_stage:-}" "${ui_stage:-}"' EXIT
    mkdir -p "$plugin_stage" "$ui_stage"
    rsync -rl --delete "$SOURCE_ROOT/server-plugin/tavernkeeper-writer/" "$plugin_stage/"
    rsync -rl --delete \
        --exclude '/.git' \
        --exclude '/.worktrees/' \
        "$SOURCE_ROOT/" "$ui_stage/"
    mv "$plugin_stage" "$PLUGIN_DEST"
    rm -rf "$UI_DEST"
    mv "$ui_stage" "$UI_DEST"
    trap - EXIT
    echo "Installed Tavernkeeper UI extension to $UI_DEST"
    echo "Installed companion plugin to $PLUGIN_DEST"
fi

if rg -q '^enableServerPlugins:[[:space:]]*true([[:space:]]|$)' "$ST_ROOT/config.yaml" 2>/dev/null; then
    echo "enableServerPlugins is true. Restart SillyTavern to load the companion."
else
    echo "WARNING: enableServerPlugins is false or absent in $ST_ROOT/config.yaml; enable it explicitly, then restart SillyTavern."
fi
