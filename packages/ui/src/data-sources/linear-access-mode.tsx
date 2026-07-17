import {
  LINEAR_ACCESS_MODES,
  LINEAR_GRAPHQL_ALLOW_LIST,
} from "@onequery/db/credentials";
import type {
  LinearAccessMode,
  LinearGraphqlAllowListItem,
} from "@onequery/db/credentials";
import { IconAt, IconEye, IconPencil } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";

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

const LINEAR_GRAPHQL_ALLOW_LIST_DETAILS: Record<
  LinearGraphqlAllowListItem,
  { label: string; mode: "read" | "write" }
> = {
  commentCreate: { label: "commentCreate", mode: "write" },
  commentUpdate: { label: "commentUpdate", mode: "write" },
  fileUpload: { label: "fileUpload", mode: "write" },
  issue: { label: "issue", mode: "read" },
  issueCreate: { label: "issueCreate", mode: "write" },
  issueUpdate: { label: "issueUpdate", mode: "write" },
  issues: { label: "issues", mode: "read" },
  labels: { label: "labels", mode: "read" },
  organization: { label: "organization", mode: "read" },
  project: { label: "project", mode: "read" },
  projects: { label: "projects", mode: "read" },
  team: { label: "team", mode: "read" },
  teams: { label: "teams", mode: "read" },
  user: { label: "user", mode: "read" },
  users: { label: "users", mode: "read" },
  viewer: { label: "viewer", mode: "read" },
};

export const LINEAR_GRAPHQL_ALLOW_LIST_OPTIONS = LINEAR_GRAPHQL_ALLOW_LIST.map(
  (value) => ({
    value,
    ...LINEAR_GRAPHQL_ALLOW_LIST_DETAILS[value],
  })
);

export type { LinearAccessMode, LinearGraphqlAllowListItem };

export function filterLinearGraphqlAllowListForAccessMode(
  accessMode: LinearAccessMode,
  value: readonly LinearGraphqlAllowListItem[]
): LinearGraphqlAllowListItem[] {
  if (accessMode === "read_write") {
    return [...value];
  }

  return value.filter(
    (item) => LINEAR_GRAPHQL_ALLOW_LIST_DETAILS[item].mode === "read"
  );
}

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

export function LinearGraphqlAllowListSelector({
  disabled,
  accessMode,
  value,
  onChange,
}: {
  disabled?: boolean;
  accessMode: LinearAccessMode;
  value: readonly LinearGraphqlAllowListItem[];
  onChange: (value: LinearGraphqlAllowListItem[]) => void;
}) {
  const selected = new Set(value);
  const writeEnabled = accessMode === "read_write";

  function toggle(item: LinearGraphqlAllowListItem) {
    const next = new Set(selected);
    if (next.has(item)) {
      next.delete(item);
    } else {
      next.add(item);
    }
    onChange(
      LINEAR_GRAPHQL_ALLOW_LIST.filter((candidate) => next.has(candidate))
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {LINEAR_GRAPHQL_ALLOW_LIST_OPTIONS.map((option) => {
        const optionDisabled =
          disabled || (option.mode === "write" && !writeEnabled);
        return (
          <label
            key={option.value}
            className="border-input bg-background flex min-h-9 items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          >
            <Checkbox
              checked={selected.has(option.value)}
              disabled={optionDisabled}
              onCheckedChange={() => toggle(option.value)}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
