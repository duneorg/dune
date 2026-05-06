/**
 * Admin nav item registry.
 * Core items are defined here; plugins append via registerNavItem() at bootstrap.
 */

import type { AdminPermission } from "./types.ts";

export interface NavItem {
  label: string;
  /** Path relative to the admin prefix, e.g. "/pages" */
  path: string;
  icon?: string;
  /** Visual group in the sidebar */
  group?: "content" | "media" | "settings" | "system" | string;
  /** If true, only admin-role users see this item */
  adminOnly?: boolean;
  /** Required permission to see this item */
  permission?: AdminPermission;
  /** Display order within the group (lower = higher) */
  order?: number;
}

const coreNavItems: NavItem[] = [
  { label: "Dashboard", path: "/", icon: "home", group: "content", order: 0 },
  { label: "Pages", path: "/pages", icon: "file-text", group: "content", order: 10, permission: "pages.read" },
  { label: "Media", path: "/media", icon: "image", group: "media", order: 20, permission: "media.read" },
  { label: "Flex Objects", path: "/flex", icon: "layers", group: "content", order: 30, permission: "pages.read" },
  { label: "Forms", path: "/submissions", icon: "inbox", group: "content", order: 40, permission: "submissions.read" },
  { label: "Translations", path: "/i18n", icon: "globe", group: "content", order: 50, permission: "pages.read" },
  { label: "Users", path: "/users", icon: "users", group: "settings", order: 60, permission: "users.read" },
  { label: "Plugins", path: "/plugins", icon: "puzzle", group: "settings", order: 70, adminOnly: true },
  { label: "Themes", path: "/themes", icon: "palette", group: "settings", order: 80, adminOnly: true },
  { label: "Marketplace", path: "/marketplace", icon: "shopping-bag", group: "settings", order: 90, adminOnly: true },
  { label: "Config", path: "/config", icon: "settings", group: "settings", order: 100, permission: "config.read" },
  { label: "Audit Log", path: "/audit", icon: "shield", group: "system", order: 110, adminOnly: true },
  { label: "Metrics", path: "/metrics", icon: "bar-chart", group: "system", order: 120, adminOnly: true },
];

const pluginNavItems: NavItem[] = [];

export function getCoreNavItems(): NavItem[] {
  return coreNavItems;
}

export function registerNavItem(item: NavItem): void {
  pluginNavItems.push(item);
}

export function getNavItems(): NavItem[] {
  return [...coreNavItems, ...pluginNavItems].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}
