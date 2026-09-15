import { seed } from "../seed"; export const sparePartUsageRepository = { findAll: () => seed.sparePartUsage, save: (row: unknown) => row };
