import { describe, expect, it } from "vitest";

import { stringToHttpURL, stringToURL, uriComponent } from "./url";

type URLExpectation = {
  href?: string;
  protocol?: string;
  hostname?: string;
  pathname?: string;
  hash?: string;
  port?: string;
  username?: string;
  password?: string;
  searchParams?: Record<string, string>;
};

function expectURL(url: URL, expected: URLExpectation): void {
  if (expected.href !== undefined) {
    expect(url.href).toBe(expected.href);
  }

  if (expected.protocol !== undefined) {
    expect(url.protocol).toBe(expected.protocol);
  }

  if (expected.hostname !== undefined) {
    expect(url.hostname).toBe(expected.hostname);
  }

  if (expected.pathname !== undefined) {
    expect(url.pathname).toBe(expected.pathname);
  }

  if (expected.hash !== undefined) {
    expect(url.hash).toBe(expected.hash);
  }

  if (expected.port !== undefined) {
    expect(url.port).toBe(expected.port);
  }

  if (expected.username !== undefined) {
    expect(url.username).toBe(expected.username);
  }

  if (expected.password !== undefined) {
    expect(url.password).toBe(expected.password);
  }

  if (expected.searchParams !== undefined) {
    for (const [key, value] of Object.entries(expected.searchParams)) {
      expect(url.searchParams.get(key)).toBe(value);
    }
  }
}

