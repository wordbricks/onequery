import { z } from "zod";

const EmailSchema = z
  .string()
  .trim()
  .pipe(z.email("email must be a valid email address").max(320));

export const ProductUpdatesRequestSchema = z.object({
  email: EmailSchema,
});

export const ContactRequestSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  email: EmailSchema,
  message: z.string().trim().min(1, "message is required").max(4000),
});
