import { base64ToUtf8 } from "@onequery/codecs/base64";

export function encodeBasicAuthHeader(
  username: string,
  password: string
): string {
  return `Basic ${base64ToUtf8.encode(`${username}:${password}`)}`;
}
