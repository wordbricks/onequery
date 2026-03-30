import { ulid } from "ulid";
import { z } from "zod";

export { ulid };

// ULID format: 26 characters using Crockford's Base32 (excludes I, L, O, U)
const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

export const ulidSchema = z.string().regex(ULID_REGEX, "Invalid ULID format");

export function isValidUlid(value: string): boolean {
  return ULID_REGEX.test(value);
}
