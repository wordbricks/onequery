import { DataSourceConnectionGuideDialog as SharedDataSourceConnectionGuideDialog } from "@onequery/ui/data-source-connection-guide-dialog";

import { APP_API_PATH } from "@/lib/api-paths";
import { getBrowserOrigin } from "@/lib/browser-origin";

import type { ProviderType } from "./data-source-provider-metadata";

interface DataSourceConnectionGuideDialogProps {
  provider: ProviderType;
}

export function DataSourceConnectionGuideDialog(
  props: DataSourceConnectionGuideDialogProps
) {
  return (
    <SharedDataSourceConnectionGuideDialog
      provider={props.provider}
      connectorBaseUrl={`${getBrowserOrigin()}${APP_API_PATH}`}
    />
  );
}
