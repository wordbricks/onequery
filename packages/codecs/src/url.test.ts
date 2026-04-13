import { describe, expect, it } from "vitest";

import { stringToHttpURL, stringToURL, uriComponent } from "./url";

function serializeURL(url: URL) {
  return {
    hash: url.hash,
    hostname: url.hostname,
    href: url.href,
    password: url.password,
    pathname: url.pathname,
    port: url.port,
    protocol: url.protocol,
    searchParams: Object.fromEntries(
      [...url.searchParams.entries()].sort(([left], [right]) =>
        left.localeCompare(right)
      )
    ),
    username: url.username,
  };
}

describe("stringToURL", () => {
  it("matches decoded URL snapshots", () => {
    expect({
      "file URL": serializeURL(stringToURL.decode("file:///path/to/file.txt")),
      "full URL": serializeURL(
        stringToURL.decode(
          "https://user:pass@example.com:8080/path/to/resource?foo=bar&baz=qux#section"
        )
      ),
    }).toMatchSnapshot();
  });

  it("matches encoded URL snapshots", () => {
    const urlWithSpaces = new URL("https://example.com");
    urlWithSpaces.searchParams.set("q", "hello world");

    expect({
      "query values with spaces": stringToURL.encode(urlWithSpaces),
      "URL with path": stringToURL.encode(new URL("https://example.com/path")),
    }).toMatchSnapshot();
  });

  it.each([
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
  it("matches decoded HTTP URL snapshots", () => {
    expect({
      "path and query": serializeURL(
        stringToHttpURL.decode("https://api.example.com/v1/users?limit=10")
      ),
    }).toMatchSnapshot();
  });

  it("matches encoded HTTP URL snapshots", () => {
    expect({
      https: stringToHttpURL.encode(new URL("https://secure.example.com")),
    }).toMatchSnapshot();
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
  it("matches decoded URI component snapshots", () => {
    expect({
      "empty string": uriComponent.decode(""),
      emoji: uriComponent.decode("%F0%9F%98%80"),
      "mixed encoded and plain text": uriComponent.decode(
        "key%3Dvalue%26other%3D123"
      ),
      "plain text unchanged": uriComponent.decode("hello"),
      "plus signs remain literal": uriComponent.decode("a+b"),
      spaces: uriComponent.decode("hello%20world"),
      "special characters": uriComponent.decode("%21%40%23%24%25"),
      "unicode characters": uriComponent.decode("%E4%BD%A0%E5%A5%BD"),
    }).toMatchSnapshot();
  });

  it("matches encoded URI component snapshots", () => {
    expect({
      "empty string": uriComponent.encode(""),
      emoji: uriComponent.encode("\uD83D\uDE00"),
      "plain text unchanged": uriComponent.encode("hello"),
      "query string characters": uriComponent.encode("key=value&other=123"),
      spaces: uriComponent.encode("hello world"),
      "special characters": uriComponent.encode("!@#$%"),
      "unicode characters": uriComponent.encode("\u4F60\u597D"),
      "unreserved characters": uriComponent.encode("-_.~"),
    }).toMatchSnapshot();
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
