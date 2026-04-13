import {
  ONEQUERY_RUNTIME_ROOT_ENV_VAR,
  getRuntimeBundleDirectoryConfig,
} from "@onequery/base/runtime-bundle";

// Comment: the installer still relies on mutable latest-release assets.
// Keep the shell flow minimal here until the release pipeline can publish
// checksums or signatures for end-to-end artifact verification.
const RELEASE_BASE_URL =
  "https://github.com/wordbricks/onequery/releases/latest/download";

const CURL_LIKE_USER_AGENT_PATTERN = /\b(curl|wget|httpie)\b/i;
const PACKAGED_CLI_DIR = getRuntimeBundleDirectoryConfig("cli").relativePath;
const MANAGED_NODE_BIN_RELATIVE_PATH = "runtime/node/bin/node";
const PACKAGED_SERVER_JS_RUNTIME_ENV_VAR = "ONEQUERY_SERVER_JS_RUNTIME";
export const INSTALL_SCRIPT_PATH = "/install.sh" as const;
export const INSTALL_SCRIPT_HEADERS = {
  "cache-control": "public, max-age=300",
  "content-disposition": 'inline; filename="install-onequery.sh"',
  "content-type": "text/x-shellscript; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export function shouldServeInstallScript(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const url = new URL(request.url);
  if (url.pathname === INSTALL_SCRIPT_PATH) {
    return true;
  }

  if (url.pathname !== "/") {
    return false;
  }

  if (url.searchParams.get("install") === "1") {
    return true;
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  if (CURL_LIKE_USER_AGENT_PATTERN.test(userAgent)) {
    return true;
  }

  const accept = request.headers.get("accept") ?? "";
  return (
    accept.includes("application/x-sh") ||
    accept.includes("application/x-shellscript") ||
    accept.includes("text/x-shellscript")
  );
}

export function createInstallScriptResponse(request: Request): Response {
  return new Response(
    request.method === "HEAD" ? null : createInstallScript(),
    {
      headers: INSTALL_SCRIPT_HEADERS,
    }
  );
}

export function createInstallScript(): string {
  return `#!/bin/sh
set -eu

RELEASE_BASE_URL="\${ONEQUERY_RELEASE_BASE_URL:-${RELEASE_BASE_URL}}"
NODE_DIST_BASE_URL="\${ONEQUERY_NODE_DIST_BASE_URL:-https://nodejs.org/dist/latest-v24.x}"
INSTALL_ROOT="\${ONEQUERY_INSTALL_ROOT:-$HOME/.local/share/onequery}"
BIN_DIR="\${ONEQUERY_BIN_DIR:-$HOME/.local/bin}"

need_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi

  printf 'onequery installer: missing required command: %s\\n' "$1" >&2
  exit 1
}

need_cmd curl
need_cmd tar
need_cmd uname
need_cmd mktemp
need_cmd sed
need_cmd chmod
need_cmd ln
need_cmd mkdir
need_cmd rm
need_cmd mv
need_cmd tr
need_cmd head
need_cmd cat

resolve_platform_tag() {
  os="$(uname -s 2>/dev/null | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m 2>/dev/null)"

  case "$os" in
    darwin)
      case "$arch" in
        arm64|aarch64) printf '%s\\n' 'darwin-arm64' ;;
        x86_64|amd64) printf '%s\\n' 'darwin-x64' ;;
        *)
          printf 'onequery installer: unsupported architecture on macOS: %s\\n' "$arch" >&2
          exit 1
          ;;
      esac
      ;;
    linux)
      case "$arch" in
        arm64|aarch64) printf '%s\\n' 'linux-arm64' ;;
        x86_64|amd64) printf '%s\\n' 'linux-x64' ;;
        *)
          printf 'onequery installer: unsupported architecture on Linux: %s\\n' "$arch" >&2
          exit 1
          ;;
      esac
      ;;
    *)
      printf 'onequery installer: unsupported operating system: %s\\n' "$os" >&2
      exit 1
      ;;
  esac
}

resolve_target_triple() {
  case "$1" in
    darwin-arm64) printf '%s\\n' 'aarch64-apple-darwin' ;;
    darwin-x64) printf '%s\\n' 'x86_64-apple-darwin' ;;
    linux-arm64) printf '%s\\n' 'aarch64-unknown-linux-musl' ;;
    linux-x64) printf '%s\\n' 'x86_64-unknown-linux-musl' ;;
    *)
      printf 'onequery installer: unsupported platform tag: %s\\n' "$1" >&2
      exit 1
      ;;
  esac
}

read_package_version() {
  package_json="$1/package/package.json"
  if [ ! -f "$package_json" ]; then
    printf 'onequery installer: extracted package is missing package.json\\n' >&2
    exit 1
  fi

  version="$(
    sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$package_json" | head -n 1
  )"

  if [ -z "$version" ]; then
    printf 'onequery installer: failed to read package version from %s\\n' "$package_json" >&2
    exit 1
  fi

  printf '%s\\n' "$version"
}

read_runtime_major_version() {
  runtime_command="$1"
  version_output="$("$runtime_command" --version 2>/dev/null || true)"

  printf '%s\\n' "$version_output" | sed -n 's/^v\\([0-9][0-9]*\\).*/\\1/p' | head -n 1
}

should_install_managed_node() {
  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  node_major_version="$(read_runtime_major_version node)"
  if [ -z "$node_major_version" ]; then
    return 0
  fi

  [ "$node_major_version" -lt 24 ]
}

resolve_managed_node_archive_suffix() {
  case "$1" in
    darwin-arm64) printf '%s\\n' 'darwin-arm64.tar.gz' ;;
    darwin-x64) printf '%s\\n' 'darwin-x64.tar.gz' ;;
    linux-arm64) printf '%s\\n' 'linux-arm64.tar.gz' ;;
    linux-x64) printf '%s\\n' 'linux-x64.tar.gz' ;;
    *)
      printf 'onequery installer: unsupported platform tag for managed Node.js: %s\\n' "$1" >&2
      exit 1
      ;;
  esac
}

resolve_managed_node_archive_name() {
  managed_node_platform_tag="$1"
  managed_node_archive_suffix="$(resolve_managed_node_archive_suffix "$managed_node_platform_tag")"
  managed_node_archive_name="$(
    curl -fsSL "$NODE_DIST_BASE_URL/SHASUMS256.txt" \
      | sed -n "s/^[[:xdigit:]]\\{64\\}[[:space:]][[:space:]]\\(node-v[^[:space:]]*-$managed_node_archive_suffix\\)$/\\1/p" \
      | head -n 1
  )"

  if [ -z "$managed_node_archive_name" ]; then
    printf 'onequery installer: failed to resolve a managed Node.js 24.x archive for %s from %s\\n' "$managed_node_platform_tag" "$NODE_DIST_BASE_URL" >&2
    exit 1
  fi

  printf '%s\\n' "$managed_node_archive_name"
}

install_managed_node() {
  managed_node_install_dir="$1"
  managed_node_platform_tag="$2"
  managed_node_archive_name="$(resolve_managed_node_archive_name "$managed_node_platform_tag")"
  managed_node_archive_path="$tmp_dir/$managed_node_archive_name"
  managed_node_extract_root="$tmp_dir/node"
  managed_node_extract_dir="\${managed_node_archive_name%.tar.gz}"
  managed_node_target_dir="$managed_node_install_dir/runtime/node"

  printf 'Installing managed Node.js 24.x for onequery gateway...\\n'
  rm -rf "$managed_node_extract_root" "$managed_node_target_dir"
  mkdir -p "$managed_node_extract_root" "$managed_node_install_dir/runtime"
  curl -fsSL "$NODE_DIST_BASE_URL/$managed_node_archive_name" -o "$managed_node_archive_path"
  tar -xzf "$managed_node_archive_path" -C "$managed_node_extract_root"

  if [ ! -x "$managed_node_extract_root/$managed_node_extract_dir/bin/node" ]; then
    printf 'onequery installer: extracted managed Node.js archive is missing bin/node\\n' >&2
    exit 1
  fi

  mv "$managed_node_extract_root/$managed_node_extract_dir" "$managed_node_target_dir"
}

write_launcher() {
  launcher_install_dir="$1"
  launcher_target_triple="$2"
  launcher_path="$launcher_install_dir/bin/onequery"

  mkdir -p "$launcher_install_dir/bin"
  {
    cat <<EOF
#!/bin/sh
set -eu
TARGET_TRIPLE="$launcher_target_triple"
EOF
    cat <<'EOF'
# Comment: the public entrypoint is symlinked from ~/.local/bin, so the
# launcher has to resolve $0 first instead of assuming it already points at the
# versioned install root.
resolve_launcher_path() {
  launcher_path="$1"

  while launcher_link="$(readlink "$launcher_path" 2>/dev/null)"; do
    launcher_dir=$(CDPATH= cd -- "$(dirname -- "$launcher_path")" && pwd)
    case "$launcher_link" in
      /*) launcher_path="$launcher_link" ;;
      *) launcher_path="$launcher_dir/$launcher_link" ;;
    esac
  done

  printf '%s\n' "$launcher_path"
}

SCRIPT_PATH="$(resolve_launcher_path "$0")"
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$SCRIPT_PATH")/.." && pwd)
export ${ONEQUERY_RUNTIME_ROOT_ENV_VAR}="\${${ONEQUERY_RUNTIME_ROOT_ENV_VAR}:-$INSTALL_DIR/vendor/$TARGET_TRIPLE}"
managed_node_path="$INSTALL_DIR/${MANAGED_NODE_BIN_RELATIVE_PATH}"
if [ -z "\${${PACKAGED_SERVER_JS_RUNTIME_ENV_VAR}:-}" ] && [ -x "$managed_node_path" ]; then
  export ${PACKAGED_SERVER_JS_RUNTIME_ENV_VAR}="$managed_node_path"
fi
exec "$INSTALL_DIR/vendor/$TARGET_TRIPLE/${PACKAGED_CLI_DIR}/onequery" "$@"
EOF
  } > "$launcher_path"
  chmod 755 "$launcher_path"
}

platform_tag="$(resolve_platform_tag)"
target_triple="$(resolve_target_triple "$platform_tag")"
install_bundle_url="$RELEASE_BASE_URL/onequery-install-$platform_tag.tgz"
tmp_dir="$(mktemp -d "\${TMPDIR:-/tmp}/onequery-install.XXXXXX")"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

printf 'Downloading onequery for %s...\\n' "$platform_tag"
curl -fsSL "$install_bundle_url" -o "$tmp_dir/install.tgz"

mkdir -p "$tmp_dir/install"
tar -xzf "$tmp_dir/install.tgz" -C "$tmp_dir/install"

package_dir="$tmp_dir/install/package"
if [ ! -d "$package_dir" ]; then
  printf 'onequery installer: extracted install bundle is missing package/\\n' >&2
  exit 1
fi

version="$(read_package_version "$tmp_dir/install")"
install_dir="$INSTALL_ROOT/versions/$version"
staging_dir="$INSTALL_ROOT/versions/$version.tmp.$$"
managed_node_required=0

if should_install_managed_node; then
  managed_node_required=1
fi

rm -rf "$staging_dir"
mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
mv "$package_dir" "$staging_dir"
if [ "$managed_node_required" -eq 1 ]; then
  install_managed_node "$staging_dir" "$platform_tag"
fi
write_launcher "$staging_dir" "$target_triple"

rm -rf "$install_dir"
mv "$staging_dir" "$install_dir"
ln -sfn "$install_dir/bin/onequery" "$BIN_DIR/onequery"

printf 'Installed onequery %s to %s\\n' "$version" "$install_dir"
printf 'Linked %s\\n' "$BIN_DIR/onequery"

case ":$PATH:" in
  *:"$BIN_DIR":*)
    ;;
  *)
    printf 'Add %s to PATH to run onequery directly.\\n' "$BIN_DIR"
    ;;
esac
`;
}
