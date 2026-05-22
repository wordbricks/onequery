import { describe, expect, it } from "vitest";

import {
  createInstallScriptAsset,
  createInstallScriptResponse,
  shouldServeInstallScriptRequest,
} from "./install-script";

describe("createInstallScriptAsset", () => {
  it("emits install.sh from the canonical runtime installer", () => {
    const asset = createInstallScriptAsset();

    expect(asset.fileName).toBe("install.sh");
    expect(asset.headers["content-type"]).toContain("text/x-shellscript");
    expect(asset.headers["X-Robots-Tag"]).toBe("noindex");
    expect(asset.source).toContain(
      'install_bundle_url="$RELEASE_BASE_URL/onequery-install-$platform_tag.tgz"'
    );
  });

  it("serves install.sh with noindex response metadata", async () => {
    const response = createInstallScriptResponse(
      new Request("https://onequery.dev/install.sh")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.text()).toContain(
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
