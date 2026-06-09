# Phase 5 : Sources d'Observation (Marketplaces)

Ce document de design prépare le terrain pour l'intégration future de nouvelles plateformes d'observation au sein de PKM Signal. **Aucune implémentation n'est prévue dans l'immédiat.**

## Règles d'Or Fondamentales

1. **Monopole Décisionnel CardMarket FR** : Seul le connecteur CardMarket FR Strict sert de base au calcul de rentabilité et aux décisions d'alerte.
2. **Rôle d'Observation** : eBay, Vinted, Leboncoin et autres servent uniquement de **sondes de liquidité** et d'indicateurs de tendances parallèles (hype). Leurs prix ne sont jamais moyennés avec CardMarket.
3. **Sécurité Technique Obligatoire** : Aucun connecteur (officiel ou scraper) ne peut être intégré sans le socle de sécurité validé en Phase 2 :
   - Quotas locaux stricts (`quotas.json`).
   - Cache préemptif (aucun appel réseau si le cache est valide).
   - Variables d'environnement de protection (`LIVE_CALLS_ENABLED=false` par défaut).
   - Suite de tests unitaires 100% hors-ligne (Mocks).
4. **Comportement Éthique** : Le scraping agressif est formellement interdit. Les appels doivent être parcimonieux, isolés et ne jamais surcharger les cibles non-officielles.

---

## Étude Comparative des Sources

| Source | Accès API Officiel | Coût | Quota / Limite | Risque (Blocage) | Pertinence FR | Usage Possible pour Signal |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **eBay** | **Oui** (REST API / Browse API) | Gratuit | Élevé | **Faible** (officiel) | **Haute** (Filtre `LocatedIn=FR`) | **Candidat officiel à tester pour observation**. Potentiellement limité (la Browse API cible surtout les annonces actives). Mesure de liquidité, pas un prix de référence. |
| **Vinted France** | **Non** (Fermée) | Gratuit | N/A | **Très Élevé** (Datadome/Ban) | **Très Haute** | **Lab à haut risque scraping**, exclu de la V1. Indice de hype grand public. |
| **Leboncoin France** | **Non** | Gratuit | N/A | **Très Élevé** (Datadome) | **Très Haute** | **Lab à haut risque scraping**, exclu de la V1. Fort bruit (fausses annonces). |
| **Catawiki** | **Non public** | - | - | **Élevé** | **Moyenne** | **Option premium à étudier**. Observation enchères haut de gamme / scellé. |
| **CCC** | **À clarifier** | ? | ? | **?** | **À évaluer** | Source en attente d'une clarification métier exacte avant tout classement définitif. |

## Conclusion et Recommandations
À l'avenir, si une Phase de développement est lancée sur ces sources :
- **CardMarket FR strict reste l'absolue et unique source prix décisionnelle** du moteur.
- **eBay** se positionne comme le meilleur candidat officiel à tester pour l'observation et la liquidité (sans impact décisionnel sur le prix).
- **Vinted et Leboncoin** restent des laboratoires à haut risque de blocage (scraping) et sont par conséquent exclus du périmètre V1.
- **Catawiki** et **CCC** demeurent des options d'observation premium ou de niche nécessitant une étude ultérieure approfondie.
