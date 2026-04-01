PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_snapshot_runs (
  id INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  exported_at TEXT NOT NULL,
  source_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes >= 0),
  payload_origin TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed', 'skipped_duplicate')),
  duplicate_of_run_id INTEGER,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  error_message TEXT,
  warnings_json TEXT,
  summary_json TEXT,
  meta_json TEXT,
  portal_warnings_json TEXT,
  FOREIGN KEY (duplicate_of_run_id) REFERENCES portal_snapshot_runs(id)
);

CREATE TABLE IF NOT EXISTS portal_snapshot_run_payloads (
  run_id INTEGER PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_purchase_items (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  p_item_id TEXT NOT NULL,
  p_order_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  p_quantity REAL,
  qty_sold REAL,
  qty_remaining REAL,
  qty_for_sale REAL,
  p_price_item REAL,
  received INTEGER CHECK (received IN (0, 1)),
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, p_item_id),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_sales_items (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  s_item_id TEXT NOT NULL,
  s_order_id TEXT NOT NULL,
  p_item_id TEXT,
  card_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  s_quantity REAL,
  s_price_item REAL,
  margin_item REAL,
  roi_item REAL,
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, s_item_id),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_stock_live_snapshots (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  card_id TEXT NOT NULL,
  owner TEXT,
  quantity REAL,
  qty_mathieu REAL,
  qty_ewan REAL,
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, row_index),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_purchase_orders (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  p_order_id TEXT NOT NULL,
  order_owner TEXT NOT NULL,
  total_amount REAL,
  shipping_amount REAL,
  fees_amount REAL,
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, p_order_id),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_sales_orders (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  s_order_id TEXT NOT NULL,
  order_owner TEXT NOT NULL,
  total_amount REAL,
  shipping_amount REAL,
  fees_amount REAL,
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, s_order_id),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_orders_status (
  id INTEGER PRIMARY KEY,
  run_id INTEGER NOT NULL,
  row_index INTEGER NOT NULL CHECK (row_index >= 0),
  type TEXT,
  ref_id TEXT,
  status TEXT,
  updated_at TEXT,
  source_sheet TEXT,
  source_row INTEGER CHECK (source_row IS NULL OR source_row >= 1),
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, row_index),
  FOREIGN KEY (run_id) REFERENCES portal_snapshot_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_portal_snapshot_runs_hash_status
  ON portal_snapshot_runs (payload_hash, status);
CREATE INDEX IF NOT EXISTS idx_portal_snapshot_runs_exported_at
  ON portal_snapshot_runs (exported_at);

CREATE INDEX IF NOT EXISTS idx_portal_purchase_items_run_id
  ON portal_purchase_items (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_purchase_items_card_id
  ON portal_purchase_items (card_id);
CREATE INDEX IF NOT EXISTS idx_portal_purchase_items_owner
  ON portal_purchase_items (owner);

CREATE INDEX IF NOT EXISTS idx_portal_sales_items_run_id
  ON portal_sales_items (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_sales_items_card_id
  ON portal_sales_items (card_id);
CREATE INDEX IF NOT EXISTS idx_portal_sales_items_owner
  ON portal_sales_items (owner);
CREATE INDEX IF NOT EXISTS idx_portal_sales_items_p_item_id
  ON portal_sales_items (p_item_id);

CREATE INDEX IF NOT EXISTS idx_portal_stock_live_snapshots_run_id
  ON portal_stock_live_snapshots (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_stock_live_snapshots_card_id
  ON portal_stock_live_snapshots (card_id);

CREATE INDEX IF NOT EXISTS idx_portal_purchase_orders_run_id
  ON portal_purchase_orders (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_purchase_orders_owner
  ON portal_purchase_orders (order_owner);

CREATE INDEX IF NOT EXISTS idx_portal_sales_orders_run_id
  ON portal_sales_orders (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_sales_orders_owner
  ON portal_sales_orders (order_owner);

CREATE INDEX IF NOT EXISTS idx_portal_orders_status_run_id
  ON portal_orders_status (run_id);
CREATE INDEX IF NOT EXISTS idx_portal_orders_status_ref_id
  ON portal_orders_status (ref_id);
