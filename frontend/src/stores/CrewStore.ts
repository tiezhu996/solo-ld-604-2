import { defineStore } from "pinia";
import { listCrew } from "../api/Crew";
export const useCrewStore = defineStore("crew", {
  state: () => ({ rows: [] as Awaited<ReturnType<typeof listCrew>>, loading: false }),
  actions: { async load() { this.loading = true; this.rows = await listCrew(); this.loading = false; } }
});
