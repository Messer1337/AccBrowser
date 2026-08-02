#!/usr/bin/env bash
# OASIS Browser - Self-Hosted Mode Launcher for macOS / Linux
export OASIS_BACKEND="selfhosted"
export OASIS_SELFHOSTED_URL="http://152.53.224.55:3300"

echo "Launching OASIS Browser in Self-Hosted Mode..."
echo "Server endpoint: $OASIS_SELFHOSTED_URL"

ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ] && [ -d "dist/mac-arm64/OASIS Browser.app" ]; then
    open "dist/mac-arm64/OASIS Browser.app"
elif [ -d "dist/mac/OASIS Browser.app" ]; then
    open "dist/mac/OASIS Browser.app"
elif [ -d "dist/mac-arm64/OASIS Browser.app" ]; then
    open "dist/mac-arm64/OASIS Browser.app"
elif command -v open >/dev/null 2>&1; then
    open -a "OASIS Browser" 2>/dev/null || npm start
else
    npm start
fi

