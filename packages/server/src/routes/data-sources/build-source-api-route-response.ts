import type {
  SourceApiHeader,
  SourceApiResponseBody,
} from "../../source-api/types";

export function buildSourceApiRouteResponse(input: {
  body: SourceApiResponseBody;
  contentType: string;
  headers: readonly SourceApiHeader[];
  status: number;
}): Response {
  const headers = new Headers();
  for (const header of input.headers) {
    headers.set(header.name, header.value);
  }
  if (input.contentType.trim().length > 0 && !headers.has("content-type")) {
    headers.set("content-type", input.contentType);
  }

  switch (input.body.kind) {
    case "none":
      return new Response(null, {
        headers,
        status: input.status,
      });
    case "json":
      return new Response(JSON.stringify(input.body.value), {
        headers,
        status: input.status,
      });
    case "text":
      return new Response(input.body.value, {
        headers,
        status: input.status,
      });
    case "binary":
      return new Response(copyBinaryBody(input.body.value), {
        headers,
        status: input.status,
      });
  }
}

function copyBinaryBody(value: Uint8Array): ArrayBuffer {
  const copied = new Uint8Array(value.byteLength);
  copied.set(value);
  return copied.buffer;
}
