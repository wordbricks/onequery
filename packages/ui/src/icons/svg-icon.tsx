import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type IconSvgProps = Omit<
  ComponentPropsWithoutRef<"svg">,
  "children" | "viewBox"
> & {
  size?: number | string;
  title?: string;
};

export type SimpleIconData = {
  path: string;
  title: string;
};

type SvgIconAccessibilityOptions = {
  ariaHidden: IconSvgProps["aria-hidden"];
  ariaLabel: IconSvgProps["aria-label"];
  ariaLabelledBy: IconSvgProps["aria-labelledby"];
  defaultLabel: string;
  role: IconSvgProps["role"];
  title: string | undefined;
};

function isAriaHidden(value: IconSvgProps["aria-hidden"]): boolean {
  return value === true || value === "true";
}

function isAriaVisible(value: IconSvgProps["aria-hidden"]): boolean {
  return value === false || value === "false";
}

function normalizeLabel(label: string | undefined): string | undefined {
  const trimmedLabel = label?.trim();
  return trimmedLabel ? trimmedLabel : undefined;
}

export function resolveSvgIconAccessibility({
  ariaHidden,
  ariaLabel,
  ariaLabelledBy,
  defaultLabel,
  role,
  title,
}: SvgIconAccessibilityOptions) {
  const labelledBy = normalizeLabel(ariaLabelledBy);
  const explicitLabel = normalizeLabel(ariaLabel) ?? normalizeLabel(title);
  const hidden =
    isAriaHidden(ariaHidden) ||
    (!isAriaVisible(ariaHidden) && !explicitLabel && !labelledBy);

  if (hidden) {
    return {
      hidden: true,
      label: undefined,
      labelledBy: undefined,
      role: undefined,
      title: undefined,
    };
  }

  if (labelledBy) {
    return {
      hidden: false,
      label: undefined,
      labelledBy,
      role: role ?? "img",
      title: undefined,
    };
  }

  const label = explicitLabel ?? defaultLabel;

  return {
    hidden: false,
    label,
    labelledBy: undefined,
    role: role ?? "img",
    title: label,
  };
}

export type SvgIconProps = IconSvgProps & {
  children: ReactNode;
  defaultLabel: string;
  viewBox: string;
};

export function SvgIcon({
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  children,
  defaultLabel,
  role,
  size,
  title,
  viewBox,
  ...props
}: SvgIconProps) {
  const accessibility = resolveSvgIconAccessibility({
    ariaHidden,
    ariaLabel,
    ariaLabelledBy,
    defaultLabel,
    role,
    title,
  });

  return (
    <svg
      {...props}
      aria-hidden={accessibility.hidden ? true : undefined}
      aria-label={accessibility.label}
      aria-labelledby={accessibility.labelledBy}
      height={size}
      role={accessibility.role}
      viewBox={viewBox}
      width={size}
    >
      {accessibility.title ? <title>{accessibility.title}</title> : null}
      {children}
    </svg>
  );
}

export type SimpleIconSvgProps = IconSvgProps & {
  icon: SimpleIconData;
};

export function SimpleIconSvg({
  fill = "currentColor",
  icon,
  ...props
}: SimpleIconSvgProps) {
  return (
    <SvgIcon
      {...props}
      defaultLabel={icon.title}
      fill={fill}
      viewBox="0 0 24 24"
    >
      <path d={icon.path} />
    </SvgIcon>
  );
}