describe("stringToURL", () => {
  it.each([
    {
      name: "decodes a standard http URL",
      input: "http://example.com",
      expected: {
        href: "http://example.com/",
        protocol: "http:",
      },
    },
    {
      name: "decodes a URL with auth, port, path, query, and hash",
      input:
        "https://user:pass@example.com:8080/path/to/resource?foo=bar&baz=qux#section",
      expected: {
        protocol: "https:",
        hostname: "example.com",
        pathname: "/path/to/resource",
        port: "8080",
        username: "user",
        password: "pass",
        hash: "#section",
        searchParams: {
          baz: "qux",
          foo: "bar",
        },
      },
    },
    {
      name: "decodes a file URL",
      input: "file:///path/to/file.txt",
      expected: {
        protocol: "file:",
        pathname: "/path/to/file.txt",
      },
    },
    {
      name: "decodes encoded path characters",
      input: "https://example.com/path%20with%20spaces",
      expected: {
        pathname: "/path%20with%20spaces",
      },
    },
  ])("$name", ({ input, expected }) => {
    const result = stringToURL.decode(input);
    expect(result).toBeInstanceOf(URL);
    expectURL(result, expected);
  });

  it.each([
    {
      name: "encodes a URL with a path",
      url: new URL("https://example.com/path"),
      expected: "https://example.com/path",
    },
    {
      name: "encodes query params",
      url: (() => {
        const value = new URL("https://example.com");
        value.searchParams.set("key", "value");
        return value;
      })(),
      expected: "https://example.com/?key=value",
    },
    {
      name: "encodes spaces in query values",
      url: (() => {
        const value = new URL("https://example.com");
        value.searchParams.set("q", "hello world");
        return value;
      })(),
      expected: "https://example.com/?q=hello+world",
    },
  ])("$name", ({ url, expected }) => {
    expect(stringToURL.encode(url)).toBe(expected);
  });

  it.each([
    {
      name: "rejects an empty string",
      input: "",
    },
    {
      name: "rejects a malformed URL",
      input: "not a url",
    },
    {
      name: "rejects a string without a protocol",
      input: "example.com",
    },
    {
      name: "rejects non-string input",
      input: 123,
    },
  ])("$name", ({ input }) => {
    // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
    const result = stringToURL.safeDecode(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-URL input on encode", () => {
    // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
    const result = stringToURL.safeEncode("https://example.com");
    expect(result.success).toBe(false);
  });
});

describe("stringToHttpURL", () => {
  it.each([
    {
      name: "decodes a valid http URL",
      input: "http://example.com",
      expected: {
        protocol: "http:",
      },
    },
    {
      name: "decodes a valid https URL",
      input: "https://example.com",
      expected: {
        protocol: "https:",
      },
    },
    {
      name: "decodes a URL with path and query",
      input: "https://api.example.com/v1/users?limit=10",
      expected: {
        hostname: "api.example.com",
        pathname: "/v1/users",
        searchParams: {
          limit: "10",
        },
      },
    },
  ])("$name", ({ input, expected }) => {
    const result = stringToHttpURL.decode(input);
    expect(result).toBeInstanceOf(URL);
    expectURL(result, expected);
  });

  it.each([
    {
      name: "encodes an http URL",
      url: new URL("http://example.com/path"),
      expected: "http://example.com/path",
    },
    {
      name: "encodes an https URL",
      url: new URL("https://secure.example.com"),
      expected: "https://secure.example.com/",
    },
  ])("$name", ({ url, expected }) => {
    expect(stringToHttpURL.encode(url)).toBe(expected);
  });

  it.each([
    {
      name: "rejects a file URL",
      input: "file:///path/to/file",
    },
    {
      name: "rejects a javascript URL",
      input: "javascript:alert(1)",
    },
  ])("$name", ({ input }) => {
    const result = stringToHttpURL.safeDecode(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-URL input on encode", () => {
    // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
    const result = stringToHttpURL.safeEncode("https://example.com");
    expect(result.success).toBe(false);
  });
});

describe("uriComponent", () => {
  it.each([
    {
      name: "decodes plain text unchanged",
      input: "hello",
      expected: "hello",
    },
    {
      name: "decodes spaces",
      input: "hello%20world",
      expected: "hello world",
    },
    {
      name: "decodes special characters",
      input: "%21%40%23%24%25",
      expected: "!@#$%",
    },
    {
      name: "decodes unicode characters",
      input: "%E4%BD%A0%E5%A5%BD",
      expected: "\u4F60\u597D",
    },
    {
      name: "decodes emoji",
      input: "%F0%9F%98%80",
      expected: "\uD83D\uDE00",
    },
    {
      name: "decodes mixed encoded and plain text",
      input: "key%3Dvalue%26other%3D123",
      expected: "key=value&other=123",
    },
    {
      name: "preserves plus signs literally",
      input: "a+b",
      expected: "a+b",
    },
    {
      name: "decodes empty string",
      input: "",
      expected: "",
    },
  ])("$name", ({ input, expected }) => {
    expect(uriComponent.decode(input)).toBe(expected);
  });

  it.each([
    {
      name: "encodes plain text unchanged",
      input: "hello",
      expected: "hello",
    },
    {
      name: "encodes spaces",
      input: "hello world",
      expected: "hello%20world",
    },
    {
      name: "encodes special characters",
      input: "!@#$%",
      expected: "!%40%23%24%25",
    },
    {
      name: "encodes unicode characters",
      input: "\u4F60\u597D",
      expected: "%E4%BD%A0%E5%A5%BD",
    },
    {
      name: "encodes emoji",
      input: "\uD83D\uDE00",
      expected: "%F0%9F%98%80",
    },
    {
      name: "encodes query string characters",
      input: "key=value&other=123",
      expected: "key%3Dvalue%26other%3D123",
    },
    {
      name: "encodes empty string",
      input: "",
      expected: "",
    },
    {
      name: "does not encode unreserved characters",
      input: "-_.~",
      expected: "-_.~",
    },
  ])("$name", ({ input, expected }) => {
    expect(uriComponent.encode(input)).toBe(expected);
  });

  it.each([
    {
      name: "rejects non-string input",
      input: 123,
    },
    {
      name: "rejects malformed percent-encoding",
      input: "%E0%A4%A",
    },
  ])("$name", ({ input }) => {
    // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
    const result = uriComponent.safeDecode(input);
    expect(result.success).toBe(false);
  });

  it.each([
    {
      name: "rejects non-string input",
      input: 123,
    },
    {
      name: "rejects lone surrogate input",
      input: "\uD800",
    },
  ])("$name", ({ input }) => {
    // @ts-expect-error Intentionally passing invalid input to verify runtime validation.
    const result = uriComponent.safeEncode(input);
    expect(result.success).toBe(false);
  });
});
