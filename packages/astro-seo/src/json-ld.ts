import type {
  Graph,
  JsonLdObject as SchemaDtsJsonLdObject,
  Thing,
  WithContext,
} from "schema-dts";

export type JsonLdScalar = boolean | number | string;

export type SchemaOrgStructuredData<
  T extends SchemaDtsJsonLdObject | string = Thing,
> = Graph | WithContext<T>;

export type StructuredDataGraph = {
  readonly "@context": "https://schema.org";
  readonly "@graph": readonly StructuredData[];
};

export type JsonLdArray = readonly JsonLdValue[];

export type JsonLdObject = {
  readonly [key: string]: JsonLdValue | undefined;
};

export type JsonLdValue = JsonLdArray | JsonLdObject | JsonLdScalar | null;

export type StructuredData<T extends SchemaDtsJsonLdObject | string = Thing> =
  | JsonLdObject
  | StructuredDataGraph
  | SchemaOrgStructuredData<T>;

export type StructuredDataInput<
  T extends SchemaDtsJsonLdObject | string = Thing,
> = readonly StructuredData<T>[] | StructuredData<T> | null | undefined;

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

function isStructuredDataArray<
  T extends SchemaDtsJsonLdObject | string = Thing,
>(
  structuredData: StructuredDataInput<T>
): structuredData is readonly StructuredData<T>[] {
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

export function toStructuredDataItems<
  T extends SchemaDtsJsonLdObject | string = Thing,
>(structuredData: StructuredDataInput<T>): readonly StructuredData<T>[] {
  if (!structuredData) {
    return [];
  }

  if (isStructuredDataArray(structuredData)) {
    return structuredData;
  }

  return [structuredData];
}
