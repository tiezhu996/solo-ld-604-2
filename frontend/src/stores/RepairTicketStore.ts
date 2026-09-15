import { defineStore } from "pinia";
import { listRepairTicket } from "../api/RepairTicket";
export const useRepairTicketStore = defineStore("repairTicket", {
  state: () => ({ rows: [] as Awaited<ReturnType<typeof listRepairTicket>>, loading: false }),
  actions: { async load() { this.loading = true; this.rows = await listRepairTicket(); this.loading = false; } }
});
