import { readFileSync } from "node:fs";

import { parse as parseToml } from "smol-toml";

// Comment: this module is Node-only because local TOML decoding reads from the
// filesystem.

export type TomlFileData = Record<string, unknown>;

export function readTomlFileSync(path: string): Readonly<TomlFileData> {
  try {
    const parsed = parseToml(readFileSync(path, "utf8"));

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return Object.freeze({});
    }

    return Object.freeze(parsed as TomlFileData);
  } catch (error) {
    throw new Error(
      `Failed to parse / read TOML file at ${path}: ${
        error instanceof Error ? error.message : error
      }`,
      { cause: error }
    );
  }
}
