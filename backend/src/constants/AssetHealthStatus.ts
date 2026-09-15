export const AssetHealthStatus = ["NORMAL","WATCH","DEGRADED","DANGEROUS"] as const;
export type AssetHealthStatus = (typeof AssetHealthStatus)[number];
