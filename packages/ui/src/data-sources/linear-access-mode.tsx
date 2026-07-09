import { LINEAR_ACCESS_MODES } from "@onequery/db/credentials";
import type { LinearAccessMode } from "@onequery/db/credentials";
import { IconAt, IconEye, IconPencil } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button";

const LINEAR_ACCESS_MODE_DETAILS: Record<
  LinearAccessMode,
  { label: string; icon: ReactNode }
> = {
  mention: { icon: <IconAt size={14} />, label: "Mention" },
  read: { icon: <IconEye size={14} />, label: "Readonly" },
  read_write: { icon: <IconPencil size={14} />, label: "Read/write" },
};

export const LINEAR_ACCESS_MODE_OPTIONS = LINEAR_ACCESS_MODES.map((value) => ({
  value,
  ...LINEAR_ACCESS_MODE_DETAILS[value],
}));

export type { LinearAccessMode };

export function getLinearAccessModeLabel(
  accessMode: LinearAccessMode | undefined
): string {
  return accessMode
    ? LINEAR_ACCESS_MODE_DETAILS[accessMode].label
    : LINEAR_ACCESS_MODE_DETAILS.read_write.label;
}

export function LinearAccessModeSelector({
  ariaLabelledBy,
  disabled,
  value,
  onChange,
}: {
  ariaLabelledBy?: string;
  disabled?: boolean;
  value: LinearAccessMode;
  onChange: (value: LinearAccessMode) => void;
}) {
  return (
    <div
      className="grid grid-cols-3 gap-1"
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
    >
      {LINEAR_ACCESS_MODE_OPTIONS.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={value === option.value ? "default" : "outline"}
          size="sm"
          className="h-8 px-2 text-xs"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </Button>
      ))}
    </div>
  );
}
