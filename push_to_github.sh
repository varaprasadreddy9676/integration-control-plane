#!/bin/bash
# ============================================================
# Push excalidraw-skill to your GitHub
# Run this script in your terminal on your Mac:
#   bash push_to_github.sh YOUR_GITHUB_PAT
#
# Get a PAT at: https://github.com/settings/tokens
# Required scope: repo
# ============================================================

set -e

TOKEN="${1:-}"
REPO_NAME="excalidraw-skill"
GITHUB_USER="varaprasadreddy9676"

if [ -z "$TOKEN" ]; then
  echo "Usage: bash push_to_github.sh YOUR_GITHUB_PAT"
  echo ""
  echo "Get a token at: https://github.com/settings/tokens"
  echo "Required scope: repo"
  exit 1
fi

echo "→ Creating GitHub repo '$REPO_NAME'..."
RESPONSE=$(curl -s -X POST https://api.github.com/user/repos \
  -H "Authorization: token $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"Enhanced Excalidraw diagram skill for Claude Cowork\",\"private\":false}")

REPO_URL=$(echo "$RESPONSE" | grep -o '"clone_url": *"[^"]*"' | head -1 | cut -d'"' -f4)
HTML_URL=$(echo "$RESPONSE" | grep -o '"html_url": *"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$REPO_URL" ]; then
  echo "⚠ Repo may already exist or there was an error. Trying to push to existing repo..."
  REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME.git"
  HTML_URL="https://github.com/$GITHUB_USER/$REPO_NAME"
fi

echo "→ Repo: $HTML_URL"

# Create a temp working directory
TMPDIR_WORK=$(mktemp -d)
echo "→ Working in $TMPDIR_WORK"

# Copy skill files into it
mkdir -p "$TMPDIR_WORK/references"
SKILL_DIR="$(dirname "$0")"

# Try to find the skill files (check both workspace and /tmp)
SOURCE=""
if [ -d "/tmp/excalidraw" ]; then
  SOURCE="/tmp/excalidraw"
elif [ -d "$SKILL_DIR" ]; then
  SOURCE="$SKILL_DIR"
fi

if [ -n "$SOURCE" ] && [ -f "$SOURCE/SKILL.md" ]; then
  cp "$SOURCE/SKILL.md" "$TMPDIR_WORK/"
  cp "$SOURCE/README.md" "$TMPDIR_WORK/" 2>/dev/null || true
  cp "$SOURCE/references/"* "$TMPDIR_WORK/references/" 2>/dev/null || true
  echo "→ Copied skill files from $SOURCE"
else
  echo "⚠ Could not find skill source files. Please copy SKILL.md and references/ manually."
  exit 1
fi

# Init git and push
cd "$TMPDIR_WORK"
git init
git config user.email "varaprasadreddy9676@gmail.com"
git config user.name "sai"
git branch -m main
git add .
git commit -m "Add enhanced excalidraw diagram skill"

# Push with token embedded in URL
AUTH_URL=$(echo "$REPO_URL" | sed "s|https://|https://$GITHUB_USER:$TOKEN@|")
git remote add origin "$AUTH_URL"
git push -u origin main

echo ""
echo "✅ Done! Your repo is live at: $HTML_URL"

# Cleanup
cd /
rm -rf "$TMPDIR_WORK"
