export type NavigationItem = {
  href: string;
  label: string;
};

export const NAVIGATION_ITEMS = [
  { href: "/", label: "Product" },
  { href: "/#demo", label: "Demo" },
  { href: "/#install", label: "Install" },
  { href: "/connectors/", label: "Connectors" },
  { href: "/blog/", label: "Blog" },
] satisfies ReadonlyArray<NavigationItem>;
