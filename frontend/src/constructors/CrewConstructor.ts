import type { Crew } from "../types/Crew";

export const createDefaultCrew = (overrides: Partial<Crew> = {}): Crew => ({
  id: 1 as never,
  name: "name 1" as never,
  leader_id: 1 as never,
  skill_tags: "skill tags 1" as never,
  duty_status: "ASSIGNED" as never,
  current_ticket_id: 1 as never,
  contact_phone: "13800000001" as never,
  ...overrides
});

export const createCrewForm = createDefaultCrew;
export const createCrewResponse = createDefaultCrew;
