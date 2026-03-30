import { randomBytes } from "@noble/ciphers/utils.js";
import { base64UrlToBytes, base64UrlToUtf8 } from "@onequery/codecs/base64";

export type OAuthStatePayload = {
  organizationId: string;
  provider: string;
  redirectTo: string;
};

export type OAuthState = OAuthStatePayload & {
  createdAt: number;
  nonce: string;
};

export type OAuthStateValidation =
  | { valid: true; payload: OAuthState; error?: undefined }
  | { valid: false; payload?: undefined; error: string };

const DEFAULT_STATE_TTL_MS = 5 * 60 * 1000;
const MAX_STATE_TOKEN_LENGTH = 4_096;

function assertOAuthStateSecret(secret: string): void {
  if (secret.trim().length === 0) {
    throw new Error("OAuth state secret must be configured");
  }
}

function generateNonce(): string {
  const bytes = randomBytes(16);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Base64Url(
  key: string,
  message: string
): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(message)
  );
  return base64UrlToBytes.encode(new Uint8Array(signature));
}

function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  if (left.length !== right.length) {
    return false;
  }

  const result = left.reduce(
    (acc, value, index) => acc | (value ^ (right[index] ?? 0)),
    0
  );
  return result === 0;
}

/**
 * Create a signed OAuth state token.
 *
 * Format: base64url(json).base64url(hmac_sha256(secret, base64url(json)))
 *
 * The payload is NOT encrypted; treat it as public. It is only integrity
 * protected to prevent cross-org credential injection.
 */
export async function createOAuthState(
  secret: string,
  payload: OAuthStatePayload
): Promise<string> {
  assertOAuthStateSecret(secret);

  const state: OAuthState = {
    ...payload,
    createdAt: Date.now(),
    nonce: generateNonce(),
  };

  const json = JSON.stringify(state);
  const encoded = base64UrlToUtf8.encode(json);
  const signature = await hmacSha256Base64Url(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function parseOAuthState(
  secret: string,
  state: string
): Promise<OAuthState | null> {
  assertOAuthStateSecret(secret);

  if (state.length === 0 || state.length > MAX_STATE_TOKEN_LENGTH) {
    return null;
  }

  const parts = state.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;
  if (!encoded || !signature) {
    return null;
  }

  const expected = await hmacSha256Base64Url(secret, encoded);
  if (!safeEqual(signature, expected)) {
    return null;
  }

  try {
    const json = base64UrlToUtf8.decode(encoded);
    const parsed: unknown = JSON.parse(json);

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("organizationId" in parsed) ||
      typeof parsed.organizationId !== "string" ||
      !("provider" in parsed) ||
      typeof parsed.provider !== "string" ||
      !("redirectTo" in parsed) ||
      typeof parsed.redirectTo !== "string" ||
      !("createdAt" in parsed) ||
      typeof parsed.createdAt !== "number" ||
      !("nonce" in parsed) ||
      typeof parsed.nonce !== "string"
    ) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      nonce: parsed.nonce,
      organizationId: parsed.organizationId,
      provider: parsed.provider,
      redirectTo: parsed.redirectTo,
    };
  } catch {
    return null;
  }
}

export async function validateOAuthState(
  secret: string,
  state: string,
  ttlMs = DEFAULT_STATE_TTL_MS
): Promise<OAuthStateValidation> {
  assertOAuthStateSecret(secret);

  const parsed = await parseOAuthState(secret, state);
  if (!parsed) {
    return { error: "Invalid OAuth state", valid: false };
  }

  const age = Date.now() - parsed.createdAt;
  if (age > ttlMs) {
    return {
      error: `OAuth state expired (age: ${Math.round(age / 1000)}s, max: ${Math.round(ttlMs / 1000)}s)`,
      valid: false,
    };
  }

  return { payload: parsed, valid: true };
}
