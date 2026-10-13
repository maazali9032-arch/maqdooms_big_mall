import {
  BarChart3,
  Boxes,
  ClipboardList,
  Gauge,
  KeyRound,
  MessageCircle,
  Scissors,
  Settings,
  ShoppingCart,
  Store,
  UserRound,
  Users,
} from "lucide-react";
import { allowedModules, canAccessPath, type ModuleKey } from "./modules";

export type NavItem = {
  to: string;
  hash?: string;
  label: string;
  icon: typeof Gauge;
  module: ModuleKey;
  ownerOnly?: boolean;
  permission?: string;
};
export type NavSection = { label: string; items: NavItem[] };

/** Reuse existing workflow routes without expanding any role's page access. */
export function sidebarSections(roles: string[], permissions: string[]): NavSection[] {
  const owner = roles.includes("owner");
  const counter = owner || roles.includes("counter");
  const allowed = allowedModules(roles);
  const sections: NavSection[] = [
    {
      label: "Overview",
      items: [{ to: "/dashboard", label: "Dashboard", icon: Gauge, module: "dashboard" }],
    },
    {
      label: "Stock & Inventory",
      items: [
        { to: "/inventory/receiving", label: "Stock Entry", icon: Boxes, module: "stock_entry" },
        {
          to: "/inventory/transfers",
          label: "Stock Transfer",
          icon: Boxes,
          module: "stock_transfer",
          permission: "stock.transfer",
        },
        {
          to: "/inventory",
          hash: "fabric-stock",
          label: "Fabric Stock",
          icon: Boxes,
          module: "inventory",
        },
        {
          to: "/inventory",
          hash: "consumables",
          label: "Materials & Consumables",
          icon: Boxes,
          module: "inventory",
        },
        owner
          ? {
              to: "/inventory",
              hash: "finished-products",
              label: "Finished Product Stock",
              icon: Boxes,
              module: "inventory",
              ownerOnly: true,
            }
          : {
              to: "/inventory",
              hash: "finished-products",
              label: "Finished Product Stock",
              icon: Boxes,
              module: "inventory",
              permission: "stock.transfer_finished",
            },
      ],
    },
    {
      label: "Sales & Customers",
      items: [
        { to: "/pos", label: "Counter / POS", icon: ShoppingCart, module: "pos" },
        {
          to: counter ? "/pos" : "/tailoring",
          hash: "customer",
          label: "Customer Tailoring",
          icon: Scissors,
          module: counter ? "pos" : "tailoring",
        },
        { to: "/customers", label: "Customers", icon: Users, module: "customers" },
        {
          to: owner ? "/reports" : "/pos",
          hash: owner ? "orders" : "history",
          label: "Sales History",
          icon: ClipboardList,
          module: owner ? "reports" : "pos",
        },
        {
          to: "/my-work",
          label: owner ? "Salesperson Performance" : "My Work",
          icon: UserRound,
          module: "salesperson_work",
        },
      ],
    },
    {
      label: "Production",
      items: [
        {
          to: "/tailoring",
          hash: "production",
          label: "Owner Production",
          icon: Scissors,
          module: "tailoring",
        },
        {
          to: counter ? "/pos" : "/tailoring",
          hash: "issues",
          label: "Material Issues",
          icon: Boxes,
          module: counter ? "pos" : "tailoring",
        },
        {
          to: "/tailoring",
          hash: "products",
          label: "Workshop Returns",
          icon: Boxes,
          module: "tailoring",
          ownerOnly: true,
        },
        {
          to: "/tailoring",
          hash: "cost",
          label: "Production Costing & SP",
          icon: BarChart3,
          module: "tailoring",
          ownerOnly: true,
        },
      ],
    },
    {
      label: "Commerce",
      items: [
        { to: "/ecommerce", label: "E-commerce", icon: Store, module: "ecommerce" },
        { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, module: "whatsapp" },
      ],
    },
    {
      label: "Reports & Tracking",
      items: [
        { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
        { to: "/audit", label: "Audit Trail", icon: ClipboardList, module: "audit" },
      ],
    },
    {
      label: "Administration",
      items: [
        {
          to: "/tailoring",
          hash: "hierarchy",
          label: "Factories, Sections & Tailors",
          icon: Users,
          module: "tailoring",
          ownerOnly: true,
        },
        {
          to: "/tailoring",
          hash: "catalog",
          label: "Products & Designs",
          icon: Scissors,
          module: "tailoring",
          ownerOnly: true,
        },
        {
          to: "/inventory",
          hash: "locations",
          label: "Locations & Floors",
          icon: Store,
          module: "inventory",
          ownerOnly: true,
        },
        { to: "/access", label: "Users & Permissions", icon: KeyRound, module: "access" },
        { to: "/settings", label: "Settings", icon: Settings, module: "settings" },
      ],
    },
  ];
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          (!item.ownerOnly || owner) &&
          (!item.permission || owner || permissions.includes(item.permission)) &&
          allowed.has(item.module) &&
          canAccessPath(roles, permissions, item.to),
      ),
    }))
    .filter((section) => section.items.length > 0);
}

export const navKey = (item: NavItem) => `${item.to}#${item.hash ?? ""}`;

export function activeSidebarItem(
  sections: NavSection[],
  pathname: string,
  hash: string,
): NavItem | undefined {
  const path = pathname.replace(/\/$/, "");
  const items = sections.flatMap((section) => section.items);
  const exact = items.filter((item) => item.to === path);
  return (
    exact.find((item) => item.hash === hash) ??
    exact.find((item) => !item.hash) ??
    exact[0] ??
    items
      .filter((item) => path.startsWith(`${item.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0]
  );
}
