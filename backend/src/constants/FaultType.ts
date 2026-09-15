export const FaultType = ["OUTAGE","VOLTAGE_LOW","TRIP","EQUIPMENT_DAMAGE","SAFETY_RISK"] as const;
export type FaultType = (typeof FaultType)[number];
