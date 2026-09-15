import { defineStore } from "pinia";
import { listGridAsset } from "../api/GridAsset";
export const useGridAssetStore = defineStore("gridAsset", {
  state: () => ({ rows: [] as Awaited<ReturnType<typeof listGridAsset>>, loading: false }),
  actions: { async load() { this.loading = true; this.rows = await listGridAsset(); this.loading = false; } }
});
