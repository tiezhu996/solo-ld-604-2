import { mockData } from "../mocks/seedData";
import type { FaultReport } from "../types/FaultReport";

const endpoint = "/api/fault-report";

export async function listFaultReport(): Promise<FaultReport[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.faultReport as unknown as FaultReport[])];
}

export async function saveFaultReport(payload: FaultReport) {
  console.info("save FaultReport", payload);
  return payload;
}
