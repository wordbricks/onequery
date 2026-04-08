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

    expect(response.headers.get("content-type")).toContain(
      "text/x-shellscript"
    );
    await expect(response.text()).resolves.toContain(
      'root_tarball_url="$RELEASE_BASE_URL/onequery-npm.tgz"'
    );
  });

  it("builds an installer that links the packaged runtime and binary", () => {
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
    expect(script).not.toContain("export ONEQUERY_SERVER_EXECUTABLE=");
  });
});
