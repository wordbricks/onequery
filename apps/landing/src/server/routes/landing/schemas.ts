import { z } from "zod";

export const ProductUpdatesRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email("email must be a valid email address")
    .max(320),
});

export const ContactRequestSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(200),
  email: z
    .string()
    .trim()
    .email("email must be a valid email address")
    .max(320),
  message: z.string().trim().min(1, "message is required").max(4000),
});
