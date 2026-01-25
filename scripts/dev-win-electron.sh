#!/bin/bash
# Run Windows Electron connecting to WSL dev server
# Prerequisites: Install Electron globally on Windows: npm install -g electron
#
# Usage:
# 1. Terminal 1: npm run dev:server
# 2. Terminal 2: ./scripts/dev-win-electron.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Building Electron main/preload..."
npx electron-vite build

# Convert WSL path to Windows path
WIN_PATH=$(wslpath -w "$PROJECT_DIR")

echo "Starting Windows Electron at: $WIN_PATH"
echo "(Make sure you have Electron installed globally on Windows: npm install -g electron)"

# Use PowerShell with explicit working directory to avoid UNC path issues
# Run in background and trap Ctrl+C to kill it properly
cleanup() {
    echo ""
    echo "Stopping Electron..."
    taskkill.exe /F /IM electron.exe >/dev/null 2>&1
    kill $PS_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

powershell.exe -WorkingDirectory 'C:\' -Command "Push-Location '$WIN_PATH'; \$env:NODE_ENV='development'; electron .; Pop-Location" &
PS_PID=$!
wait $PS_PID
