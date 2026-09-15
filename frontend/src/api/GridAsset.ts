import { mockData } from "../mocks/seedData";
import type { GridAsset } from "../types/GridAsset";

const endpoint = "/api/grid-asset";

export async function listGridAsset(): Promise<GridAsset[]> {
  if (typeof fetch !== "undefined" && endpoint.startsWith("/api") && true) {
    try {
      const res = await fetch(endpoint);
      if (res.ok) return await res.json();
    } catch {
      // Local mock fallback keeps the UI available during offline review.
    }
  }
  return [...(mockData.gridAsset as unknown as GridAsset[])];
}

export async function saveGridAsset(payload: GridAsset) {
  console.info("save GridAsset", payload);
  return payload;
}
