import { isSourceProviderId } from "@onequery/db/server";
import type { ProviderType } from "@onequery/db/server";
import { Result } from "better-result";

import type { CliServiceResult } from "./result";
import { cliServiceErr } from "./result";

export function toCliSourceProvider(value: ProviderType): string {
  return value;
}

export function fromCliSourceProvider(
  value: string
): CliServiceResult<ProviderType> {
  if (isSourceProviderId(value)) {
    return Result.ok(value);
  }

  return cliServiceErr({
    detail: "unsupported source provider",
    key: "SOURCE_REQUEST_INVALID",
  });
}
