import { z } from "zod";

export const DatabaseFormSchema = z.object({
  database: z.string().min(1, "Database name is required"),
  host: z.string().min(1, "Host is required"),
  name: z.string().min(1, "Name is required"),
  password: z.string().min(1, "Password is required"),
  port: z.number().min(1).max(65535),
  provider: z.enum(["postgres", "supabase", "motherduck", "mysql"]),
  sslMode: z.enum(["disable", "prefer", "require"]).optional(),
  username: z.string().min(1, "Username is required"),
});

export type DatabaseFormData = z.infer<typeof DatabaseFormSchema>;
