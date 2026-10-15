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
  if (!owner) {
    const items: NavItem[] = [];
    const add = (
      to: string,
      hash: string | undefined,
      label: string,
      module: ModuleKey,
      icon = Boxes,
      permission?: string,
    ) => {
      if (permission && !permissions.includes(permission)) return;
      if (!canAccessPath(roles, permissions, to)) return;
      if (!items.some((i) => i.to === to && i.hash === hash))
        items.push({ to, hash, label, module, icon });
    };
    if (roles.includes("stock_entry")) {
      add("/inventory/receiving", undefined, "Stock Entry", "stock_entry");
      add(
        "/inventory/transfers",
        undefined,
        "Stock Transfer",
        "stock_transfer",
        Boxes,
        "stock.transfer",
      );
      add("/inventory", "fabric-stock", "Stock Inventory", "inventory");
      add(
        "/inventory",
        "finished-products",
        "Finished Products",
        "inventory",
        Boxes,
        permissions.includes("stock.transfer_finished")
          ? "stock.transfer_finished"
          : permissions.includes("production.receive")
            ? "production.receive"
            : "stock.price_finished",
      );
    }
    if (roles.includes("counter")) {
      add("/pos", undefined, "Counter / POS", "pos", ShoppingCart);
      add("/tailoring", "customer", "Customer Tailoring", "tailoring", Scissors);
      add("/tailoring", "ongoing", "Owner Production", "tailoring", Scissors, "production.view");
    }
    if (roles.includes("ecommerce_manager")) {
      add("/ecommerce", "fabric", "Showroom Fabric", "ecommerce");
      add("/ecommerce", "products", "Showroom Finished Products", "ecommerce");
    }
    if (roles.includes("salesperson"))
      add("/my-work", undefined, "My Work", "salesperson_work", UserRound);
    if (roles.includes("tailor")) {
      add("/tailoring", "customer", "Customer Tailoring", "tailoring", Scissors);
      add("/tailoring", "production", "Production Tailoring", "tailoring", Scissors);
    }
    if (roles.includes("production")) {
      add("/tailoring", "fabric", "Fabric", "tailoring", Boxes, "production.view");
      add("/tailoring", "ongoing", "Ongoing Production", "tailoring", Scissors, "production.view");
    }
    if (!roles.includes("stock_entry") && permissions.includes("production.receive"))
      add("/tailoring", "receipt", "Workshop receipt", "tailoring", Boxes, "production.receive");
    return [
      ...(items.length ? [{ label: "Work", items }] : []),
      {
        label: "Account",
        items: [
          { to: "/settings", label: "Account", icon: Settings, module: "settings" as ModuleKey },
        ],
      },
    ];
  }
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
          to: "/tailoring",
          hash: "customer",
          label: "Customer Tailoring",
          icon: Scissors,
          module: "tailoring",
        },
      ],
    },
    {
      label: "Production",
      items: [
        {
          to: "/tailoring",
          hash: "fabric",
          label: "New Production",
          icon: Scissors,
          module: "tailoring",
        },
        {
          to: "/tailoring",
          hash: "ongoing",
          label: "Ongoing Production",
          icon: Scissors,
          module: "tailoring",
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
        { to: "/reports", label: "Reports & Analytics", icon: BarChart3, module: "reports" },
        { to: "/audit", label: "Audit Trail", icon: ClipboardList, module: "audit" },
        {
          to: "/reports",
          hash: "orders",
          label: "Sales History",
          icon: ClipboardList,
          module: "reports",
        },
        {
          to: "/my-work",
          label: "Salesperson Performance",
          icon: UserRound,
          module: "salesperson_work",
        },
      ],
    },
    {
      label: "Administration",
      items: [
        {
          to: "/tailoring",
          hash: "hierarchy",
          label: "Factories & Tailors",
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
