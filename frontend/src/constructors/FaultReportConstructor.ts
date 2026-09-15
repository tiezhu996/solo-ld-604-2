import type { FaultReport } from "../types/FaultReport";

export const createDefaultFaultReport = (overrides: Partial<FaultReport> = {}): FaultReport => ({
  id: 1 as never,
  reporter_name: "reporter name 1" as never,
  phone: "13800000001" as never,
  asset_id: 1 as never,
  fault_type: "VOLTAGE_LOW" as never,
  address_desc: "address desc 1" as never,
  severity: "severity 1" as never,
  report_channel: "report channel 1" as never,
  status: "ASSIGNED" as never,
  ...overrides
});

export const createFaultReportForm = createDefaultFaultReport;
export const createFaultReportResponse = createDefaultFaultReport;
