import { DATA_SOURCE_NAME_DUPLICATE_CODE } from "@onequery/db/constants";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { isApiErrorWithCode } from "@/queries/api-error";

export const applyDataSourceNameConflictError = <
  TFieldValues extends FieldValues,
>(
  error: unknown,
  setError: UseFormSetError<TFieldValues>,
  fieldName: Path<TFieldValues>
): boolean => {
  if (!isApiErrorWithCode(error, DATA_SOURCE_NAME_DUPLICATE_CODE)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  setError(fieldName, { message: error.message });
  return true;
};
