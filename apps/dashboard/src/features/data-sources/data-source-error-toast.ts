import { toast } from "sonner";
import type { ExternalToast } from "sonner";

const MAX_DATA_SOURCE_ERROR_DESCRIPTION_LENGTH = 180;
const SENSITIVE_DATA_SOURCE_ERROR_PATTERN =
  /\b(api[-_ ]?key|authorization|bearer|cookie|password|secret|token)\b|-----BEGIN/i;

interface DataSourceErrorToastInput {
  title: string;
  description?: string | null;
  action?: ExternalToast["action"];
}

export function normalizeDataSourceErrorDescription(
  title: string,
  description?: string | null
): string | undefined {
  const trimmedDescription = description?.replaceAll(/\s+/g, " ").trim();
  if (!trimmedDescription) {
    return undefined;
  }

  if (trimmedDescription === title) {
    return undefined;
  }

  if (
    trimmedDescription.length > MAX_DATA_SOURCE_ERROR_DESCRIPTION_LENGTH ||
    SENSITIVE_DATA_SOURCE_ERROR_PATTERN.test(trimmedDescription)
  ) {
    return "Review the data source settings and try again.";
  }

  return trimmedDescription;
}

export function showDataSourceErrorToast(input: DataSourceErrorToastInput) {
  const description = normalizeDataSourceErrorDescription(
    input.title,
    input.description
  );

  return toast.error(input.title, {
    action: input.action,
    className: "max-w-[34rem]",
    closeButton: true,
    description,
    descriptionClassName: "whitespace-pre-wrap break-words",
    duration: description ? 12_000 : 8000,
    position: "top-center",
    richColors: true,
  });
}
