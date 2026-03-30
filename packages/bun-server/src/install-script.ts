// Comment: the installer still relies on mutable latest-release tarballs.
// Keep the shell flow minimal here until the release pipeline can publish
// checksums or signatures for end-to-end artifact verification.
const RELEASE_BASE_URL =
  "https://github.com/wordbricks/onequery/releases/latest/download";

const CURL_LIKE_USER_AGENT_PATTERN = /\b(curl|wget|httpie)\b/i;

export function shouldServeInstallScript(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const url = new URL(request.url);
  if (url.pathname === "/install.sh") {
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
      headers: {
        "cache-control": "public, max-age=300",
        "content-disposition": 'inline; filename="install-onequery.sh"',
        "content-type": "text/x-shellscript; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    }
  );
}

export function createInstallScript(): string {
  return `#!/bin/sh
set -eu

RELEASE_BASE_URL="\${ONEQUERY_RELEASE_BASE_URL:-${RELEASE_BASE_URL}}"
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
need_cmd cp
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

write_launcher() {
  install_dir="$1"
  target_triple="$2"
  launcher_path="$install_dir/bin/onequery"

  mkdir -p "$install_dir/bin"
  cat > "$launcher_path" <<EOF
#!/bin/sh
set -eu
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export ONEQUERY_NPM_ROOT="\${ONEQUERY_NPM_ROOT:-$INSTALL_DIR}"
export ONEQUERY_RUNTIME_ROOT="\${ONEQUERY_RUNTIME_ROOT:-$INSTALL_DIR}"
export ONEQUERY_SERVER_EXECUTABLE="\${ONEQUERY_SERVER_EXECUTABLE:-$INSTALL_DIR/vendor/\${target_triple}/server/onequery-server}"
exec "$INSTALL_DIR/vendor/\${target_triple}/onequery/onequery" "$@"
EOF
  chmod 755 "$launcher_path"
}

platform_tag="$(resolve_platform_tag)"
target_triple="$(resolve_target_triple "$platform_tag")"
root_tarball_url="$RELEASE_BASE_URL/onequery-npm.tgz"
platform_tarball_url="$RELEASE_BASE_URL/onequery-npm-$platform_tag.tgz"
tmp_dir="$(mktemp -d "\${TMPDIR:-/tmp}/onequery-install.XXXXXX")"

cleanup() {
  rm -rf "$tmp_dir"
}

trap cleanup EXIT INT TERM

printf 'Downloading onequery for %s...\\n' "$platform_tag"
curl -fsSL "$root_tarball_url" -o "$tmp_dir/root.tgz"
curl -fsSL "$platform_tarball_url" -o "$tmp_dir/platform.tgz"

mkdir -p "$tmp_dir/root" "$tmp_dir/platform"
tar -xzf "$tmp_dir/root.tgz" -C "$tmp_dir/root"
tar -xzf "$tmp_dir/platform.tgz" -C "$tmp_dir/platform"

version="$(read_package_version "$tmp_dir/root")"
install_dir="$INSTALL_ROOT/versions/$version"
staging_dir="$INSTALL_ROOT/versions/$version.tmp.$$"

rm -rf "$staging_dir"
mkdir -p "$INSTALL_ROOT/versions" "$BIN_DIR"
cp -R "$tmp_dir/root/package" "$staging_dir"
mkdir -p "$staging_dir/vendor"
cp -R "$tmp_dir/platform/package/vendor/." "$staging_dir/vendor/"
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
