export const useStaff = () => ({
  data: [{ id: "staff", full_name: "Stock Staff", email: "staff@test", roles: ["stock_entry"] }],
  error: null,
});
export const useRoles = () => ({
  data: {
    permissions: [{ key: "stock.transfer", label: "Transfer stock" }],
    rolePermissions: [{ role_key: "stock_entry", permission_key: "stock.transfer" }],
  },
  error: null,
});
