#!/usr/bin/env bash
# grain installer — https://github.com/skeehn/grain
# Usage: curl -fsSL https://raw.githubusercontent.com/skeehn/grain/main/install.sh | sh

set -e

REPO="skeehn/grain"
INSTALL_DIR="${GRAIN_INSTALL_DIR:-$HOME/bin}"
BINARY="grain"
ENGRAM_BINARY="engram"

# ── Colors ───────────────────────────────────────────────────────────────────
bold="\033[1m"
cyan="\033[36m"
green="\033[32m"
yellow="\033[33m"
red="\033[31m"
reset="\033[0m"

ok()   { printf "  ${green}✓${reset} %s\n" "$*"; }
warn() { printf "  ${yellow}!${reset} %s\n" "$*"; }
fail() { printf "  ${red}✗${reset} %s\n" "$*" >&2; exit 1; }
step() { printf "\n${bold}%s${reset}\n" "$*"; }

# ── Detect platform ──────────────────────────────────────────────────────────
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      fail "Unsupported OS: $os" ;;
  esac

  case "$arch" in
    x86_64)         arch="x64" ;;
    arm64|aarch64)  arch="arm64" ;;
    *)              fail "Unsupported arch: $arch" ;;
  esac

  echo "${os}-${arch}"
}

# ── Get latest release ───────────────────────────────────────────────────────
get_latest_version() {
  local version
  version=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | sed 's/.*"tag_name": *"\(.*\)".*/\1/' | head -1)
  if [ -z "$version" ]; then
    fail "Could not fetch latest release from GitHub. Check your internet connection."
  fi
  echo "$version"
}

# ── Download binary ──────────────────────────────────────────────────────────
download_binary() {
  local name="$1" version="$2" dest="$3"
  local url="https://github.com/${REPO}/releases/download/${version}/${name}"

  if ! curl -fsSL --progress-bar "$url" -o "$dest"; then
    return 1
  fi
  chmod +x "$dest"
  return 0
}

# ── Add to PATH hint ─────────────────────────────────────────────────────────
path_hint() {
  local dir="$1"
  case ":${PATH}:" in
    *":${dir}:"*) return ;;
  esac

  local shell_rc=""
  case "${SHELL}" in
    */zsh)  shell_rc="$HOME/.zshrc" ;;
    */bash) shell_rc="$HOME/.bashrc" ;;
  esac

  if [ -n "$shell_rc" ]; then
    warn "${dir} is not in your PATH."
    printf "\n  Add it with:\n\n    ${cyan}echo 'export PATH=\"${dir}:\$PATH\"' >> ${shell_rc} && source ${shell_rc}${reset}\n\n"
  else
    warn "${dir} is not in your PATH. Add it manually."
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
  printf "\n${bold}Installing grain${reset} — AI coding agent\n"
  printf "${cyan}https://github.com/${REPO}${reset}\n"

  step "Checking requirements..."
  ok "Standalone Bun executable — no Node.js runtime required"

  step "Fetching latest release..."
  local version
  version=$(get_latest_version)
  ok "Latest: ${version}"

  local platform
  platform=$(detect_platform)
  ok "Platform: ${platform}"

  # ── Create install dir ────────────────────────────────────────────────────
  mkdir -p "$INSTALL_DIR"

  # ── Download grain ────────────────────────────────────────────────────────
  step "Downloading grain..."
  local grain_dest="${INSTALL_DIR}/${BINARY}"
  local grain_asset="grain-${platform}"

  if download_binary "$grain_asset" "$version" "$grain_dest"; then
    ok "grain installed at ${grain_dest}"
  else
    fail "Could not download a standalone grain executable for ${platform}. File a bug: https://github.com/${REPO}/issues"
  fi

  # ── Download engram (optional, Rust binary) ───────────────────────────────
  step "Downloading engram (memory server)..."
  local engram_dest="${INSTALL_DIR}/${ENGRAM_BINARY}"
  local engram_asset="engram-${platform}"

  if download_binary "$engram_asset" "$version" "$engram_dest"; then
    ok "engram installed at ${engram_dest}"
  else
    warn "engram binary not available for ${platform} — grain works without it but won't have persistent memory."
    warn "Build from source: https://github.com/skeehn/engram"
  fi

  # ── PATH check ────────────────────────────────────────────────────────────
  step "Checking PATH..."
  path_hint "$INSTALL_DIR"

  # ── Run grain init ────────────────────────────────────────────────────────
  step "Setup..."
  if command -v grain >/dev/null 2>&1; then
    printf "\n  Run ${cyan}grain init${reset} to configure your AI provider.\n"
  else
    printf "\n  Run ${cyan}${grain_dest} init${reset} to configure your AI provider.\n"
  fi

  printf "\n${bold}Done.${reset}\n\n"
  printf "  ${cyan}grain --help${reset}          see all commands\n"
  printf "  ${cyan}grain init${reset}            configure provider & keys\n"
  printf "  ${cyan}grain status${reset}          verify everything works\n\n"
}

main "$@"
