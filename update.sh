#!/bin/bash
# update.sh — Rebuild runtime + sync skills from gstack source (submodule)
# Usage: bash update.sh [--skip-pull]
set -e

DEST="$(cd "$(dirname "$0")" && pwd)"
REPO="$DEST/source"
SKILLS=(gstack gstack-autoplan gstack-context-restore gstack-context-save gstack-cso gstack-design-review gstack-document-generate gstack-document-release gstack-investigate gstack-learn gstack-office-hours gstack-plan-ceo-review gstack-plan-design-review gstack-plan-devex-review gstack-plan-eng-review gstack-qa-only gstack-qa gstack-retro gstack-review gstack-scrape gstack-ship gstack-skillify gstack-spec)
BIN_SCRIPTS=(gstack-config gstack-slug gstack-update-check gstack-session-kind gstack-repo-mode gstack-learnings-search gstack-learnings-log gstack-timeline-log gstack-telemetry-log)

if [ ! -d "$REPO/.git" ] && [ ! -f "$REPO/.git" ]; then
  echo "ERROR: gstack source not found at $REPO"
  echo "Run: git submodule update --init --recursive"
  exit 1
fi

# 1. Pull latest
if [ "$1" != "--skip-pull" ]; then
  echo "==> Pulling latest gstack..."
  cd "$REPO" && git pull --ff-only origin main
else
  echo "==> Skipping pull (--skip-pull)"
fi

cd "$REPO"
VERSION=$(cat VERSION 2>/dev/null || echo "unknown")
echo "==> gstack version: $VERSION"

# 2. Detect new upstream features not yet in the extension
echo "==> Checking for new upstream features..."
NEW_FEATURES=""

# 2a. New skills in source not in our cherry-picked list
for skill_dir in "$REPO"/*/; do
  [ -f "$skill_dir/SKILL.md" ] || continue
  name=$(basename "$skill_dir")
  case "$name" in bin|browse|design|docs|extension|ios-qa|lib|make-pdf|node_modules|scripts|ship|test) continue ;; esac
  skill_id="gstack-$name"
  [ "$name" = "browse" ] && skill_id="gstack"
  found=0
  for local_skill in "${SKILLS[@]}"; do
    [ "$skill_id" = "$local_skill" ] && found=1 && break
  done
  if [ $found -eq 0 ]; then
    NEW_FEATURES="${NEW_FEATURES}\n  [skill] $skill_id"
  fi
done

# 2b. New bin scripts upstream not in our list
for script in "$REPO"/bin/gstack-*; do
  [ -f "$script" ] || continue
  name=$(basename "$script")
  found=0
  for local_bin in "${BIN_SCRIPTS[@]}"; do
    [ "$name" = "$local_bin" ] && found=1 && break
  done
  if [ $found -eq 0 ]; then
    NEW_FEATURES="${NEW_FEATURES}\n  [bin]   $name"
  fi
done

# 2c. New browse commands in source not in our allowlist
if [ -f "$REPO/browse/src/commands.ts" ]; then
  UPSTREAM_CMDS=$(grep -oP "^\s+'[\w-]+'" "$REPO/browse/src/commands.ts" 2>/dev/null | tr -d " '" | sort -u)
  LOCAL_CMDS=$(grep -oP "'[\w-]+'" "$DEST/lib/commands.generated.ts" 2>/dev/null | tr -d "'" | sort -u)
  for cmd in $UPSTREAM_CMDS; do
    if ! echo "$LOCAL_CMDS" | grep -qx "$cmd"; then
      NEW_FEATURES="${NEW_FEATURES}\n  [tool]  gstack_$cmd"
    fi
  done
fi

if [ -n "$NEW_FEATURES" ]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════╗"
  echo "║  NEW FEATURES AVAILABLE UPSTREAM — update extension!    ║"
  echo "╚══════════════════════════════════════════════════════════╝"
  echo ""
  echo "  Not yet included in gstack-pi:"
  echo -e "$NEW_FEATURES"
  echo ""
  echo "  To include new skills: add them to SKILLS= in this script"
  echo "  To include new tools:  bun run scripts/gen-tools.ts"
  echo ""
else
  echo "    No new upstream features detected."
fi

# 3. Install deps if needed
if [ ! -d node_modules ]; then
  echo "==> Installing dependencies..."
  bun install --silent
fi

# 4. Build browse binary
echo "==> Building browse binary..."
mkdir -p browse/dist
bun build --compile browse/src/cli.ts --outfile browse/dist/browse

# 5. Build Windows node server bundle
echo "==> Building node server bundle..."
bash browse/scripts/build-node-server.sh

# 6. Deploy runtime
echo "==> Deploying runtime..."
mkdir -p "$DEST/runtime/browse/dist" "$DEST/runtime/bin"
cp browse/dist/browse.exe "$DEST/runtime/browse/dist/" 2>/dev/null || cp browse/dist/browse "$DEST/runtime/browse/dist/"
cp browse/dist/server-node.mjs "$DEST/runtime/browse/dist/"
cp browse/dist/bun-polyfill.cjs "$DEST/runtime/browse/dist/"

# 7. Sync bin scripts
echo "==> Syncing bin scripts..."
for script in "${BIN_SCRIPTS[@]}"; do
  [ -f "bin/$script" ] && cp "bin/$script" "$DEST/runtime/bin/"
done

# 8. Sync skills from source
echo "==> Syncing ${#SKILLS[@]} skills..."
mkdir -p "$DEST/skills"
for skill in "${SKILLS[@]}"; do
  skill_name="${skill#gstack-}"
  [ "$skill" = "gstack" ] && skill_name="browse"
  src_dir="$REPO/$skill_name"
  if [ -f "$src_dir/SKILL.md" ]; then
    mkdir -p "$DEST/skills/$skill"
    cp "$src_dir/SKILL.md" "$DEST/skills/$skill/"
  fi
done

# 9. Verify
echo "==> Verifying..."
BINARY="$DEST/runtime/browse/dist/browse.exe"
[ ! -f "$BINARY" ] && BINARY="$DEST/runtime/browse/dist/browse"
if [ -x "$BINARY" ]; then
  echo "OK: binary at $BINARY"
else
  echo "WARNING: binary not executable at $BINARY"
fi

echo ""
echo "==> Done. gstack-pi updated to v$VERSION"
echo "    Binary: $BINARY"
echo "    Skills: ${#SKILLS[@]} synced"
echo "    Bin:    ${#BIN_SCRIPTS[@]} scripts"
