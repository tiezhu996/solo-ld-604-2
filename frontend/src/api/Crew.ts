import { mockData } from "../mocks/seedData";
import type { Crew } from "../types/Crew";

const endpoint = "/api/crew";

export async function listCrew(): Promise<Crew[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.crew as unknown as Crew[])];
}

export async function saveCrew(payload: Crew) {
  console.info("save Crew", payload);
  return payload;
}
