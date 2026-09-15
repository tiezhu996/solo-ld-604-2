import { mockData } from "../mocks/seedData";
import type { RepairTicket } from "../types/RepairTicket";

const endpoint = "/api/repair-ticket";

export async function listRepairTicket(): Promise<RepairTicket[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.repairTicket as unknown as RepairTicket[])];
}

export async function saveRepairTicket(payload: RepairTicket) {
  console.info("save RepairTicket", payload);
  return payload;
}
