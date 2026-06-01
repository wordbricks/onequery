export type JsonLdScalar = boolean | number | string;

export type JsonLdArray = readonly JsonLdValue[];

export type JsonLdObject = {
  readonly [key: string]: JsonLdValue | undefined;
};

export type JsonLdValue = JsonLdArray | JsonLdObject | JsonLdScalar | null;

export type StructuredData = JsonLdObject;

export type StructuredDataInput =
  | readonly StructuredData[]
  | StructuredData
  | null
  | undefined;

const JSON_LD_SCRIPT_ESCAPE_PATTERN = /[<>&\u2028\u2029]/gu;

const JSON_LD_SCRIPT_ESCAPES = {
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
} as const;

function escapeJsonLdScriptCharacter(character: string) {
  return JSON_LD_SCRIPT_ESCAPES[
    character as keyof typeof JSON_LD_SCRIPT_ESCAPES
  ];
}

function omitNullValues(_key: string, value: unknown) {
  if (value === null) {
    return undefined;
  }

  if (typeof value === "bigint") {
    throw new TypeError("JSON-LD data cannot contain bigint values.");
  }

  return value;
}

function isStructuredDataArray(
  structuredData: StructuredDataInput
): structuredData is readonly StructuredData[] {
  return Array.isArray(structuredData);
}

export function safeJsonLdStringify(
  item: readonly StructuredData[] | StructuredData,
  space?: number | string
) {
  return JSON.stringify(item, omitNullValues, space).replace(
    JSON_LD_SCRIPT_ESCAPE_PATTERN,
    escapeJsonLdScriptCharacter
  );
}

export function toStructuredDataItems(
  structuredData: StructuredDataInput
): readonly StructuredData[] {
  if (!structuredData) {
    return [];
  }

  if (isStructuredDataArray(structuredData)) {
    return structuredData;
  }

  return [structuredData];
}
