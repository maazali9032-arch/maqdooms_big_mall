export function inclusivePurchaseAmounts(totalPaise: number, rateBps = 500) {
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0)
    throw new Error("Purchase total could not be calculated from the entered CP");
  const taxablePaise = Math.round((totalPaise * 10_000) / (10_000 + rateBps));
  return {
    actual_taxable_paise: taxablePaise,
    actual_gst_paise: totalPaise - taxablePaise,
    actual_supplier_paise: totalPaise,
  };
}
