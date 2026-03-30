import cliOpenApiDocument from "../openapi/generated/cli.openapi.json";

export { cliOpenApiDocument };

export function getCliOpenApiDocument() {
  return structuredClone(cliOpenApiDocument);
}
