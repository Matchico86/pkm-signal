# Connecteur : Vinted Observation

## Statut
- **Type** : Stub uniquement
- **Phase** : V1 - Exclu
- **Status métier** : `usable_for_price_decision=false`, `usable_for_opportunity_signal=false`

## Description
Vinted représente un volume énorme pour le marché Pokémon FR grand public. Néanmoins, l'absence d'API officielle publique nous obligerait à utiliser du scraping.

## Risque de Scraping
Vinted utilise des protections anti-bot sévères (Datadome/Cloudflare). Le risque de bannissement IP est très élevé. Toute tentative d'automatisation nécessiterait des proxys rotatifs résidentiels, ce qui sort totalement du cadre d'un POC simple et éthique.

## Règle V1
Ce connecteur existe sous forme de contrat (Stub) pour démontrer l'architecture d'intégration future, mais ne lance **aucune requête réseau**.
