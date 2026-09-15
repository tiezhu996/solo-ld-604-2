import { mockData } from "../mocks/seedData";
import type { SparePartUsage } from "../types/SparePartUsage";

const endpoint = "/api/spare-part-usage";

export async function listSparePartUsage(): Promise<SparePartUsage[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.sparePartUsage as unknown as SparePartUsage[])];
}

export async function saveSparePartUsage(payload: SparePartUsage) {
  console.info("save SparePartUsage", payload);
  return payload;
}
