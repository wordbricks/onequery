import { describe, expect, it } from "vitest";

import { stringToHttpURL, stringToURL, uriComponent } from "./url";

describe("stringToURL", () => {
  describe("decode (string -> URL)", () => {
    it("should decode valid http URL", () => {
      const result = stringToURL.decode("http://example.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.href).toBe("http://example.com/");
    });

    it("should decode valid https URL", () => {
      const result = stringToURL.decode("https://example.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.protocol).toBe("https:");
    });

    it("should decode URL with path", () => {
      const result = stringToURL.decode("https://example.com/path/to/resource");
      expect(result.pathname).toBe("/path/to/resource");
    });

    it("should decode URL with query parameters", () => {
      const result = stringToURL.decode("https://example.com?foo=bar&baz=qux");
      expect(result.searchParams.get("foo")).toBe("bar");
      expect(result.searchParams.get("baz")).toBe("qux");
    });

    it("should decode URL with hash fragment", () => {
      const result = stringToURL.decode("https://example.com#section");
      expect(result.hash).toBe("#section");
    });

    it("should decode URL with port", () => {
      const result = stringToURL.decode("https://example.com:8080");
      expect(result.port).toBe("8080");
    });

    it("should decode URL with username and password", () => {
      const result = stringToURL.decode("https://user:pass@example.com");
      expect(result.username).toBe("user");
      expect(result.password).toBe("pass");
    });

    it("should decode file:// URL", () => {
      const result = stringToURL.decode("file:///path/to/file.txt");
      expect(result.protocol).toBe("file:");
      expect(result.pathname).toBe("/path/to/file.txt");
    });

    it("should decode ftp:// URL", () => {
      const result = stringToURL.decode("ftp://ftp.example.com/file.txt");
      expect(result.protocol).toBe("ftp:");
    });

    it("should decode URL with encoded characters", () => {
      const result = stringToURL.decode(
        "https://example.com/path%20with%20spaces"
      );
      expect(result.pathname).toBe("/path%20with%20spaces");
    });

    it("should decode URL with international domain", () => {
      const result = stringToURL.decode("https://xn--e1afmkfd.xn--p1ai/");
      expect(result).toBeInstanceOf(URL);
    });
  });

  describe("encode (URL -> string)", () => {
    it("should encode URL to string", () => {
      const url = new URL("https://example.com/path");
      const result = stringToURL.encode(url);
      expect(result).toBe("https://example.com/path");
    });

    it("should encode URL with query params", () => {
      const url = new URL("https://example.com");
      url.searchParams.set("key", "value");
      const result = stringToURL.encode(url);
      expect(result).toBe("https://example.com/?key=value");
    });

    it("should encode URL with special characters in query", () => {
      const url = new URL("https://example.com");
      url.searchParams.set("q", "hello world");
      const result = stringToURL.encode(url);
      expect(result).toContain("q=hello+world");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip simple URL", () => {
      const original = "https://example.com/";
      const decoded = stringToURL.decode(original);
      const encoded = stringToURL.encode(decoded);
      expect(encoded).toBe(original);
    });

    it("should roundtrip complex URL", () => {
      const original = "https://user:pass@example.com:8080/path?q=test#hash";
      const decoded = stringToURL.decode(original);
      const encoded = stringToURL.encode(decoded);
      expect(encoded).toBe(original);
    });
  });

  describe("validation (decode)", () => {
    it("should fail on empty string", () => {
      const result = stringToURL.safeDecode("");
      expect(result.success).toBe(false);
    });

    it("should fail on invalid URL", () => {
      const result = stringToURL.safeDecode("not a url");
      expect(result.success).toBe(false);
    });

    it("should fail on URL without protocol", () => {
      const result = stringToURL.safeDecode("example.com");
      expect(result.success).toBe(false);
    });

    it("should fail on non-string input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = stringToURL.safeDecode(123);
      expect(result.success).toBe(false);
    });
  });

  describe("validation (encode)", () => {
    it("should fail on non-URL input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = stringToURL.safeEncode("https://example.com");
      expect(result.success).toBe(false);
    });

    it("should fail on plain object", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = stringToURL.safeEncode({
        href: "https://example.com",
      });
      expect(result.success).toBe(false);
    });
  });
});

