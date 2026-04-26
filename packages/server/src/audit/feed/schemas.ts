import { z } from "zod";

// Comment: projection rows retain richer preview state than the public feed
// contract exposes, so storage and API schemas stay separate here.
export const QueryActionProjectionPreviewSchema = z
  .object({
    elapsedMs: z.number().int().nullable(),
    errorDetail: z.string().nullable(),
    errorHint: z.string().nullable(),
    queryText: z.string(),
    rowCount: z.number().int().nullable(),
    usageRecordingStatus: z.enum(["not_started", "succeeded", "failed"]),
    validatedQuery: z.string().nullable(),
  })
  .strict();
export type QueryActionProjectionPreview = z.infer<
  typeof QueryActionProjectionPreviewSchema
>;

export const SourceApiActionProjectionPreviewSchema = z
  .object({
    attemptNumber: z.number().int().nullable(),
    errorDetail: z.string().nullable(),
    httpStatus: z.number().int().nullable(),
    invokeMode: z.enum(["preview_only", "execute"]).nullable(),
    method: z.string().nullable(),
    operation: z.string().nullable(),
    pageCount: z.number().int().nullable(),
    responseBytes: z.number().int().nullable(),
    selector: z.string().nullable(),
  })
  .strict();
export type SourceApiActionProjectionPreview = z.infer<
  typeof SourceApiActionProjectionPreviewSchema
>;
