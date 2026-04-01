# V1 Runbook Local

Ce runbook couvre le flux minimal relancable apres pause.

## 1) Migration DB

Commande:

```bash
node src/db/migrate.js [--db=<path>]
```

Status:

```bash
node src/db/migrate.js --status [--db=<path>]
```

Entrees:
- `db/migrations/*.sql`

Sorties:
- table `schema_migrations`
- schema SQLite a jour

## 2) Import Portal stock (reference moteur V1)

Commande:

```bash
node src/connectors/portal/import-stock.js --file=<json> [--snapshot-at=YYYY-MM-DD] [--db=<path>]
```

Entrees:
- JSON stock simple (`items` ou `rows` ou `stock`)

Sorties:
- `assets`
- `targets`
- `portal_stock_snapshot`

## 3) Import Portal snapshot detaille

Commande:

```bash
node src/connectors/portal/import-snapshot.js [--file=<json> | --url=<url>] [--db=<path>]
```

Entrees:
- payload snapshot versionne Portal

Sorties:
- `portal_snapshot_runs`
- `portal_snapshot_run_payloads`
- `portal_purchase_items`
- `portal_sales_items`
- `portal_stock_live_snapshots`
- `portal_purchase_orders`
- `portal_sales_orders`
- `portal_orders_status`

## 4) Snapshot marche externe

Commande:

```bash
node src/jobs/market-snapshot.js [--market-date=YYYY-MM-DD] [--scope=all|hot] [--target-source=<source>] [--usd-eur-rate=<n>] [--db=<path>]
```

Entrees:
- `targets` actifs
- Pokemon TCG API

Sorties:
- upsert `market_history_daily` (`source=pokemon_tcg_api`)
- logs `found/not_found/missing_price/fallback_used/stale/source_error`

## 5) Import marche local (offline/debug)

Commande:

```bash
node src/connectors/market/import-daily.js --file=<json> [--db=<path>]
```

Entrees:
- JSON marche local

Sorties:
- upsert `market_history_daily`

## 6) Scoring journalier

Commande:

```bash
node src/jobs/scores-daily.js [--score-date=YYYY-MM-DD] [--scope=all|hot] [--target-source=<source>] [--db=<path>]
```

Entrees:
- `targets`
- `market_history_daily`
- `portal_stock_snapshot`

Sorties:
- upsert `scores_daily`
- reason codes JSON
