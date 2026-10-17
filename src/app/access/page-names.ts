/** Shared destination names: role permissions may differ, page names do not. */
export const PAGE_NAMES: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inventory/receiving": "Stock Entry",
  "/inventory/transfers": "Stock Transfer",
  "/inventory": "Fabric Stock",
  "/inventory#fabric-stock": "Fabric Stock",
  "/inventory#finished-products": "Finished Products",
  "/inventory#consumables": "Materials & Consumables",
  "/inventory#locations": "Locations & Floors",
  "/pos": "Counter / POS",
  "/tailoring#fabric": "New Production",
  "/tailoring#owner": "New Production",
  "/tailoring#ongoing": "Ongoing Production",
  "/tailoring#production": "Production Tailoring",
  "/tailoring#receipt": "Finished Products",
  "/tailoring#customer": "Customer Tailoring",
  "/tailoring#hierarchy": "Factories & Tailors",
  "/tailoring#catalog": "Products & Designs",
  "/ecommerce": "E-commerce",
  "/ecommerce#fabric": "Showroom Fabric",
  "/ecommerce#products": "Showroom Finished Products",
  "/reports": "Reports & Analytics",
  "/reports#orders": "Sales History",
  "/audit": "Audit Trail",
  "/my-work": "Salesperson Work",
  "/customers": "Customers",
  "/access": "Users & Permissions",
  "/gst": "GST Configuration",
  "/settings": "Account",
  "/whatsapp": "WhatsApp",
};
export function pageName(pathname: string, hash = "", fallback = "") {
  const path = pathname.replace(/\/$/, "");
  return (
    PAGE_NAMES[path + (hash ? "#" + hash.replace(/^#/, "") : "")] ?? PAGE_NAMES[path] ?? fallback
  );
}
