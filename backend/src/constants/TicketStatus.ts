export const TicketStatus = ["WAIT_DISPATCH","ASSIGNED","ARRIVED","REPAIRING","RESTORED","CLOSED"] as const;
export type TicketStatus = (typeof TicketStatus)[number];
