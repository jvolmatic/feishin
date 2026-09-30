#!/usr/bin/env bash
# Build the unpacked app and register a "Custom Feishin" launcher next to the stock one.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
BIN="$ROOT/dist/linux-unpacked/feishin"

cd "$ROOT"
pnpm run build
pnpm exec electron-builder --dir

mkdir -p "$APPS_DIR" "$ICON_DIR"
cp "$ROOT/assets/icons/512x512.png" "$ICON_DIR/custom-feishin.png"

cat > "$APPS_DIR/custom-feishin.desktop" <<DESKTOP
[Desktop Entry]
Name=Custom Feishin
GenericName=Music Player
Comment=My custom build of Feishin
Exec=$BIN %U
Icon=custom-feishin
Type=Application
Categories=AudioVideo;Audio;Player;
DESKTOP

update-desktop-database "$APPS_DIR" 2>/dev/null || true
gtk-update-icon-cache -q -t "$DATA_HOME/icons/hicolor" 2>/dev/null || true
if command -v kbuildsycoca6 >/dev/null; then kbuildsycoca6 >/dev/null 2>&1 || true; fi

echo "Installed Custom Feishin -> $BIN"
