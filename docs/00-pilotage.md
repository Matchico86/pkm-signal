# Pilotage des phases PKM Signal (Assistant V1)

Ce document centralise l'état d'avancement, l'architecture et l'ordre des chantiers entre PKM Portal (Supabase) et PKM Signal. Il est maintenu par le thread **00 Pilotage**.

- **Traitement Asynchrone (Event-Driven)** : Signal est un "Worker" asynchrone. Portal écrit son contexte dans Supabase (`assist_sessions`). Signal écoute ces changements, fait son analyse en tâche de fond, et écrit ses alertes en retour.
- **Heartbeat Hybride (Nouveau)** : Pour des raisons de simplicité d'intégration frontend, Signal expose un mini-serveur HTTP sur le port 3000 servant uniquement une route `GET /health`. Cela permet à Portal de gérer l'état de la pastille (Active/Inactive) sans faire de polling Supabase inutile.
- **Restitution Supabase** : Les résultats d'analyse (les Signaux) sont stockés dans Supabase (`assist_signals`) pour que le frontend Portal puisse les afficher facilement.

---

## 🏗️ Architecture "Assistant" & Tables Supabase

Côté Supabase (Portal), le système d'assistant repose sur 3 tables minimalistes validées pour la V1 :

1. **`assist_sessions`** : Suit le contexte vivant (ex: un draft d'achat `local-buy-123`).
2. **`assist_runs`** : Historise chaque exécution d'analyse par Signal pour la traçabilité.
3. **`assist_signals`** : Stocke les messages/alertes générés (le livrable affichable dans Portal).

*(Note : La logique métier pure, ou "patterns", reste codée en dur dans Signal V1 pour la vélocité).*

---

## 🚦 Chantiers & Plan de Vol

| Étape | Description | Statut |
|---|---|---|
| **Étape 0** | Création des tables `assist_*` dans Supabase | ✅ Terminé |
| **Étape 1** | Câblage Métier : Achat (`buy.order`) | ✅ Terminé |
| **Étape 2** | Câblage Métier : Vente (`sell.order`) | ✅ Terminé |
| **Étape 3** | Câblage Métier : Stock global (`stock`) | ⏳ À faire |

### Fonctionnement du Branchement Métier (ex: Étape 1)
Pour chaque branchement (ex: `buy.order`), le flux sera :
1. Définition du Payload JSON attendu.
2. Écriture du `Pattern` (logique d'analyse) dans Signal (`src/core/patterns/buy/...`).
3. Écriture du test unitaire sur un faux payload JSON.
4. Validation du cycle : *Réception JSON -> Analyse -> Génération d'enregistrements `assist_signals`.*

---

## ⏳ Chantiers Temporaires (Bridges)

| Étape | Description | Statut |
|---|---|---|
| **Bridge 1** | Export historique Google Sheets (Ventes, Achats, Stock, Invest) via API temporaire | 🟡 En cours |
