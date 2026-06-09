# PKM Market Engine

Moteur analytique V1 pour suivre le marche cartes Pokemon, calculer des features simples et produire un scoring interpretable.

## Scope V1

- base SQLite locale
- import PKM Portal
- ingestion marche Pokemon TCG API
- scoring journalier lisible
- alertes journalieres actionnables

Hors scope ici: UI, ML, nouvelles sources externes complexes, V2/V3.

## Etat actuel (pause propre)

- schema cible aligne avec `db/schema.sql`
- migrations versionnees dans `db/migrations/`
- pipeline V1 relancable localement: migrate -> import Portal -> snapshot marche -> scoring -> alertes
- repricing protege: pas de `portal_ref` interne fiable => `score_reprice=0`, `reprice_direction=NONE`

## Prerequis

- Node.js 22+ (utilisation de `node:sqlite`)
- npm

## Configuration

1. Copier `.env.example` vers `.env`
2. Ajuster au minimum `PKM_DB_PATH` et les chemins de fichiers locaux
3. Ajouter `PKM_POKEMONTCG_API_KEY` si vous utilisez `market:snapshot`

## Workflow local minimal

### 1) Migrer la base

```bash
npm run db:migrate
```

Verifier le statut des migrations:

```bash
npm run db:migrate:status
```

### 2) Import Portal (V1 operationnel moteur)

Source de reference V1 pour alimenter `targets` + `portal_stock_snapshot`:

```bash
npm run portal:import:v1 -- --file=data/export/portal-stock.json --snapshot-at=YYYY-MM-DD
```

### 3) Snapshot marche externe

```bash
npm run market:snapshot -- --market-date=YYYY-MM-DD --scope=all
```

Options utiles:
- `--scope=hot`
- `--target-source=portal_stock`
- `--usd-eur-rate=<number>`
- `--db=<path>`

### 4) Calcul scoring journalier

```bash
npm run scores:daily -- --score-date=YYYY-MM-DD --scope=all
```

### 5) Generation alertes journalieres

```bash
npm run alerts:daily -- --score-date=YYYY-MM-DD --scope=all
```

## Imports Portal: quel flux utiliser

Deux flux coexistent volontairement:

- `portal:import:v1` (`import-stock.js`): flux operationnel V1 du moteur (tables `targets` et `portal_stock_snapshot`)
- `portal:import` (`import-snapshot.js`): flux detaille et traceable (tables `portal_snapshot_*`, `portal_*_items`, etc.)

Decision V1 actuelle:
- pour faire tourner le pipeline moteur jusqu'au scoring, utiliser `portal:import:v1`
- utiliser `portal:import` pour l'audit detaille et la qualite d'import Portal

## Scripts npm utiles

- `db:migrate`
- `db:migrate:status`
- `portal:import:v1`
- `portal:import`
- `market:snapshot`
- `market:import` (import local JSON, utile pour tests offline)
- `scores:daily`
- `alerts:daily`

## Documentation

- `docs/schema-v1.md`
- `docs/sources-market.md`
- `docs/scoring-v1.md`
- `docs/alerts-v1.md`
- `docs/v1-runbook.md`
- `docs/v1-consolidation.md`
