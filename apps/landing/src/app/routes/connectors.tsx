import { createFileRoute } from "@tanstack/react-router";

import { ConnectorsPage } from "../../landing/connectors/connectors-page";

export const Route = createFileRoute("/connectors")({
  component: ConnectorsPage,
  head: () => ({
    links: [
      {
        href: "https://onequery.dev/connectors",
        rel: "canonical",
      },
    ],
    meta: [
      {
        title: "OneQuery Connectors | Supported Data Sources",
      },
      {
        name: "description",
        content:
          "See the databases, warehouses, observability tools, analytics systems, and developer workflows currently supported by OneQuery.",
      },
    ],
  }),
});
