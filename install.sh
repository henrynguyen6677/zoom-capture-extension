#!/usr/bin/env bash
set -euo pipefail

# 2-Step Zoom Recording Downloader — Native Host Installer
# Usage: curl -fsSL <url> | bash -s -- <chrome_extension_id>

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <chrome_extension_id>"
  echo "Example: $0 mlhhonogkpdlokgahndkikdobjnpbgbb"
  exit 1
fi

EXT_ID="$1"
HOST_NAME="com.henry.zoomcurl"
HOST_DIR="$HOME/.config/zoom-native-host"
BINARY_NAME="zoom-native-host"
REPO="henrynguyen6677/zoom-capture-extension"
VERSION="v1.2.1"

# Detect OS + Arch
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

if [[ "$OS" != "darwin" && "$OS" != "linux" ]]; then
  echo "Unsupported OS: $OS. Use install.bat for Windows."
  exit 1
fi

DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/$BINARY_NAME-$OS-$ARCH"

# Detect manifest directory
if [[ "$OS" == "darwin" ]]; then
  MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
else
  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
fi

BINARY_PATH="$HOST_DIR/$BINARY_NAME"
MANIFEST_PATH="$MANIFEST_DIR/${HOST_NAME}.json"

echo "========================================"
echo " 2-Step Zoom Recording Downloader"
echo " Native Host Installer"
echo "========================================"
echo ""
echo "OS: $OS/$ARCH"
echo "Extension ID: $EXT_ID"
echo ""

# Create directories
mkdir -p "$HOST_DIR" "$MANIFEST_DIR"

# Download binary
echo "Downloading native host binary..."
curl -fsSL "$DOWNLOAD_URL" -o "$BINARY_PATH"
chmod +x "$BINARY_PATH"
echo "✓ Downloaded: $BINARY_PATH ($(du -h "$BINARY_PATH" | cut -f1))"

# Write manifest
cat > "$MANIFEST_PATH" <<MANIFEST
{
  "name": "${HOST_NAME}",
  "description": "Zoom recording downloader native host",
  "path": "${BINARY_PATH}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
MANIFEST
echo "✓ Manifest: $MANIFEST_PATH"

echo ""
echo "========================================"
echo " ✓ Installation complete!"
echo " Click ↻ in the extension to verify."
echo "========================================"
