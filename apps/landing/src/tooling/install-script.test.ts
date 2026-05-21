import { describe, expect, it } from "vitest";

import {
  createInstallScriptAsset,
  shouldServeInstallScriptRequest,
} from "./install-script";

describe("createInstallScriptAsset", () => {
  it("emits install.sh from the canonical runtime installer", () => {
    const asset = createInstallScriptAsset();

    expect(asset.fileName).toBe("install.sh");
    expect(asset.headers["content-type"]).toContain("text/x-shellscript");
    expect(asset.source).toContain(
      'install_bundle_url="$RELEASE_BASE_URL/onequery-install-$platform_tag.tgz"'
    );
  });
});

describe("shouldServeInstallScriptRequest", () => {
  it("matches the explicit install.sh route for GET and HEAD only", () => {
    expect(
      shouldServeInstallScriptRequest(
        new Request("https://onequery.dev/install.sh?cache=0")
      )
    ).toBe(true);
    expect(
      shouldServeInstallScriptRequest(
        new Request("https://onequery.dev/install.sh", { method: "HEAD" })
      )
    ).toBe(true);
    expect(
      shouldServeInstallScriptRequest(
        new Request("https://onequery.dev/install.sh", { method: "POST" })
      )
    ).toBe(false);
    expect(
      shouldServeInstallScriptRequest(new Request("https://onequery.dev/"))
    ).toBe(false);
  });
});
