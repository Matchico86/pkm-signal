PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY,
  card_ref TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  set_code TEXT,
  card_number TEXT,
  rarity TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS targets (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, source),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS portal_stock_snapshot (
  id INTEGER PRIMARY KEY,
  snapshot_at TEXT NOT NULL,
  asset_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents >= 0),
  total_cost_cents INTEGER CHECK (total_cost_cents >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_at, asset_id),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_history_daily (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  market_date TEXT NOT NULL,
  source TEXT NOT NULL,
  price_low_cents INTEGER CHECK (price_low_cents >= 0),
  price_mid_cents INTEGER CHECK (price_mid_cents >= 0),
  price_high_cents INTEGER CHECK (price_high_cents >= 0),
  listings_count INTEGER CHECK (listings_count >= 0),
  sales_count INTEGER CHECK (sales_count >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, market_date, source),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scores_daily (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  target_id INTEGER,
  score_date TEXT NOT NULL,
  score_value REAL NOT NULL,
  price_ref REAL,
  portal_ref REAL,
  d3 REAL,
  d7 REAL,
  d14 REAL,
  d30 REAL,
  momentum_short_raw REAL,
  momentum_mid_raw REAL,
  acceleration_raw REAL,
  spread_raw REAL,
  spread_quality REAL,
  freshness_score REAL,
  history_depth REAL,
  cross_confirmation REAL,
  stock_exposure REAL,
  pricing_gap_pct REAL,
  confidence_score INTEGER,
  score_tension INTEGER,
  score_hype INTEGER,
  score_reprice INTEGER,
  reprice_direction TEXT,
  score_sell_watch INTEGER,
  score_buy_watch INTEGER,
  reason_codes_json TEXT,
  score_version TEXT NOT NULL DEFAULT 'v1',
  score_label TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, score_date),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id INTEGER PRIMARY KEY,
  job_run_id TEXT,
  asset_id INTEGER NOT NULL,
  target_id INTEGER,
  alert_type TEXT NOT NULL CHECK (
    alert_type IN (
      'reprice_up',
      'reprice_down',
      'hype_start',
      'supply_tightening',
      'sell_window_watch',
      'watchlist_opportunity'
    )
  ),
  scope TEXT NOT NULL CHECK (scope IN ('owned', 'watchlist')),
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'P3')),
  priority_score INTEGER NOT NULL CHECK (priority_score BETWEEN 0 AND 1000),
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'open', 'acknowledged', 'acted', 'dismissed', 'expired')
  ),
  title TEXT NOT NULL,
  message_short TEXT NOT NULL,
  action_hint TEXT NOT NULL,
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  emitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cooldown_until TEXT,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count >= 1),
  resolved_at TEXT,
  resolution_reason TEXT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_is_active ON targets (is_active);
CREATE INDEX IF NOT EXISTS idx_portal_stock_snapshot_asset_id ON portal_stock_snapshot (asset_id);
CREATE INDEX IF NOT EXISTS idx_market_history_daily_market_date ON market_history_daily (market_date);
CREATE INDEX IF NOT EXISTS idx_scores_daily_score_date ON scores_daily (score_date);
CREATE INDEX IF NOT EXISTS idx_alerts_status_priority ON alerts (status, priority_score DESC, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_asset_type ON alerts (asset_id, alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe_key ON alerts (dedupe_key, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_cooldown ON alerts (cooldown_until);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_unique
  ON alerts (asset_id, alert_type)
  WHERE status IN ('new', 'open', 'acknowledged');

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
