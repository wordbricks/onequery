import { access, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
]);

function printUsage(): void {
  console.log(`
Usage:
  bun scripts/upload-image.ts <image-path>

Uploads an image to 0x0.st (open source, privacy-first) and returns the URL.
The URL can be used in PR descriptions, issue comments, README files, etc.

Note: Files are retained 30 days to 1 year depending on size.

Supported formats: ${[...SUPPORTED_EXTENSIONS].join(", ")}

Examples:
  bun scripts/upload-image.ts screenshot.png
  bun scripts/upload-image.ts ./docs/images/demo.gif
`);
}

async function validateFile(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const ext = extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    console.error(
      `Error: Unsupported file type '${ext}'. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`
    );
    process.exit(1);
  }
}

async function uploadTo0x0(filePath: string): Promise<string> {
  const fileContent = await readFile(filePath);
  const formData = new FormData();
  formData.append("file", new Blob([fileContent]), basename(filePath));

  const response = await fetch("https://0x0.st", {
    body: formData,
    headers: { "User-Agent": "upload-image/1.0" },
    method: "POST",
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Error: Upload failed with status ${response.status}${errorText ? `: ${errorText.trim()}` : ""}`
    );
    process.exit(1);
  }

  const url = (await response.text()).trim();
  if (!url.startsWith("https://0x0.st/")) {
    console.error(`Error: Unexpected response: ${url}`);
    process.exit(1);
  }

  return url;
}

async function main(): Promise<void> {
  const [filePath] = process.argv.slice(2);

  if (filePath === undefined || filePath === "--help" || filePath === "-h") {
    printUsage();
    process.exit(filePath === undefined ? 1 : 0);
  }

  await validateFile(filePath);
  const url = await uploadTo0x0(filePath);
  console.log(url);
}

main();
