export const AssetHealthStatus = ["NORMAL","WATCH","DEGRADED","DANGEROUS"] as const;
export type AssetHealthStatus = (typeof AssetHealthStatus)[number];
export const AssetHealthStatusText: Record<AssetHealthStatus, string> = Object.fromEntries(AssetHealthStatus.map((value) => [value, value.replace(/_/g, " ")])) as Record<AssetHealthStatus, string>;
