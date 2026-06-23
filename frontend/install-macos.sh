#!/bin/bash
# Build and install Orxa into /Applications, replacing the existing local app.

set -euo pipefail

APP_NAME="Orxa"
APP_BUNDLE_ID="com.orxa.ai"
APPLICATIONS_DIR="/Applications"
SKIP_BUILD=0
KEEP_BACKUP=1

usage() {
  cat <<EOF
Usage: ./install-macos.sh [options]

Options:
  --skip-build            Install the newest existing Tauri .app bundle.
  --app-name NAME         Installed app name. Default: Orxa.
  --applications-dir DIR  Install destination. Default: /Applications.
  --no-backup             Remove the replaced app backup after install succeeds.
  -h, --help              Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --app-name)
      APP_NAME="${2:?Missing app name}"
      shift 2
      ;;
    --applications-dir)
      APPLICATIONS_DIR="${2:?Missing applications dir}"
      shift 2
      ;;
    --no-backup)
      KEEP_BACKUP=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR"
REPO_ROOT="$(cd "$FRONTEND_DIR/.." && pwd)"

cd "$FRONTEND_DIR"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_maybe_sudo() {
  if [[ -w "$APPLICATIONS_DIR" ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

build_llama_helper() {
  if ! command_exists cargo || ! command_exists rustc; then
    echo "Rust toolchain is required to build Orxa. Install Rust, then rerun this script." >&2
    echo "Suggested installer: https://rustup.rs/" >&2
    exit 1
  fi

  local feature_args=()
  if [[ "$(uname -s)" == "Darwin" ]]; then
    feature_args=(--features metal)
  elif [[ -n "${TAURI_GPU_FEATURE:-}" && "${TAURI_GPU_FEATURE}" != "none" ]]; then
    local llama_feature="$TAURI_GPU_FEATURE"
    if [[ "$llama_feature" == "coreml" ]]; then
      llama_feature="metal"
    fi
    feature_args=(--features "$llama_feature")
  fi

  echo "Building llama-helper sidecar..."
  (cd "$REPO_ROOT" && cargo build --release -p llama-helper "${feature_args[@]}")

  local target_triple
  target_triple="$(rustc -vV | awk '/host:/ { print $2 }')"
  local source="$REPO_ROOT/target/release/llama-helper"
  local dest_dir="$FRONTEND_DIR/src-tauri/binaries"
  local dest="$dest_dir/llama-helper-$target_triple"

  if [[ ! -f "$source" ]]; then
    echo "Built llama-helper was not found at $source" >&2
    exit 1
  fi

  mkdir -p "$dest_dir"
  cp "$source" "$dest"
  chmod +x "$dest"
  echo "Copied llama-helper sidecar to $dest"
}

build_app() {
  if ! command_exists pnpm; then
    echo "pnpm is required to build Orxa." >&2
    exit 1
  fi

  build_llama_helper

  echo "Installing frontend dependencies..."
  pnpm install

  echo "Building Tauri app..."
  NO_STRIP=true pnpm run tauri:build
}

find_latest_app_bundle() {
  local search_roots=(
    "$REPO_ROOT/target"
    "$FRONTEND_DIR/src-tauri/target"
  )

  local latest=""
  for root in "${search_roots[@]}"; do
    [[ -d "$root" ]] || continue
    while IFS= read -r -d '' app_path; do
      if [[ -z "$latest" || "$app_path" -nt "$latest" ]]; then
        latest="$app_path"
      fi
    done < <(find "$root" -type d -name "*.app" -path "*/bundle/macos/*" -print0)
  done

  if [[ -z "$latest" ]]; then
    echo "No built .app bundle found. Run without --skip-build or check Tauri output." >&2
    exit 1
  fi

  echo "$latest"
}

existing_app_path() {
  local found
  found="$(find "$APPLICATIONS_DIR" -maxdepth 1 -iname "$APP_NAME.app" -print 2>/dev/null | head -n 1 || true)"
  if [[ -n "$found" ]]; then
    echo "$found"
  else
    echo "$APPLICATIONS_DIR/$APP_NAME.app"
  fi
}

quit_existing_app() {
  echo "Quitting existing Orxa app if it is running..."
  osascript -e "tell application id \"$APP_BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true

  for _ in {1..20}; do
    if ! pgrep -x "$APP_NAME" >/dev/null 2>&1; then
      return
    fi
    sleep 0.25
  done

  echo "Existing app did not quit cleanly; forcing it to stop..."
  pkill -9 -x "$APP_NAME" >/dev/null 2>&1 || true
}

install_app() {
  local source_app="$1"
  local dest_app
  dest_app="$(existing_app_path)"
  local backup_app="$APPLICATIONS_DIR/${APP_NAME}.app.backup-$(date +%Y%m%d%H%M%S)"

  echo "Installing:"
  echo "  from: $source_app"
  echo "  to:   $dest_app"

  quit_existing_app

  if [[ -d "$dest_app" ]]; then
    echo "Backing up existing app to $backup_app"
    run_maybe_sudo mv "$dest_app" "$backup_app"
  fi

  if ! run_maybe_sudo ditto "$source_app" "$dest_app"; then
    echo "Install failed." >&2
    if [[ -d "$backup_app" && ! -d "$dest_app" ]]; then
      echo "Restoring backup..."
      run_maybe_sudo mv "$backup_app" "$dest_app"
    fi
    exit 1
  fi

  run_maybe_sudo xattr -dr com.apple.quarantine "$dest_app" >/dev/null 2>&1 || true

  if [[ "$KEEP_BACKUP" -eq 0 && -d "$backup_app" ]]; then
    run_maybe_sudo rm -rf "$backup_app"
  fi

  echo "Installed $dest_app"
  echo "Launching Orxa..."
  open "$dest_app"
}

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  build_app
else
  echo "Skipping build; installing newest existing app bundle."
fi

APP_BUNDLE="$(find_latest_app_bundle)"
install_app "$APP_BUNDLE"
