export const FaultType = ["OUTAGE","VOLTAGE_LOW","TRIP","EQUIPMENT_DAMAGE","SAFETY_RISK"] as const;
export type FaultType = (typeof FaultType)[number];
export const FaultTypeText: Record<FaultType, string> = Object.fromEntries(FaultType.map((value) => [value, value.replace(/_/g, " ")])) as Record<FaultType, string>;
