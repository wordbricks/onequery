import { getCliOpenApiDocument as getCliContractOpenApiDocument } from "@onequery/cli-contract";

import generatedCliRoute from "../generated/cli";
import { createCliApp } from "./app";

// Comment: the Rust CLI consumes packages/cli-contract/openapi/generated/cli.openapi.json,
// so endpoint changes here must update that contract package first.
export const cliRoute = createCliApp().route("/", generatedCliRoute);

export function getCliOpenApiDocument() {
  return getCliContractOpenApiDocument();
}
