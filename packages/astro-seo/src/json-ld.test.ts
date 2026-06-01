import { describe, expect, it } from "vitest";

import { safeJsonLdStringify, toStructuredDataItems } from "./json-ld";

describe("safeJsonLdStringify", () => {
  it("escapes script-breaking characters without changing parsed JSON values", () => {
    const item = {
      "@context": "https://schema.org",
      "@type": "Thing",
      name: 'OneQuery </script><script>alert("x")</script> & line\u2028break',
    };
    const json = safeJsonLdStringify(item);

    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script\\u003e");
    expect(json).toContain("\\u0026");
    expect(json).toContain("\\u2028");
    expect(JSON.parse(json)).toEqual(item);
  });

  it("omits null object properties from JSON-LD output", () => {
    const json = safeJsonLdStringify({
      "@context": "https://schema.org",
      "@type": "Thing",
      empty: null,
      nested: {
        keep: "value",
        omit: null,
      },
    });

    expect(JSON.parse(json)).toEqual({
      "@context": "https://schema.org",
      "@type": "Thing",
      nested: {
        keep: "value",
      },
    });
  });
});

describe("toStructuredDataItems", () => {
  it("normalizes absent, single, and array structured data inputs", () => {
    const item = {
      "@context": "https://schema.org",
      "@type": "Thing",
    };

    expect(toStructuredDataItems(null)).toEqual([]);
    expect(toStructuredDataItems(item)).toEqual([item]);
    expect(toStructuredDataItems([item])).toEqual([item]);
  });
});
