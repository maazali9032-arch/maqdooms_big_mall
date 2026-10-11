export const useCustomers = () => ({
  data: [{ id: "customer", name: "Customer One", phone: null, whatsapp_phone: null }],
  error: null,
});
export const useCreateCustomer = () => ({
  mutateAsync: async () => ({ id: "customer" }),
  isPending: false,
});
