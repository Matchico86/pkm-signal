# Alertes V1

Ce document decrit la couche Alertes V1 de PKM Market Engine.

## Objectif

Transformer `scores_daily` en une liste courte d'alertes actionnables, priorisees, peu bruyantes et relancables sans doublons.

## Types couverts

- `reprice_up`
- `reprice_down`
- `hype_start`
- `supply_tightening`
- `sell_window_watch`
- `watchlist_opportunity`

## Anti-bruit V1

- seuil global de confiance (`minConfidenceGlobal`) ;
- seuils metier par type (score + mouvement) ;
- confirmation par 2 snapshots par defaut ;
- bypass confirmation si mouvement fort ;
- cooldown par type ;
- une seule alerte active max par `asset_id + alert_type` ;
- expiration avec hysteresis minimale (alerte expiree si non revue apres N jours) ;
- cap de creation quotidienne (`maxNewAlertsPerRun`) ;
- cap de sortie humaine (`maxOutputAlerts`).

## Statuts

Cycle de vie :

- `new` : creee et emise ;
- `open` : persistance confirmee ;
- `acknowledged` : prise en compte manuelle, reste active ;
- `acted` : action realisee (terminal) ;
- `dismissed` : rejet manuel (terminal) ;
- `expired` : condition non revue / non validee (terminal).

Une alerte active est `new|open|acknowledged`.

## Scope

- `owned` : cible issue du flux stock (`target.source=portal_stock`) ;
- `watchlist` : cible externe (autre `target.source`).

## Reason codes V1

Les alertes stockent des `reason_codes_json` stables (liste courte), par exemple :

- `PX_ABOVE_LIST`, `PX_BELOW_LIST`
- `PX_7D_UP`, `PX_7D_DOWN`, `PX_30D_UP`
- `SUPPLY_7D_DOWN`, `SUPPLY_7D_UP`
- `LIQ_OK`
- `ROI_TARGET_HIT`
- `MOMENTUM_SLOWING`
- `WATCHLIST_ENTRY`
- `EARLY_SIGNAL`
- `MISSING_PORTAL_REF`

`LOW_CONFIDENCE` reste reserve aux diagnostics internes (pas pour emission standard).

## Priorisation

Ordre metier de base :

1. `reprice_down`
2. `reprice_up`
3. `sell_window_watch`
4. `hype_start`
5. `watchlist_opportunity`
6. `supply_tightening`

Le `priority_score` final combine :

- ordre metier de type ;
- severite (`P1/P2/P3`) ;
- confiance ;
- exposition stock (scope owned) ;
- intensite du mouvement.

## Commande

```bash
node src/jobs/alerts-daily.js --score-date=YYYY-MM-DD --scope=all
```

Via npm :

```bash
npm run alerts:daily -- --score-date=YYYY-MM-DD --scope=all
```

Options utiles :

- `--scope=all|owned|watchlist`
- `--max-new-alerts=<n>`
- `--max-output=<n>`
- `--out-tsv=<path>`
- `--db=<path>`
- `--config-json=<json>` (override partiel de seuils)

## Sortie humaine

Sortie console courte par alerte :

```text
[P1][reprice_down][owned] sv4-001 conf=82 prio=946 :: Marche -9.4% vs ref interne (-4.10 EUR), conf 82%. | action=Verifier rapidement une baisse du prix de vente.
```

TSV optionnel si `--out-tsv` est fourni.

## Limites V1

- pas de push / notification externe ;
- pas d'interface UI ;
- pas de ML ;
- repricing conditionne a une vraie `portal_ref` interne fiable.
