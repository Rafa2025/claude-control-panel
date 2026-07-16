#!/usr/bin/env bash
# Install a desktop launcher so Claude Control Panel appears in your app menu.
# Clicking it runs scripts/launch.sh (starts the server if needed, opens the browser).
# Reverse with: scripts/install-launcher.sh --uninstall
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
APPS_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
DESKTOP_FILE="$APPS_DIR/claude-control-panel.desktop"
ICON_FILE="$ICON_DIR/claude-control-panel.svg"

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$DESKTOP_FILE" "$ICON_FILE"
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true
  echo "Removed Claude Control Panel launcher."
  exit 0
fi

mkdir -p "$APPS_DIR" "$ICON_DIR"
cp "$PROJECT_DIR/client/public/icon.svg" "$ICON_FILE"
chmod +x "$PROJECT_DIR/scripts/launch.sh"

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Claude Control Panel
Comment=Manage Claude Code skills and view agents
Exec=$PROJECT_DIR/scripts/launch.sh
Icon=$ICON_FILE
Terminal=false
Categories=Development;
StartupNotify=true
Keywords=claude;skills;agents;dashboard;
EOF

chmod +x "$DESKTOP_FILE"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS_DIR" 2>/dev/null || true

echo "Installed: $DESKTOP_FILE"
echo "Search for \"Claude Control Panel\" in your app menu, or pin it to the dock."
