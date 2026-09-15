import type { GridAsset } from "../types/GridAsset";

export const createDefaultGridAsset = (overrides: Partial<GridAsset> = {}): GridAsset => ({
  id: 1 as never,
  asset_code: "asset code 1" as never,
  asset_type: "VOLTAGE_LOW" as never,
  feeder_line: "feeder line 1" as never,
  voltage_level: "LOW" as never,
  location_desc: "location desc 1" as never,
  health_status: "ASSIGNED" as never,
  owner_team_id: 1 as never,
  ...overrides
});

export const createGridAssetForm = createDefaultGridAsset;
export const createGridAssetResponse = createDefaultGridAsset;
