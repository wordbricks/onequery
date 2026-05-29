import { handle } from "@astrojs/cloudflare/handler";
import {
  addVaryAccept,
  createNegotiatedMarkdownResponse,
} from "@onequery/astro-markdown-for-agents/cloudflare";

export default {
  async fetch(request, env, context) {
    const markdownResponse = await createNegotiatedMarkdownResponse({
      assets: env.ASSETS,
      request,
    });

    if (markdownResponse) {
      return markdownResponse;
    }

    const response = await handle(request, env, context);
    const headers = new Headers(response.headers);
    addVaryAccept(headers);

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
