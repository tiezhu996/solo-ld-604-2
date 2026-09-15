import { seed } from "../seed"; export const repairTicketRepository = { findAll: () => seed.repairTicket, save: (row: unknown) => row };
