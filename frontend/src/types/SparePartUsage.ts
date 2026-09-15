export interface SparePartUsage {
  id: number;
  ticket_id: number;
  part_code: string;
  part_name: string;
  quantity: number;
  warehouse_name: string;
  approved_by: string;
  usage_status: string;
}
