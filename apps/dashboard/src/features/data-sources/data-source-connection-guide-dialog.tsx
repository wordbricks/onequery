import { DataSourceConnectionGuideDialog as SharedDataSourceConnectionGuideDialog } from "@onequery/ui/data-source-connection-guide-dialog";
import type { DataSourceConnectionGuideProvider } from "@onequery/ui/data-source-connection-guides";

import { APP_API_PATH } from "@/lib/api-paths";
import { getBrowserOrigin } from "@/lib/browser-origin";
import type { SourceProviderCatalogProvider } from "@/queries/data-sources-queries";

interface DataSourceConnectionGuideDialogProps {
  provider: SourceProviderCatalogProvider;
}

export function DataSourceConnectionGuideDialog(
  props: DataSourceConnectionGuideDialogProps
) {
  return (
    <SharedDataSourceConnectionGuideDialog
      provider={props.provider.id as DataSourceConnectionGuideProvider}
      connectorBaseUrl={`${getBrowserOrigin()}${APP_API_PATH}`}
    />
  );
}
