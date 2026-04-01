# V1 Consolidation Note (Pause Propre)

Date: 2026-03-28

## Audit court

- Scripts V1 confirms:
  - migration: `db:migrate`
  - import Portal operationnel moteur: `portal:import:v1`
  - snapshot marche externe: `market:snapshot`
  - scoring: `scores:daily`
- Migrations presentes:
  - `001_init.sql`
  - `002_portal_snapshot_import.sql`
  - `003_scores_v1.sql`
- Frictions identifiees:
  - runner migration sans statut explicite ni `--db` robuste
  - ambiguite entre import Portal detaille et import stock operationnel
  - incoherence `data/export` vs `data/exports` dans `.gitignore`
  - `.env.example` vide

## Decisions V1 retenues

- Le flux Portal de reference pour executer le moteur V1 jusqu'au scoring est `portal:import:v1` (import stock simple).
- Le flux `portal:import` reste actif pour ingestion detaillee et audit, sans refonte metier.
- Pas de nouvelle feature metier ajoutee dans cette consolidation.

## Migration workflow

- `src/db/migrate.js` supporte maintenant:
  - `--db=<path>`
  - `--status`
  - baseline propre si le schema cible existe deja sans trace `schema_migrations`

Objectif: relancer sans blocage apres pause, sur base locale existante ou neuve.

## Reste volontairement en attente

- Bridge automatique entre tables `portal_snapshot_*` et `portal_stock_snapshot`
- alertes metier thread 50
- reporting riche / UI
