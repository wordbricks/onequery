import type { CliPage } from "../read-controls-policy";

type CliSuccessEnvelope<Data> = {
  requestId: string;
  data: Data;
  warnings: string[];
  page?: CliPage;
  untrustedPaths?: string[];
  sanitization?: CliSanitization;
};

export type CliSanitization = {
  profile: string;
  sanitizedPaths: string[];
  rawAvailable: boolean;
};

type BuildCliSuccessEnvelopeInput<Data> = {
  requestId: string;
  data: Data;
  warnings?: string[];
  page?: CliPage;
  untrustedPaths?: string[];
  sanitization?: CliSanitization;
};

export function buildCliSuccessEnvelope<Data>(
  input: BuildCliSuccessEnvelopeInput<Data>
): CliSuccessEnvelope<Data> {
  const envelope: CliSuccessEnvelope<Data> = {
    data: input.data,
    requestId: input.requestId,
    warnings: input.warnings ?? [],
  };

  if (input.page) {
    envelope.page = input.page;
  }

  if (input.untrustedPaths && input.untrustedPaths.length > 0) {
    envelope.untrustedPaths = input.untrustedPaths;
  }

  if (input.sanitization) {
    envelope.sanitization = input.sanitization;
  }

  return envelope;
}
