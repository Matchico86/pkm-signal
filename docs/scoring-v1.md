# Scoring V1

Ce document decrit le calcul journalier des features et scores V1.

## Objectif

Transformer les snapshots marche + stock en :

- features interpretable V1 ;
- sous-scores lisibles ;
- score final amorti par la confiance ;
- reason codes simples.

Le scope couvre uniquement le thread 40 (pas d'alertes, pas de dashboard, pas de ML).

## Entree du calcul

Par asset et `score_date` :

- `p0` : prix ref du jour depuis `market_history_daily`
- `p3`, `p7`, `p14`, `p30` : dernier prix ref disponible avant J-3/J-7/J-14/J-30
- snapshot stock le plus recent `<= score_date` depuis `portal_stock_snapshot`
- `portal_ref` : vraie reference interne Portal (cote/prix interne) quand disponible

Prix ref du jour :

- priorite `price_mid_cents`
- fallback `(low+high)/2`
- fallback `price_low_cents`
- fallback `price_high_cents`

## Features V1

- `d3`, `d7`, `d14`, `d30` = `(p0/pX)-1`
- `momentum_short_raw` = weighted mean de `d3` (0.6) et `d7` (0.4)
- `momentum_mid_raw` = weighted mean de `d14` (0.6) et `d30` (0.4)
- `acceleration_raw` = `momentum_short_raw - momentum_mid_raw`
- `spread_raw` :
  - `(high-low)/p0` si low/high disponibles
  - sinon dispersion des refs du meme jour si multi-source
- `spread_quality` = `1 - clamp01((spread_raw-0.08)/(0.35-0.08))`
- `freshness_score` = `1 - clamp01(days_since_last_market_snapshot/3)`
- `history_depth` = lookbacks dispo sur (3,7,14,30) / 4
- `cross_confirmation` = confirmations valides / checks disponibles
- `stock_exposure` = `0.35*qty_exposure + 0.65*value_exposure`
  - `qty_exposure = clamp01(stock_qty/4)`
  - `value_exposure = clamp01((stock_qty*p0)/150)`
- `pricing_gap_pct` = `(p0-portal_ref)/portal_ref` (si `portal_ref` existe)

## Normalisation

Helpers :

- `clamp01(x)`
- `pos(x, cap)`
- `neg(x, cap)`
- `weighted_mean` avec renormalisation des poids disponibles

Caps V1 :

- short = 0.20
- mid = 0.35
- accel = 0.15
- pricing gap = 0.20

Variables normalisees :

- `ms_up`, `ms_dn`
- `mm_up`, `mm_dn`
- `acc_up`, `acc_dn`
- `gap_up`, `gap_dn`

## Scores

Confidence :

- `confidence_score_raw` = weighted mean(`freshness_score` 0.35, `history_depth` 0.25, `spread_quality` 0.20, `cross_confirmation` 0.20)
- `confidence_score` = `round(100 * confidence_score_raw)`

Sous-scores bruts :

- `score_tension_raw`
- `score_hype_raw`
- `reprice_up_raw`, `reprice_down_raw`, `score_reprice_raw`
- `score_sell_watch_raw`
- `score_buy_watch_raw`

Direction repricing :

- `UP` si `reprice_up_raw > reprice_down_raw + 0.05`
- `DOWN` si `reprice_down_raw > reprice_up_raw + 0.05`
- sinon `NONE`

Garde-fou :

- si `portal_ref` absent : `score_reprice = 0`, `reprice_direction = NONE`
- si `portal_ref` absent, `score_reprice` inclut le reason code `MISSING_PORTAL_REF`

Passage en score final :

- `score_final = round(100 * score_raw * (0.6 + 0.4*confidence_score_raw))`

Scores stockes :

- `score_tension`
- `score_hype`
- `score_reprice`
- `score_sell_watch`
- `score_buy_watch`

## Reason codes

`reason_codes_json` stocke un objet par score :

- `score_tension`
- `score_hype`
- `score_reprice`
- `score_sell_watch`
- `score_buy_watch`

Regles :

- max 3 codes par score
- codes tries par importance
- inclusion de freins principaux si le score est degrade

Codes V1 utilises :

- `MOM_SHORT_UP`, `MOM_SHORT_DOWN`
- `MOM_MID_UP`, `MOM_MID_DOWN`
- `ACC_UP`, `ACC_DOWN`
- `SPREAD_TIGHT`, `SPREAD_WIDE`
- `DATA_FRESH`, `DATA_STALE`
- `CONFIRM_STRONG`, `CONFIRM_WEAK`
- `STOCK_EXPOSED_HIGH`
- `GAP_UP_TO_MARKET`, `GAP_DOWN_TO_MARKET`
- `OVEREXTENDED_30D`
- `MISSING_HISTORY`
- `MISSING_PORTAL_REF`

## Stockage `scores_daily`

Le job remplit `scores_daily` avec upsert idempotent par `(asset_id, score_date)` :

- champs features/qualite/contexte
- scores finals
- `confidence_score`
- `reason_codes_json`
- `score_version = v1`

Compat legacy conservee :

- `score_value` (max des 5 scores finals)
- `score_label` (score dominant)
- `note` (meta courte)

## Commande

Calcul complet :

```bash
node src/jobs/scores-daily.js --score-date=YYYY-MM-DD --scope=all
```

Via npm :

```bash
npm run scores:daily -- --score-date=YYYY-MM-DD --scope=all
```

Mode hot :

```bash
npm run scores:daily -- --scope=hot
```

Options :

- `--target-source=<source>`
- `--db=<path>`
- `--config-json=<json>` (override partiel des caps/poids/seuils)

## Limites V1

- pas de modelisation avancee du carnet/offre
- pas de multi-source comparee riche
- repricing actif uniquement avec vraie reference interne Portal ; le cout moyen stock n'est pas utilise
- pas d'alertes automatiques (thread 50)
