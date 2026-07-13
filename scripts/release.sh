#!/usr/bin/env bash
# grain release script — builds binaries and creates a GitHub release
# Usage: bash scripts/release.sh [version]
# Example: bash scripts/release.sh 0.3.0

set -e

REPO="skeehn/grain"
ENGRAM_REPO="skeehn/engram"
DIST="./release-dist"

bold="\033[1m"
cyan="\033[36m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

ok()   { printf "  ${green}✓${reset} %s\n" "$*"; }
step() { printf "\n${bold}%s${reset}\n" "$*"; }
fail() { printf "  ${red}✗${reset} %s\n" "$*" >&2; exit 1; }

# ── Version ──────────────────────────────────────────────────────────────────
VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  # Read from package.json
  VERSION=$(grep -m1 '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')
fi

# Bump version in config.ts and package.json if arg provided
if [ -n "$1" ]; then
  step "Bumping version to $1..."
  sed -i '' "s/GRAIN_VERSION = '[^']*'/GRAIN_VERSION = '$1'/" src/config.ts
  sed -i '' -E "0,/\"version\": \"[^\"]+\"/s//\"version\": \"$1\"/" package.json
  ok "Bumped to v$1"
fi

step "Building grain v${VERSION}..."
bun run build
ok "Build complete ($(du -sh dist/grain | cut -f1))"

# ── Prepare dist dir ─────────────────────────────────────────────────────────
rm -rf "$DIST" && mkdir -p "$DIST"

# Compile standalone executables; runtime users never need Node or Bun installed.
for platform in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  target="bun-${platform}"
  case "$platform" in *-x64) target="${target}-baseline";; esac
  bun build --compile --minify --target="$target" --outfile="${DIST}/grain-${platform}" src/cli.ts
done
ok "Standalone platform binaries created (darwin-arm64, darwin-x64, linux-arm64, linux-x64)"

# ── Checksums ────────────────────────────────────────────────────────────────
step "Generating checksums..."
cd "$DIST"
shasum -a 256 grain* > SHA256SUMS
ok "SHA256SUMS written"
cd - > /dev/null

# ── Git tag ───────────────────────────────────────────────────────────────────
step "Tagging v${VERSION}..."
git add -A
git commit -m "release: v${VERSION}" 2>/dev/null || ok "Nothing new to commit"
git tag -a "v${VERSION}" -m "grain v${VERSION}" 2>/dev/null || ok "Tag already exists"
git push origin main --follow-tags
ok "Pushed + tagged"

# ── GitHub release ────────────────────────────────────────────────────────────
step "Creating GitHub release v${VERSION}..."

# Build release notes
NOTES="## grain v${VERSION}

### Install
\`\`\`sh
curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh
\`\`\`

### Update
\`\`\`sh
grain update
\`\`\`

### What's new
$(git log --oneline $(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || echo '')..HEAD 2>/dev/null | head -20 || echo 'See commit history.')
"

gh release create "v${VERSION}" \
  --title "grain v${VERSION}" \
  --notes "$NOTES" \
  ${DIST}/grain-darwin-arm64 \
  ${DIST}/grain-darwin-x64 \
  ${DIST}/grain-linux-arm64 \
  ${DIST}/grain-linux-x64 \
  ${DIST}/SHA256SUMS \
  install.sh

ok "Release published: https://github.com/${REPO}/releases/tag/v${VERSION}"

step "Done."
printf "\n  Install URL:\n"
printf "  ${cyan}curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh${reset}\n\n"
