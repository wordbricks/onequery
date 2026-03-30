const UNIQUE_VIOLATION_CODE = "23505";

const DATA_SOURCE_NAME_UNIQUE_CONSTRAINT =
  "data_sources_organization_name_unique";
export const DATA_SOURCE_NAME_CONFLICT_MESSAGE =
  "Data source name already exists";

const hasProperty = <Key extends string>(
  value: unknown,
  key: Key
): value is Record<Key, unknown> => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return key in value;
};

const getStringProperty = (value: unknown, key: string): string | null => {
  if (!hasProperty(value, key)) {
    return null;
  }

  const property = value[key];
  if (typeof property !== "string") {
    return null;
  }

  return property;
};

const isUniqueConstraintError = (
  error: unknown,
  constraintName?: string
): boolean => {
  const code = getStringProperty(error, "code");
  if (!code) {
    return false;
  }

  if (code !== UNIQUE_VIOLATION_CODE) {
    return false;
  }

  if (!constraintName) {
    return true;
  }

  const foundConstraint = getStringProperty(error, "constraint_name");
  if (!foundConstraint) {
    return true;
  }

  return foundConstraint === constraintName;
};

export const isDataSourceNameConflict = (error: unknown): boolean =>
  isUniqueConstraintError(error, DATA_SOURCE_NAME_UNIQUE_CONSTRAINT);
