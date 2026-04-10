import type { CliSanitization } from "./envelope";

const CLI_SANITIZATION_PROFILE = "default-v1";
const MARKDOWN_FENCE_LINE = /^([ \t]{0,3})(```|~~~)/;
const ROLE_OR_TOOL_SENTINEL_LINE =
  /^[ \t]{0,3}(system|developer|user|assistant|tool|function|observation|analysis|final)\s*:/i;

function sanitizeCliRemoteLine(line: string): string {
  let sanitized = line;

  if (MARKDOWN_FENCE_LINE.test(sanitized)) {
    sanitized = sanitized.replace(MARKDOWN_FENCE_LINE, "$1\\$2");
  }

  if (ROLE_OR_TOOL_SENTINEL_LINE.test(sanitized)) {
    sanitized = `[remote] ${sanitized}`;
  }

  return sanitized;
}

export function sanitizeCliRemoteText(text: string): string {
  // Comment: Biome rejects the control-character regex we would normally use here, so
  // escape the disallowed code points with an explicit character scan instead.
  const sanitizedText = Array.from(
    text.replaceAll(/\r\n?/g, "\n"),
    (character) => {
      const charCode = character.codePointAt(0);
      if (charCode === undefined) {
        return character;
      }

      if (
        charCode <= 0x08 ||
        charCode === 0x0b ||
        charCode === 0x0c ||
        (charCode >= 0x0e && charCode <= 0x1f) ||
        charCode === 0x7f
      ) {
        return `\\u${charCode.toString(16).padStart(4, "0")}`;
      }

      return character;
    }
  ).join("");

  return sanitizedText.split("\n").map(sanitizeCliRemoteLine).join("\n");
}

// Comment: the OpenAPI and CLI schema already advertise `default-v1`, so keep the
// concrete server-side profile behavior centralized here instead of drifting route by route.
export function sanitizeUndefinedableCliRemoteText(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return value;
  }

  return sanitizeCliRemoteText(value);
}

export function buildCliSanitization(
  sanitizedPaths: readonly string[] | undefined
): CliSanitization | undefined {
  if (!sanitizedPaths || sanitizedPaths.length === 0) {
    return undefined;
  }

  return {
    profile: CLI_SANITIZATION_PROFILE,
    rawAvailable: false,
    sanitizedPaths: [...sanitizedPaths],
  };
}
