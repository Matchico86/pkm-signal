# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et ce projet adhère à [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-06-11

### ✨ Fonctionnalités (Features)
- **signal**: ajout du calcul de progression de set pour les cartes manquantes (2026-06-11)
- **signal**: ajout d'une logique de détection stricte des variantes et des upgrades (2026-06-10)
- **signal**: consolidation des sorties en un seul signal et ajout des détails d'achats/ventes (2026-06-10)
- **signal**: ajout du signal `buy_status` basé sur le prix d'achat moyen (sheets) (2026-06-10)
- **signal**: mapping dynamique des propriétaires et séparation des sources sheets/supabase (2026-06-10)
- **signal**: émission systématique des signaux collection, stock et invest (2026-06-10)
- **signal**: routage des événements d'achat vers l'enrichissement interne (2026-06-10)
- **signal**: simplification des faits de réponse internes du portail et des signaux (2026-06-10)
- **signal**: connexion de l'API supabase (read-only) pour l'enrichissement interne (2026-06-10)
- **signal**: connexion de l'API sheets (portail) pour l'enrichissement interne (2026-06-10)
- **signal**: connexion du probe à l'export sheets local et génération d'indices portail (2026-06-09)
- **signal**: ajout d'un outil de diagnostic interne en lecture seule (portal probe) (2026-06-09)
- **trends**: ajout d'un pipeline réactif de sélection de mots-clés (2026-06-09)
- **orchestration**: configuration des jobs quotidiens, point d'entrée worker et fonctions netlify (2026-06-09)
- **core**: ajout de la logique assistant et connecteurs base de données supabase (2026-06-09)
- **db**: implémentation du schéma d'alertes et mise à jour des scripts de migration (2026-06-09)
- **connectors**: ajout des adaptateurs d'observation des marketplaces (2026-06-09)
- **connectors**: ajout des clients API market fr et du CLI probe (2026-06-09)
- **connectors**: ajout de la fondation POC protégée pour market fr (2026-06-08)

### 🐛 Corrections (Fixes)
- **signal**: correction des variables non définies dans l'adaptateur d'export sheets (2026-06-11)
- **signal**: détection correcte de `collection_cards` avec fallback sur le propriétaire mathieu (2026-06-11)
- **signal**: remplacement de `.or` par `.in` et fallback sur `cote_date` pour Supabase (2026-06-10)
- **signal**: requêtes Supabase (`cote_history` et `collection`) avec multiples clés de cartes (TCGDex et original) (2026-06-10)
- **signal**: priorité au format TCGDex (avec `set_id` et `number`) plutôt qu'au `card_id` (2026-06-10)
- **signal**: utilisation d'une correspondance insensible à la casse pour `card_id` dans les requêtes Supabase (2026-06-10)
- **signal**: fallback sur `created_at` quand la date manque dans `cote_history` (2026-06-10)
- **signal**: messages combinés pour l'UI et correction de l'empoisonnement du cache interne (2026-06-10)
- **signal**: utilisation de l'unité `internal_market_price_unit` pour la cote si fournie (2026-06-10)
- **worker**: autorisation des slots d'événements et utilisation de `event_type` comme slot (2026-06-10)

### 📚 Documentation (Docs)
- mise à jour des spécifications v1, runbooks et métriques de pilotage (2026-06-09)
- **connectors**: présentation des sources d'observation de marketplaces (2026-06-09)

## [1.0.0] - 2026-04-02
### ✨ Fonctionnalités
- Initialisation du projet (Initial commit et premier commit) (2026-03-23 / 2026-04-02)
