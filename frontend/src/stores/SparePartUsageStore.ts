import { defineStore } from "pinia";
import { listSparePartUsage } from "../api/SparePartUsage";
export const useSparePartUsageStore = defineStore("sparePartUsage", {
  state: () => ({ rows: [] as Awaited<ReturnType<typeof listSparePartUsage>>, loading: false }),
  actions: { async load() { this.loading = true; this.rows = await listSparePartUsage(); this.loading = false; } }
});
