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
- `score_value` ;
- `score_label` et `note` (optionnels).

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
- Runner : `src/db/migrate.js` (table `schema_migrations` pour tracer les migrations appliquees)
