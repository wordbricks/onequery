import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createInstallScript,
  createInstallScriptResponse,
  shouldServeInstallScript,
} from "./install-script";

async function writeExecutable(path: string, content: string): Promise<void> {
  await writeFile(path, content);
  await chmod(path, 0o755);
}

describe("install script surface", () => {
  it("keeps the SPA root for browser navigation", () => {
    const request = new Request("https://onequery.dev/", {
      headers: {
        accept: "text/html",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    expect(shouldServeInstallScript(request)).toBe(false);
  });

  it("exposes an explicit install.sh endpoint", () => {
    const request = new Request("https://onequery.dev/install.sh");

    expect(shouldServeInstallScript(request)).toBe(true);
  });

  it("returns a shell script response with the stable release assets", async () => {
    const response = createInstallScriptResponse(
      new Request("https://onequery.dev/install.sh")
    );
    const script = await response.text();

    expect(response.headers.get("content-type")).toContain(
      "text/x-shellscript"
    );
    expect(script).toContain(
      'root_tarball_url="$RELEASE_BASE_URL/onequery-npm.tgz"'
    );
    expect(script).toContain(
      'NODE_DIST_BASE_URL="$' +
        '{ONEQUERY_NODE_DIST_BASE_URL:-https://nodejs.org/dist/latest-v24.x}"'
    );
  });

  it("builds an installer that links the packaged runtime and provisions managed Node.js 24 when needed", () => {
    expect(createInstallScript()).toMatchSnapshot();
  });

  it("escapes launcher runtime references while baking the resolved target triple", () => {
    const script = createInstallScript();
    const dollar = "$";
    const runtimeRootDefault = `${dollar}{ONEQUERY_RUNTIME_ROOT:-$INSTALL_DIR/vendor/$TARGET_TRIPLE}`;
    const escapedTargetTriple = `\\${dollar}{target_triple}`;

    expect(script).toContain("cat <<'EOF'");
    expect(script).toContain('TARGET_TRIPLE="$launcher_target_triple"');
    expect(script).toContain(
      'INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)'
    );
    expect(script).toContain(
      `export ONEQUERY_RUNTIME_ROOT="${runtimeRootDefault}"`
    );
    expect(script).toContain(
      'managed_node_path="$INSTALL_DIR/runtime/node/bin/node"'
    );
    expect(script).toContain(
      'exec "$INSTALL_DIR/vendor/$TARGET_TRIPLE/onequery/onequery" "$@"'
    );
    expect(script).not.toContain(
      `vendor/${escapedTargetTriple}/onequery/onequery`
    );
  });

  it("runs under /bin/sh when managed Node.js installation is required", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "onequery-install-script-"));
    try {
      const mockBinDir = join(tempDir, "mock-bin");
      const installRoot = join(tempDir, "install-root");
      const binDir = join(tempDir, "bin");
      const shellTmpDir = join(tempDir, "tmp");
      const scriptPath = join(tempDir, "install.sh");

      await mkdir(mockBinDir, { recursive: true });
      await mkdir(installRoot, { recursive: true });
      await mkdir(binDir, { recursive: true });
      await mkdir(shellTmpDir, { recursive: true });
      await writeFile(scriptPath, createInstallScript());
      await chmod(scriptPath, 0o755);

      await writeExecutable(
        join(mockBinDir, "uname"),
        `#!/bin/sh
case "$1" in
  -s)
    printf '%s\\n' 'Darwin'
    ;;
  -m)
    printf '%s\\n' 'arm64'
    ;;
  *)
    /usr/bin/uname "$@"
    ;;
esac
`
      );

      await writeExecutable(
        join(mockBinDir, "node"),
        `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'v22.22.0'
  exit 0
fi

printf 'unexpected node invocation: %s\\n' "$*" >&2
exit 1
`
      );

      await writeExecutable(
        join(mockBinDir, "curl"),
        `#!/bin/sh
out_path=''
url=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out_path="$2"
      shift 2
      ;;
    -f|-s|-S|-L|-fsSL)
      shift
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

case "$url" in
  */SHASUMS256.txt)
    printf '%s\\n' '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  node-v24.11.0-darwin-arm64.tar.gz'
    ;;
  */onequery-npm.tgz|*/onequery-npm-darwin-arm64.tgz|*/node-v24.11.0-darwin-arm64.tar.gz)
    : > "$out_path"
    ;;
  *)
    printf 'unexpected curl url: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`
      );

      await writeExecutable(
        join(mockBinDir, "tar"),
        `#!/bin/sh
archive_path=''
extract_dir=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    -xzf)
      archive_path="$2"
      shift 2
      ;;
    -C)
      extract_dir="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

case "$(basename "$archive_path")" in
  root.tgz)
    mkdir -p "$extract_dir/package"
    cat > "$extract_dir/package/package.json" <<'EOF'
{"version":"0.1.22"}
EOF
    ;;
  platform.tgz)
    mkdir -p "$extract_dir/package/vendor/aarch64-apple-darwin/onequery"
    cat > "$extract_dir/package/vendor/aarch64-apple-darwin/onequery/onequery" <<'EOF'
#!/bin/sh
exit 0
EOF
    chmod 755 "$extract_dir/package/vendor/aarch64-apple-darwin/onequery/onequery"
    ;;
  node-v24.11.0-darwin-arm64.tar.gz)
    mkdir -p "$extract_dir/node-v24.11.0-darwin-arm64/bin"
    cat > "$extract_dir/node-v24.11.0-darwin-arm64/bin/node" <<'EOF'
#!/bin/sh
printf '%s\\n' 'v24.11.0'
EOF
    chmod 755 "$extract_dir/node-v24.11.0-darwin-arm64/bin/node"
    ;;
  *)
    printf 'unexpected tar archive: %s\\n' "$archive_path" >&2
    exit 1
    ;;
esac
`
      );

      const shellEnv = {
        ...process.env,
        HOME: tempDir,
        ONEQUERY_BIN_DIR: binDir,
        ONEQUERY_INSTALL_ROOT: installRoot,
        PATH: `${mockBinDir}:${process.env.PATH ?? ""}`,
        TMPDIR: shellTmpDir,
      };

      const result = spawnSync("/bin/sh", [scriptPath], {
        cwd: tempDir,
        encoding: "utf8",
        env: shellEnv,
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Installed onequery 0.1.22");

      const launcherPath = join(
        installRoot,
        "versions",
        "0.1.22",
        "bin",
        "onequery"
      );
      const launcher = await readFile(launcherPath, "utf8");

      expect(launcher).toContain(
        'export ONEQUERY_SERVER_JS_RUNTIME="$managed_node_path"'
      );

      const launcherSyntaxCheck = spawnSync("/bin/sh", ["-n", launcherPath], {
        cwd: tempDir,
        encoding: "utf8",
        env: shellEnv,
      });
      expect(launcherSyntaxCheck.status).toBe(0);
      expect(launcherSyntaxCheck.stderr).toBe("");

      const launcherRun = spawnSync("/bin/sh", [launcherPath], {
        cwd: tempDir,
        encoding: "utf8",
        env: shellEnv,
      });
      expect(launcherRun.status).toBe(0);
      expect(launcherRun.stderr).toBe("");

      const managedNodePath = join(
        installRoot,
        "versions",
        "0.1.22",
        "runtime",
        "node",
        "bin",
        "node"
      );
      expect(await readFile(managedNodePath, "utf8")).toContain("v24.11.0");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
