-- 电力配网抢修闭环系统数据库结构（SQLite）

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dispatcher','leader','keeper','auditor')),
  crew_id INTEGER REFERENCES crews(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS crews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  leader_name TEXT NOT NULL,
  skill_tags TEXT NOT NULL,          -- JSON 数组，元素为 FaultType
  duty_status TEXT NOT NULL DEFAULT 'ON' CHECK (duty_status IN ('ON','OFF')),
  contact_phone TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS grid_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT NOT NULL UNIQUE,
  asset_type TEXT NOT NULL,
  feeder_line TEXT NOT NULL,         -- 所属馈线（合并报修的维度之一）
  voltage_level TEXT NOT NULL,
  location_desc TEXT NOT NULL DEFAULT '',
  health_status TEXT NOT NULL DEFAULT 'NORMAL' CHECK (health_status IN ('NORMAL','WATCH','DEGRADED','DANGEROUS')),
  owner_crew_id INTEGER REFERENCES crews(id)
);

CREATE TABLE IF NOT EXISTS repair_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_no TEXT NOT NULL UNIQUE,
  fault_type TEXT NOT NULL,
  feeder_line TEXT NOT NULL,
  asset_id INTEGER REFERENCES grid_assets(id),
  address_desc TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('MINOR','MAJOR','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'WAIT_DISPATCH'
    CHECK (status IN ('WAIT_DISPATCH','ASSIGNED','ARRIVED','REPAIRING','RESTORED','CLOSED')),
  crew_id INTEGER REFERENCES crews(id),
  dispatcher_id INTEGER REFERENCES users(id),
  dispatch_mode TEXT,                -- MANUAL / AUTO_BACKFILL
  created_at TEXT NOT NULL,
  assigned_at TEXT,
  arrived_at TEXT,
  repair_started_at TEXT,
  restored_at TEXT,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS fault_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL UNIQUE,
  reporter_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  asset_id INTEGER REFERENCES grid_assets(id),
  feeder_line TEXT NOT NULL,
  fault_type TEXT NOT NULL,
  address_desc TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('MINOR','MAJOR','CRITICAL')),
  report_channel TEXT NOT NULL DEFAULT '热线',
  status TEXT NOT NULL DEFAULT 'CONVERTED' CHECK (status IN ('CONVERTED','MERGED','CLOSED')),
  ticket_id INTEGER REFERENCES repair_tickets(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spare_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_code TEXT NOT NULL UNIQUE,
  part_name TEXT NOT NULL,
  warehouse_name TEXT NOT NULL,
  total_qty INTEGER NOT NULL DEFAULT 0,
  available_qty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS part_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES repair_tickets(id),
  part_id INTEGER NOT NULL REFERENCES spare_parts(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','APPROVED','REJECTED','RETURNED','CONSUMED','RELEASED')),
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  reject_reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES spare_parts(id),
  change_qty INTEGER NOT NULL,       -- 正为入库，负为出库
  balance_after INTEGER NOT NULL,    -- 变动后的可用库存
  reason TEXT NOT NULL,
  ref_type TEXT,                     -- PART_USAGE / RESTOCK / RELEASE
  ref_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER,
  actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,              -- LogTemplates 的键
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ticket_status ON repair_tickets(status);
CREATE INDEX IF NOT EXISTS idx_ticket_crew ON repair_tickets(crew_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_merge ON repair_tickets(feeder_line, fault_type, status);
CREATE INDEX IF NOT EXISTS idx_report_ticket ON fault_reports(ticket_id);
CREATE INDEX IF NOT EXISTS idx_usage_ticket ON part_usages(ticket_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
