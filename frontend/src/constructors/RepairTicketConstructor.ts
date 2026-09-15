import type { RepairTicket } from "../types/RepairTicket";

export const createDefaultRepairTicket = (overrides: Partial<RepairTicket> = {}): RepairTicket => ({
  id: 1 as never,
  fault_report_id: 1 as never,
  team_id: 1 as never,
  dispatcher_id: 1 as never,
  priority: "priority 1" as never,
  status: "ASSIGNED" as never,
  assigned_at: "2026-06-11T09:00:00Z" as never,
  restored_at: "2026-06-11T09:00:00Z" as never,
  ...overrides
});

export const createRepairTicketForm = createDefaultRepairTicket;
export const createRepairTicketResponse = createDefaultRepairTicket;
