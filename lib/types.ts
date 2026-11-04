import type { CalendarDate } from "./time.ts";

export type Perishability = "Low" | "High";

export type Sku = {
  skuId: string;
  name: string;
  category: string;
  perishability: Perishability;
  standardReorderQty: number;
  unitOfMeasure: string;
  distributorId: string;
};

export type Supplier = {
  distributorId: string;
  name: string;
  region: string;
  status: string;
};

export type WeeklySale = {
  skuId: string;
  weekLabel: string; // 2026-W27
  units: number;
};

export type StockSnapshot = {
  skuId: string;
  location: string;
  unitsOnHand: number;
  asOfDate: CalendarDate;
};

export type CalendarMonth = {
  year: number;
  month: number;
  isFestivalMonth: boolean;
};

/** Everything the rules need, already validated. */
export type Dataset = {
  skus: Sku[];
  suppliers: Supplier[];
  sales: WeeklySale[];
  stock: StockSnapshot[];
  calendar: CalendarMonth[];
  /** Read from the stock file, never from the upload time. */
  asOfDate: CalendarDate;
};

/** A field-level problem found while reading a file. */
export type DataProblem = {
  file: string;
  line?: number;
  column?: string;
  message: string;
};
