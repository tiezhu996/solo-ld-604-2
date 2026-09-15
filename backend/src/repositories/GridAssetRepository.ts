import { seed } from "../seed"; export const gridAssetRepository = { findAll: () => seed.gridAsset, save: (row: unknown) => row };
