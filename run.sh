#!/bin/sh
set -eu

# Railway/Linux equivalent of run.bat.
# Dependencies are installed while the Docker image is built, and the
# Playwright base image already contains Chromium.
echo "Starting apartment watcher on Railway..."
exec node main.js
