import { ulid } from "ulid";
import { z } from "zod";

export { ulid };

export const ulidSchema = z.ulid("Invalid ULID format");
