# Schema V1 (SQLite)

Ce document decrit le socle base de donnees MVP de PKM Market Engine.

## Objectif

Le schema V1 couvre uniquement :
- referentiel minimal des cartes surveillees ;
- snapshots stock (PKM Portal) ;
- snapshots marche journaliers ;
- scores journaliers lisibles ;
- alertes actionnables.

## Tables

### `assets`
Referentiel minimal carte.

Champs clefs :
- `card_ref` : identifiant carte externe unique ;
- metadata simple (`name`, `set_code`, `card_number`, `rarity`) ;
- timestamps (`created_at`, `updated_at`).

### `targets`
Liste des cartes a surveiller (stock utile + watchlist).

Champs clefs :
- `asset_id` (FK vers `assets`) ;
- `source` (origine de ciblage) ;
- `priority` (1-5) ;
- `is_active`.

Contrainte : unicite (`asset_id`, `source`).

### `portal_stock_snapshot`
Etat de stock importe depuis PKM Portal a un instant donne.

Champs clefs :
- `snapshot_at` ;
- `asset_id` (FK) ;
- `quantity` ;
- `unit_cost_cents`, `total_cost_cents` (optionnels).

Contrainte : unicite (`snapshot_at`, `asset_id`).

### `market_history_daily`
Snapshot marche journalier par carte et par source.

Champs clefs :
- `market_date` ;
- `asset_id` (FK) ;
- `source` ;
- prix (`price_low_cents`, `price_mid_cents`, `price_high_cents`) ;
- indicateurs volume simples (`listings_count`, `sales_count`).

Contrainte : unicite (`asset_id`, `market_date`, `source`).

### `scores_daily`
Score journalier interpretable par carte.

Champs clefs :
- `score_date` ;
- `asset_id` (FK) ;
- `target_id` (optionnel) ;
- `price_ref`, `portal_ref` ;
- variations (`d3`, `d7`, `d14`, `d30`) ;
- features (`momentum_short_raw`, `momentum_mid_raw`, `acceleration_raw`) ;
- qualite (`spread_raw`, `spread_quality`, `freshness_score`, `history_depth`, `cross_confirmation`) ;
- contexte (`stock_exposure`, `pricing_gap_pct`) ;
- scores (`confidence_score`, `score_tension`, `score_hype`, `score_reprice`, `score_sell_watch`, `score_buy_watch`) ;
- `reprice_direction` ;
- `reason_codes_json` ;
- `score_version` ;
- legacy compat (`score_value`, `score_label`, `note`).

Contrainte : unicite (`asset_id`, `score_date`).

### `alerts`
Alertes metier actionnables.

Champs clefs :
- `alert_date` ;
- `asset_id` (FK) ;
- `alert_type` ;
- `severity` (1-5) ;
- `status` (`open`, `acknowledged`, `closed`) ;
- `title`, `message`.

## Index

Indexes limites a des usages MVP :
- `targets.is_active` ;
- `portal_stock_snapshot.asset_id` ;
- `market_history_daily.market_date` ;
- `scores_daily.score_date` ;
- `alerts(status, created_at)`.

## Migration

- Schema de reference : `db/schema.sql`
- Migration initiale : `db/migrations/001_init.sql` (identique au schema initial)
- Extension import snapshot Portal : `db/migrations/002_portal_snapshot_import.sql`
- Extension scoring V1 : `db/migrations/003_scores_v1.sql`
- Runner : `src/db/migrate.js` (table `schema_migrations` pour tracer les migrations appliquees)

## Import snapshot Portal versionne

Le moteur supporte un import snapshot complet PKM Portal via :
- commande : `node src/connectors/portal/import-snapshot.js`
- script npm : `portal:import`

### Tables de trace run

#### `portal_snapshot_runs`
Journal de run d'import :
- source ; version schema ; `exported_at`
- hash payload (`payload_hash`) ; origine (`payload_origin`)
- statut (`started`, `success`, `failed`, `skipped_duplicate`)
- `warnings_json` ; `summary_json` ; `error_message`
- reference de duplicate (`duplicate_of_run_id`) si payload deja importe

#### `portal_snapshot_run_payloads`
Stockage optionnel du JSON brut associe a chaque run.

### Tables metier snapshot (granularite fine)

#### `portal_purchase_items`
Lignes d'achat fines ; cle metier preservee `P_ITEM_ID`.

#### `portal_sales_items`
Lignes de vente fines ; cle metier preservee `S_ITEM_ID` ; lien `P_ITEM_ID` conserve quand present.

#### `portal_stock_live_snapshots`
Snapshot operationnel du stock live ; datation via `run_id`/run.

#### `portal_purchase_orders`
Contexte header commandes achat (`P_ORDER_ID`, `Order_owner`) sans remplacer la granularite item.

#### `portal_sales_orders`
Contexte header commandes vente (`S_ORDER_ID`, `Order_owner`) sans remplacer la granularite item.

#### `portal_orders_status`
Bloc contextuel optionnel (type/ref/status/updated_at).

### Principes d'import

- validation envelope (`schema_version`, `exported_at`, blocs requis)
- validation bloc par bloc avec rejet ligne invalide
- warnings structures (code, block, message, count, samples)
- idempotence par hash payload
- reimport identique : run `skipped_duplicate` par defaut
- reimport force possible avec `--allow-duplicate`