describe("stringToHttpURL", () => {
  describe("decode (string -> URL)", () => {
    it("should decode valid http URL", () => {
      const result = stringToHttpURL.decode("http://example.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.protocol).toBe("http:");
    });

    it("should decode valid https URL", () => {
      const result = stringToHttpURL.decode("https://example.com");
      expect(result).toBeInstanceOf(URL);
      expect(result.protocol).toBe("https:");
    });

    it("should decode URL with full path and query", () => {
      const result = stringToHttpURL.decode(
        "https://api.example.com/v1/users?limit=10"
      );
      expect(result.hostname).toBe("api.example.com");
      expect(result.pathname).toBe("/v1/users");
      expect(result.searchParams.get("limit")).toBe("10");
    });
  });

  describe("encode (URL -> string)", () => {
    it("should encode http URL to string", () => {
      const url = new URL("http://example.com/path");
      const result = stringToHttpURL.encode(url);
      expect(result).toBe("http://example.com/path");
    });

    it("should encode https URL to string", () => {
      const url = new URL("https://secure.example.com");
      const result = stringToHttpURL.encode(url);
      expect(result).toBe("https://secure.example.com/");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip http URL", () => {
      const original = "http://example.com/api";
      const decoded = stringToHttpURL.decode(original);
      const encoded = stringToHttpURL.encode(decoded);
      expect(encoded).toBe(original);
    });

    it("should roundtrip https URL", () => {
      const original = "https://example.com/";
      const decoded = stringToHttpURL.decode(original);
      const encoded = stringToHttpURL.encode(decoded);
      expect(encoded).toBe(original);
    });
  });

  describe("validation (decode)", () => {
    it("should fail on file:// URL", () => {
      const result = stringToHttpURL.safeDecode("file:///path/to/file");
      expect(result.success).toBe(false);
    });

    it("should fail on ftp:// URL", () => {
      const result = stringToHttpURL.safeDecode("ftp://ftp.example.com");
      expect(result.success).toBe(false);
    });

    it("should fail on empty string", () => {
      const result = stringToHttpURL.safeDecode("");
      expect(result.success).toBe(false);
    });

    it("should fail on invalid URL", () => {
      const result = stringToHttpURL.safeDecode("not-a-url");
      expect(result.success).toBe(false);
    });

    it("should fail on javascript: URL", () => {
      const result = stringToHttpURL.safeDecode("javascript:alert(1)");
      expect(result.success).toBe(false);
    });

    it("should fail on data: URL", () => {
      const result = stringToHttpURL.safeDecode("data:text/plain,hello");
      expect(result.success).toBe(false);
    });
  });

  describe("validation (encode)", () => {
    it("should fail on non-URL input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = stringToHttpURL.safeEncode("https://example.com");
      expect(result.success).toBe(false);
    });
  });
});

