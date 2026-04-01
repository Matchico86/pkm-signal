# Sources Marche V1

Ce document decrit l'ingestion marche V1 basee sur Pokemon TCG API.

## Source retenue

- Source pivot unique: Pokemon TCG API
- Provider prioritaire: Cardmarket (via Pokemon TCG API)
- Fallback unique V1: TCGplayer (via Pokemon TCG API)
- Hors V1: Cardmarket API direct, scraper, autres sources marche

## Pourquoi Cardmarket prioritaire

- Cardmarket est deja exprime en EUR.
- Le moteur V1 evite les melanges implicites de devise.
- Le prix de reference demande est aligne Cardmarket.

## Pourquoi TCGplayer est fallback seulement

- TCGplayer est principalement USD.
- Le fallback TCGplayer n'est utilise que si la conversion USD -> EUR est disponible.
- Conversion V1 simple:
  - flag CLI `--usd-eur-rate=<number>` ou
  - variable d'environnement `PKM_USD_TO_EUR_RATE`
- Sans taux valide:
  - les prix TCGplayer ne sont pas utilises;
  - la carte est loggee `missing_price` ou `partial`;
  - aucune ligne de prix n'est inventee.

## Champs externes retenus (normalisation)

- `external_card_id` <- `id`
- `card_name` <- `name`
- `card_number` <- `number`
- `rarity` <- `rarity`
- `set_id` <- `set.id`
- `set_name` <- `set.name`
- `series` <- `set.series`
- `release_date` <- `set.releaseDate`
- `source_updated_at` <- provider retenu (`cardmarket.updatedAt` ou `tcgplayer.updatedAt`)

## Blocs prix exploites

### Cardmarket

- `trendPrice`
- `averageSellPrice`
- `lowPrice`
- `avg1`
- `avg7`
- `avg30`
- `reverseHoloSell`
- `reverseHoloLow`
- `reverseHoloTrend`
- `reverseHoloAvg1`
- `reverseHoloAvg7`
- `reverseHoloAvg30`

### TCGplayer

- bloc prix principal choisi de maniere deterministe (priorite `normal`, sinon premier bloc exploitable)
- champs utilises:
  - `market`
  - `mid`
  - `low`
  - `high`
  - `directLow`

## Prix de reference et fallback

Ordre de selection du `price_mid_cents`:

1. `cardmarket.trendPrice`
2. `cardmarket.averageSellPrice`
3. `cardmarket.lowPrice`
4. `tcgplayer.market` (si taux USD->EUR valide)
5. `tcgplayer.mid` (si taux USD->EUR valide)
6. `tcgplayer.low` (si taux USD->EUR valide)

Mapping `market_history_daily`:

- `source`: `pokemon_tcg_api`
- `price_mid_cents`: prix de reference
- `price_low_cents`: `cardmarket.lowPrice` ou `tcgplayer.low` converti
- `price_high_cents`: `tcgplayer.high` converti si provider TCGplayer, sinon `null`
- `listings_count`: `null`
- `sales_count`: `null`

## Frequence d'ingestion V1

- Cibles standard: 1 run/jour (`--scope=all`)
- Cibles hot: 2e run optionnel (`--scope=hot`, hot = `priority <= 2`)
- La table `market_history_daily` est journaliere:
  - 1 ligne logique par carte/jour/source
  - le 2e run hot met a jour la ligne du jour

## Qualite et robustesse

Statuts internes job/normalizer:

- `ok`
- `partial`
- `missing`
- `stale`

Regles:

- valeur numerique strictement `> 0`
- aucune invention de prix
- aucun forward fill silencieux dans l'upsert journalier
- erreurs source loggees sans crash global du job
- timeout/retry bornes pour appels API

## Idempotence

Cle logique d'upsert:

- `(asset_id, market_date, source)`

Comportement:

- rerun meme jour: update de la meme ligne
- pas de doublons journaliers evidents

## Limites connues V1

- pas de ligne `reverse_holo` stockee (choix volontaire V1: ligne `default` unique)
- pas de conversion FX automatique externe
- pas d'etat persistant dedie pour espacer les cibles durablement sans data
- pas de scoring, pas d'alertes, pas d'UI

## Execution job

Commande standard:

```bash
npm run market:snapshot -- --market-date=YYYY-MM-DD --scope=all
```

Commande hot:

```bash
npm run market:snapshot -- --scope=hot
```

Options utiles:

- `--target-source=<source>`
- `--usd-eur-rate=<number>`
- `--db=<path>`
- `--fetch-timeout-ms=<ms>`

Variables d'environnement:

- `PKM_POKEMONTCG_API_KEY`
- `PKM_POKEMONTCG_TIMEOUT_MS`
- `PKM_USD_TO_EUR_RATE`
