import type { SparePartUsage } from "../types/SparePartUsage";

export const createDefaultSparePartUsage = (overrides: Partial<SparePartUsage> = {}): SparePartUsage => ({
  id: 1 as never,
  ticket_id: 1 as never,
  part_code: "part code 1" as never,
  part_name: "part name 1" as never,
  quantity: 92 as never,
  warehouse_name: "warehouse name 1" as never,
  approved_by: "approved by 1" as never,
  usage_status: "ASSIGNED" as never,
  ...overrides
});

export const createSparePartUsageForm = createDefaultSparePartUsage;
export const createSparePartUsageResponse = createDefaultSparePartUsage;