describe("uriComponent", () => {
  describe("decode (encoded string -> decoded string)", () => {
    it("should decode simple string unchanged", () => {
      const result = uriComponent.decode("hello");
      expect(result).toBe("hello");
    });

    it("should decode space encoded as %20", () => {
      const result = uriComponent.decode("hello%20world");
      expect(result).toBe("hello world");
    });

    it("should decode special characters", () => {
      const result = uriComponent.decode("%21%40%23%24%25");
      expect(result).toBe("!@#$%");
    });

    it("should decode unicode characters", () => {
      const result = uriComponent.decode("%E4%BD%A0%E5%A5%BD");
      expect(result).toBe("\u4F60\u597D");
    });

    it("should decode emoji", () => {
      const result = uriComponent.decode("%F0%9F%98%80");
      expect(result).toBe("\uD83D\uDE00");
    });

    it("should decode mixed encoded and plain text", () => {
      const result = uriComponent.decode("key%3Dvalue%26other%3D123");
      expect(result).toBe("key=value&other=123");
    });

    it("should decode empty string", () => {
      const result = uriComponent.decode("");
      expect(result).toBe("");
    });

    it("should decode plus sign literally (not as space)", () => {
      const result = uriComponent.decode("a+b");
      expect(result).toBe("a+b");
    });

    it("should decode slash", () => {
      const result = uriComponent.decode("%2F");
      expect(result).toBe("/");
    });

    it("should decode question mark", () => {
      const result = uriComponent.decode("%3F");
      expect(result).toBe("?");
    });

    it("should decode ampersand", () => {
      const result = uriComponent.decode("%26");
      expect(result).toBe("&");
    });

    it("should decode equals sign", () => {
      const result = uriComponent.decode("%3D");
      expect(result).toBe("=");
    });
  });

  describe("encode (plain string -> encoded string)", () => {
    it("should encode simple string unchanged", () => {
      const result = uriComponent.encode("hello");
      expect(result).toBe("hello");
    });

    it("should encode space as %20", () => {
      const result = uriComponent.encode("hello world");
      expect(result).toBe("hello%20world");
    });

    it("should encode special characters", () => {
      const result = uriComponent.encode("!@#$%");
      expect(result).toBe("!%40%23%24%25");
    });

    it("should encode unicode characters", () => {
      const result = uriComponent.encode("\u4F60\u597D");
      expect(result).toBe("%E4%BD%A0%E5%A5%BD");
    });

    it("should encode emoji", () => {
      const result = uriComponent.encode("\uD83D\uDE00");
      expect(result).toBe("%F0%9F%98%80");
    });

    it("should encode query string characters", () => {
      const result = uriComponent.encode("key=value&other=123");
      expect(result).toBe("key%3Dvalue%26other%3D123");
    });

    it("should encode empty string", () => {
      const result = uriComponent.encode("");
      expect(result).toBe("");
    });

    it("should encode slash", () => {
      const result = uriComponent.encode("/");
      expect(result).toBe("%2F");
    });

    it("should encode question mark", () => {
      const result = uriComponent.encode("?");
      expect(result).toBe("%3F");
    });

    it("should not encode alphanumeric", () => {
      const result = uriComponent.encode("abc123XYZ");
      expect(result).toBe("abc123XYZ");
    });

    it("should not encode unreserved characters", () => {
      const result = uriComponent.encode("-_.~");
      expect(result).toBe("-_.~");
    });
  });

  describe("roundtrip", () => {
    it("should roundtrip simple text", () => {
      const original = "hello world";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should roundtrip special characters", () => {
      const original = "name=John Doe&age=30";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should roundtrip unicode", () => {
      const original = "\u4F60\u597D\u4E16\u754C";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should roundtrip emoji", () => {
      const original = "\uD83D\uDE00\uD83C\uDF89\uD83D\uDC4D";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should roundtrip empty string", () => {
      const original = "";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });

    it("should roundtrip complex URL query", () => {
      const original = "search=foo bar&filter[status]=active&page=1";
      const encoded = uriComponent.encode(original);
      const decoded = uriComponent.decode(encoded);
      expect(decoded).toBe(original);
    });
  });

  describe("validation (decode)", () => {
    it("should fail on non-string input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeDecode(123);
      expect(result.success).toBe(false);
    });

    it("should fail on null input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeDecode(null);
      expect(result.success).toBe(false);
    });

    it("should fail on undefined input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeDecode(undefined);
      expect(result.success).toBe(false);
    });

    it("should fail on malformed percent-encoding instead of throwing", () => {
      const result = uriComponent.safeDecode("%E0%A4%A");
      expect(result.success).toBe(false);
    });
  });

  describe("validation (encode)", () => {
    it("should fail on non-string input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeEncode(123);
      expect(result.success).toBe(false);
    });

    it("should fail on array input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeEncode(["a", "b"]);
      expect(result.success).toBe(false);
    });

    it("should fail on object input", () => {
      // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
      const result = uriComponent.safeEncode({
        key: "value",
      });
      expect(result.success).toBe(false);
    });

    it("should fail on lone surrogate input instead of throwing", () => {
      const result = uriComponent.safeEncode("\uD800");
      expect(result.success).toBe(false);
    });
  });
});
