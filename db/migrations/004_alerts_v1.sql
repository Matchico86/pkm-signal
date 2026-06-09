PRAGMA foreign_keys = ON;

ALTER TABLE alerts RENAME TO alerts_legacy_v0;

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

CREATE INDEX IF NOT EXISTS idx_alerts_status_priority
  ON alerts (status, priority_score DESC, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_asset_type
  ON alerts (asset_id, alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_dedupe_key
  ON alerts (dedupe_key, emitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_cooldown
  ON alerts (cooldown_until);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_unique
  ON alerts (asset_id, alert_type)
  WHERE status IN ('new', 'open', 'acknowledged');
