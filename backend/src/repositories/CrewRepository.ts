import { seed } from "../seed"; export const crewRepository = { findAll: () => seed.crew, save: (row: unknown) => row };
