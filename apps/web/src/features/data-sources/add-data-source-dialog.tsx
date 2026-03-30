import { useState } from "react";
import type { ReactElement } from "react";

import { DataSourceConnectionForm } from "@/features/data-sources/data-source-connection-form";
import type { ProviderType } from "@/features/data-sources/data-source-provider-metadata";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ui/dialog";

interface AddDataSourceDialogProps {
  children: ReactElement;
  organizationId: string;
  onSuccess?: (dataSourceId: string) => void;
  initialProvider?: ProviderType;
}

export function AddDataSourceDialog(props: AddDataSourceDialogProps) {
  const [open, setOpen] = useState(false);

  const handleSuccess = (dataSourceId: string) => {
    props.onSuccess?.(dataSourceId);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={props.children} />
      <DialogContent className="sm:max-w-[720px] max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Add Data Source</DialogTitle>
          <DialogDescription>
            Connect a data source so OneQuery can query your workspace data.
          </DialogDescription>
        </DialogHeader>

        <DataSourceConnectionForm
          organizationId={props.organizationId}
          onSuccess={handleSuccess}
          className="py-4"
          initialProvider={props.initialProvider}
        />
      </DialogContent>
    </Dialog>
  );
}
