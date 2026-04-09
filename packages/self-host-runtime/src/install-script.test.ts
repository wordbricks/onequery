import { describe, expect, it } from "vitest";

import {
  createInstallScript,
  createInstallScriptResponse,
  shouldServeInstallScript,
} from "./install-script";

describe("install script surface", () => {
  it("keeps the SPA root for browser navigation", () => {
    const request = new Request("https://onequery.wordbricks.ai/", {
      headers: {
        accept: "text/html",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    expect(shouldServeInstallScript(request)).toBe(false);
  });

  it("exposes an explicit install.sh endpoint", () => {
    const request = new Request("https://onequery.wordbricks.ai/install.sh");

    expect(shouldServeInstallScript(request)).toBe(true);
  });

  it("returns a shell script response with the stable release assets", async () => {
    const response = createInstallScriptResponse(
      new Request("https://onequery.wordbricks.ai/install.sh")
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
    const script = createInstallScript();

    expect(script).toContain(
      'root_tarball_url="$RELEASE_BASE_URL/onequery-npm.tgz"'
    );
    expect(script).toContain(
      'platform_tarball_url="$RELEASE_BASE_URL/onequery-npm-$platform_tag.tgz"'
    );
    expect(script).toContain(
      'ln -sfn "$install_dir/bin/onequery" "$BIN_DIR/onequery"'
    );
    expect(script).toContain(
      "Installing managed Node.js 24.x for onequery gateway..."
    );
    expect(script).toContain(
      'if [ -z "$' +
        '{ONEQUERY_SERVER_JS_RUNTIME:-}" ] && [ -x "$managed_node_path" ]; then'
    );
    expect(script).toContain(
      'export ONEQUERY_SERVER_JS_RUNTIME="$managed_node_path"'
    );
    expect(script).not.toContain("export ONEQUERY_SERVER_EXECUTABLE=");
  });

  it("escapes launcher runtime references while baking the resolved target triple", () => {
    const script = createInstallScript();
    const dollar = "$";
    const runtimeRootDefault = `${dollar}{ONEQUERY_RUNTIME_ROOT:-$INSTALL_DIR/vendor/$TARGET_TRIPLE}`;
    const escapedTargetTriple = `\\${dollar}{target_triple}`;

    expect(script).toContain("cat <<'EOF'");
    expect(script).toContain('TARGET_TRIPLE="$target_triple"');
    expect(script).toContain(
      'INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)'
    );
    expect(script).toContain(
      `export ONEQUERY_RUNTIME_ROOT="${runtimeRootDefault}"`
    );
    expect(script).toContain(
      'exec "$INSTALL_DIR/vendor/$TARGET_TRIPLE/onequery/onequery" "$@"'
    );
    expect(script).not.toContain(
      `vendor/${escapedTargetTriple}/onequery/onequery`
    );
  });
});
