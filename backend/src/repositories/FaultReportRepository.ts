import { seed } from "../seed"; export const faultReportRepository = { findAll: () => seed.faultReport, save: (row: unknown) => row };
