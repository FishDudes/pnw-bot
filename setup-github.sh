#!/bin/bash
# Run this ONCE in the Replit shell to connect to GitHub.
# After running it, "git push origin main" will work directly.

set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN secret is not set."
  echo "Add it via the lock icon (Secrets) in the Replit sidebar, then re-run."
  exit 1
fi

# Configure git identity
git config user.name  "FishDudes"
git config user.email "FishDudes@users.noreply.github.com"

# Remove any existing origin and add the authenticated one
git remote remove origin 2>/dev/null || true
git remote add origin "https://FishDudes:${GITHUB_TOKEN}@github.com/FishDudes/pnw-bot.git"

echo ""
echo "Git remote configured. Testing connection..."
git ls-remote origin HEAD && echo "Connection successful!" || echo "ERROR: Check your token and repo URL."
echo ""
echo "You can now run:"
echo "  git add -A && git commit -m \"Application change\" && git push origin main"
