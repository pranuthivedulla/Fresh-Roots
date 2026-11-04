/**
 * The acceptance table from section 10 of the build prompt, copied by hand.
 *
 * Run date in a festival month (October 2026), on-order = 0 for all SKUs.
 * Cover is rounded to one decimal. This file is the contract: if the rules
 * change, this table must not be edited to make them pass.
 */

export type ExpectedRow = {
  skuId: string;
  cover: number;
  flag: "stockout" | "overstock" | "in-range";
  /** Units, or "hold", or "none". */
  recommended: number | "hold" | "none";
  note?: string;
};

export const SECTION_10: ExpectedRow[] = [
  { skuId: "SKU001", cover: 4.2, flag: "stockout", recommended: 750, note: "high-demand, no uplift" },
  { skuId: "SKU002", cover: 11.5, flag: "in-range", recommended: "none" },
  { skuId: "SKU003", cover: 4.4, flag: "stockout", recommended: 300 },
  { skuId: "SKU004", cover: 1.8, flag: "stockout", recommended: 150, note: "perishable" },
  { skuId: "SKU005", cover: 8.1, flag: "in-range", recommended: "none" },
  { skuId: "SKU006", cover: 22.2, flag: "overstock", recommended: "hold" },
  { skuId: "SKU007", cover: 4.1, flag: "overstock", recommended: "hold", note: "perishable" },
  { skuId: "SKU008", cover: 7.0, flag: "in-range", recommended: "none" },
  { skuId: "SKU009", cover: 9.4, flag: "in-range", recommended: "none" },
  { skuId: "SKU010", cover: 8.5, flag: "in-range", recommended: "none" },
  { skuId: "SKU011", cover: 1.8, flag: "stockout", recommended: 500, note: "perishable" },
  { skuId: "SKU012", cover: 6.8, flag: "in-range", recommended: "none" },
  { skuId: "SKU013", cover: 3.2, flag: "stockout", recommended: 120 },
  { skuId: "SKU014", cover: 6.8, flag: "in-range", recommended: "none" },
  { skuId: "SKU015", cover: 9.7, flag: "in-range", recommended: "none" },
];

export const SECTION_10_TOTALS = { stockout: 5, overstock: 2, inRange: 8 };

/** Section 10 also asserts this, so it is checked too. */
export const SECTION_10_HIGH_DEMAND = ["SKU001"];
