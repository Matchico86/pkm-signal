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
  score_date TEXT NOT NULL,
  score_value REAL NOT NULL,
  score_label TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (asset_id, score_date),
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  alert_date TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity INTEGER NOT NULL DEFAULT 3 CHECK (severity BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_targets_is_active ON targets (is_active);
CREATE INDEX IF NOT EXISTS idx_portal_stock_snapshot_asset_id ON portal_stock_snapshot (asset_id);
CREATE INDEX IF NOT EXISTS idx_market_history_daily_market_date ON market_history_daily (market_date);
CREATE INDEX IF NOT EXISTS idx_scores_daily_score_date ON scores_daily (score_date);
CREATE INDEX IF NOT EXISTS idx_alerts_status_created_at ON alerts (status, created_at);
