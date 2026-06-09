# Connecteur : Leboncoin Observation

## Statut
- **Type** : Stub uniquement
- **Phase** : V1 - Exclu
- **Status métier** : `usable_for_price_decision=false`, `usable_for_opportunity_signal=false`

## Description
Leboncoin est la référence de la petite annonce en France, incontournable pour les "sorties de grenier" ou les lots Pokémon bruts.

## Risque de Scraping
Comme Vinted, Leboncoin déploie des mesures anti-bots massives (Datadome / PerimeterX) pour protéger les données de ses utilisateurs C2C. Un scraping intensif sera instantanément bloqué. De plus, les annonces LBC sont souvent "polluées" (annonces "Faire offre", proxies, fausses cartes).

## Règle V1
Ce connecteur existe sous forme de contrat (Stub) pour démontrer l'architecture d'intégration future, mais ne lance **aucune requête réseau**.
