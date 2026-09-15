import { defineStore } from "pinia";
import { listFaultReport } from "../api/FaultReport";
export const useFaultReportStore = defineStore("faultReport", {
  state: () => ({ rows: [] as Awaited<ReturnType<typeof listFaultReport>>, loading: false }),
  actions: { async load() { this.loading = true; this.rows = await listFaultReport(); this.loading = false; } }
});
