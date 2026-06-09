# Connecteur : eBay Observation (Browse API)

## Statut
- **Type** : Observation Officielle
- **Phase** : V1 - Implémentation Client (Mockée)
- **Status métier** : `usable_for_price_decision=false`

## Description
Ce connecteur attaque l'API officielle eBay (Browse API - `item_summary/search`).
Il cherche les annonces **actives** en filtrant sur la localisation française (`itemLocationCountry:FR`).

## Règles strictes
- Les prix retournés par eBay **ne peuvent en aucun cas** servir de prix de référence.
- Seule l'observation d'opportunités de rachat (sniping) ou l'étude de la liquidité active est permise.
- Si le `currency` n'est pas EUR, ou si la localisation n'est pas FR, l'annonce est rejetée ou marquée d'un warning.
- L'indicateur `usable_for_opportunity_signal` ne passe à `True` que si des annonces sont trouvées et strictement locales.

## Sécurité
- Ce connecteur respecte le flux complet de la Phase 2 :
  - `quotas.json` local (limite par run et par jour).
  - Variables de garde-fous `.env` (`EBAY_LIVE_CALLS_ENABLED`).
  - Cache préemptif local réduisant les requêtes au strict nécessaire.
