# Contrats : Observation Marketplaces

Ce document synthétise l'architecture et les règles encadrant les connecteurs d'observation (Phase 6).

## 1. Prix Décisionnel vs Observation

L'architecture de PKM Signal opère une séparation étanche entre deux concepts :

### A. Le Prix Décisionnel (Prix de Référence)
- **Monopole** : CardMarket FR Strict.
- **Rôle** : Base unique pour les calculs de scoring, de rentabilité, et le déclenchement des alertes.
- **Contrat** : `usable_for_price_decision=true`.

### B. L'Observation (Liquidité & Hype)
- **Acteurs** : eBay, Vinted, Leboncoin, Catawiki, etc.
- **Rôle** : Fournir du contexte métier ("Est-ce que cette carte se vend beaucoup ailleurs ?", "Y a-t-il une hype soudaine sur eBay ?").
- **Contrat** : `usable_for_price_decision=false` **(Toujours et sans exception)**.

## 2. Statut des Connecteurs d'Observation

| Connecteur | Implémentation | Raison |
| :--- | :--- | :--- |
| **eBay** | Client Mocké | Meilleur candidat officiel pour tester l'observation, grâce à son API "Browse". L'observation se limite aux annonces **actives**. |
| **Vinted** | Stub statique | Risque de scraping trop élevé (Datadome). Exclu de la V1, présent uniquement pour illustrer le contrat. |
| **Leboncoin** | Stub statique | Risque de scraping trop élevé (Datadome). Exclu de la V1, présent uniquement pour illustrer le contrat. |

## 3. Schéma Commun (Le Contrat)

Tout connecteur d'observation doit retourner une structure JSON prévisible.

```json
{
  "source": "nom_de_la_source",
  "market": "FR",
  "type": "listing_observation",
  "query": "nom de la carte",
  "items": [
    {
      "title": "Titre",
      "price": 0.0,
      "currency": "EUR",
      "seller_country": "FR",
      "item_location_country": "FR"
    }
  ],
  "usable_for_price_decision": false,
  "usable_for_opportunity_signal": true, 
  "warnings": []
}
```

- `usable_for_price_decision` doit être hardcodé à `False`.
- `usable_for_opportunity_signal` ne passe à `True` que si des annonces sont trouvées et prouvées être physiquement en France et en Euros.
- Si le statut est un simple Stub, la clé `"status": "stub_only"` est présente et les signaux sont tous à `False`.

## 4. Règles de Sécurité

Tout comme pour CardMarket et SerpApi, tout connecteur d'observation doit obligatoirement implémenter :
1. **Cache Préemptif** : `_read_cache` doit être exécuté avant la moindre ligne logique (Zéro appel réseau si cache).
2. **Quota Local** : `quotas.json` avec limitation par jour et par exécution.
3. **Variables d'environnement** : Un flag spécifique (`EBAY_LIVE_CALLS_ENABLED`) qui bloque tout par défaut (Fail-closed).
4. **Mock Unitaires** : Couverture totale sans réseau.
