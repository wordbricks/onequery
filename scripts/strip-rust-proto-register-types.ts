import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// COMMENT: The local Buffa reference has a register_types=false option, but
// protoc-gen-buffa@0.6.0 from crates.io rejects it. Keep this normalization
// until the published tool accepts that option.
const REGISTER_TYPES_PREFIX =
  "pub fn register_types(reg: &mut ::buffa::type_registry::TypeRegistry)";
const REGISTER_TYPES_REEXPORT =
  /\n#\[doc\(inline\)\]\npub use self::__buffa::register_types;\n?/g;

async function collectRustFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        return collectRustFiles(entryPath);
      }
      if (entry.isFile() && entry.name.endsWith(".rs")) {
        return [entryPath];
      }
      return [];
    })
  );
  return files.flat();
}

function stripRegisterTypes(source: string): string {
  let output = source;
  let searchFrom = 0;

  while (true) {
    const fnStart = output.indexOf(REGISTER_TYPES_PREFIX, searchFrom);
    if (fnStart === -1) {
      return output;
    }

    const braceStart = output.indexOf(
      "{",
      fnStart + REGISTER_TYPES_PREFIX.length
    );
    if (braceStart === -1) {
      throw new Error("register_types function is missing an opening brace");
    }

    let depth = 0;
    let index = braceStart;
    for (; index < output.length; index += 1) {
      const char = output[index];
      if (char === "{") {
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          index += 1;
          break;
        }
      }
    }

    if (depth !== 0) {
      throw new Error("register_types function is missing a closing brace");
    }

    let removeStart = output.lastIndexOf("\n", fnStart - 1) + 1;
    while (removeStart > 0) {
      const previousLineEnd = removeStart - 1;
      const previousLineStart =
        output.lastIndexOf("\n", previousLineEnd - 1) + 1;
      const previousLine = output.slice(previousLineStart, previousLineEnd);
      if (!previousLine.trimStart().startsWith("///")) {
        break;
      }
      removeStart = previousLineStart;
    }

    let removeEnd = index;
    while (removeEnd < output.length && output[removeEnd] === "\n") {
      removeEnd += 1;
    }
    output = `${output.slice(0, removeStart)}${output.slice(removeEnd)}`;
    searchFrom = removeStart;
  }
}

function normalizeGeneratedRust(source: string): string {
  return stripRegisterTypes(source)
    .replace(REGISTER_TYPES_REEXPORT, "\n")
    .replace(/\n{2,}$/g, "\n");
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
  throw new Error("expected at least one generated Rust directory");
}

for (const root of roots) {
  const files = await collectRustFiles(root);
  await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, "utf8");
      const normalized = normalizeGeneratedRust(source);
      if (normalized !== source) {
        await writeFile(file, normalized);
      }
    })
  );
}
