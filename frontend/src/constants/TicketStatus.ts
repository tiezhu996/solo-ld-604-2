export const TicketStatus = ["WAIT_DISPATCH","ASSIGNED","ARRIVED","REPAIRING","RESTORED","CLOSED"] as const;
export type TicketStatus = (typeof TicketStatus)[number];
export const TicketStatusText: Record<TicketStatus, string> = Object.fromEntries(TicketStatus.map((value) => [value, value.replace(/_/g, " ")])) as Record<TicketStatus, string>;
