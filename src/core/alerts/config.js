const ALERT_TYPE_PRIORITY_ORDER = [
  "reprice_down",
  "reprice_up",
  "sell_window_watch",
  "hype_start",
  "watchlist_opportunity",
  "supply_tightening",
];

const ALERT_TYPE_BASE_PRIORITY = {
  reprice_down: 600,
  reprice_up: 520,
  sell_window_watch: 440,
  hype_start: 360,
  watchlist_opportunity: 280,
  supply_tightening: 200,
};

const ALERT_TYPE_COOLDOWN_DAYS = {
  reprice_down: 2,
  reprice_up: 2,
  sell_window_watch: 3,
  hype_start: 4,
  watchlist_opportunity: 4,
  supply_tightening: 5,
};

const ALERT_TYPE_EXPIRE_MISSED_DAYS = {
  reprice_down: 1,
  reprice_up: 1,
  sell_window_watch: 2,
  hype_start: 2,
  watchlist_opportunity: 2,
  supply_tightening: 2,
};

const ACTIVE_ALERT_STATUSES = ["new", "open", "acknowledged"];
const TERMINAL_ALERT_STATUSES = ["acted", "dismissed", "expired"];

const DEFAULT_ALERTS_CONFIG = {
  preferredMarketSource: "pokemon_tcg_api",
  minConfidenceGlobal: 55,
  minMovePctGlobal: 0.04,
  minMoveEurGlobal: 1.0,
  confirmationSnapshotsRequired: 2,
  maxNewAlertsPerRun: 15,
  maxOutputAlerts: 20,
  thresholds: {
    repriceUp: {
      minConfidence: 62,
      minScoreReprice: 58,
      minGapPct: 0.06,
      minGapEur: 1.5,
      strongGapPct: 0.18,
      strongGapEur: 6.0,
    },
    repriceDown: {
      minConfidence: 60,
      minScoreReprice: 56,
      minGapPct: -0.05,
      minGapEur: -1.5,
      strongGapPct: -0.16,
      strongGapEur: -6.0,
    },
    hypeStart: {
      minConfidence: 60,
      minScoreHype: 68,
      minD3: 0.08,
      minD7: 0.1,
      minAcceleration: 0.015,
      minCrossConfirmation: 0.45,
      strongScoreHype: 82,
      strongD3: 0.22,
    },
    supplyTightening: {
      minConfidence: 56,
      maxSupplyDelta7d: -0.25,
      minListings7d: 8,
      maxPriceDropD7: -0.05,
      strongSupplyDelta7d: -0.4,
    },
    sellWindowWatch: {
      minConfidence: 58,
      minScoreSellWatch: 65,
      minScoreTension: 55,
      minD7: 0.08,
      strongScoreSellWatch: 85,
      strongD3: 0.2,
    },
    watchlistOpportunity: {
      minConfidence: 58,
      minScoreBuyWatch: 58,
      maxD3Drop: -0.12,
      maxD7Drop: -0.2,
      minAcceleration: -0.03,
      strongScoreBuyWatch: 82,
    },
  },
};

module.exports = {
  ACTIVE_ALERT_STATUSES,
  ALERT_TYPE_BASE_PRIORITY,
  ALERT_TYPE_COOLDOWN_DAYS,
  ALERT_TYPE_EXPIRE_MISSED_DAYS,
  ALERT_TYPE_PRIORITY_ORDER,
  DEFAULT_ALERTS_CONFIG,
  TERMINAL_ALERT_STATUSES,
};
