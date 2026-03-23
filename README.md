# PKM Market Engine

Moteur de surveillance marché / hype / valorisation pour cartes Pokémon.

## But du projet

PKM Market Engine est un projet séparé de PKM Portal.

- **PKM Portal** ; outil métier ; stock ; achats ; ventes ; opérations
- **PKM Market Engine** ; moteur analytique ; snapshots marché ; scoring ; alertes ; watchlist

L’objectif de la V1 est de produire rapidement des **signaux exploitables** sur :
- le stock importé depuis PKM Portal ;
- une watchlist externe ;
- les cartes chères ; récentes ; chase ; alt ; SAR ; équivalents.

## Philosophie V1

Le projet doit rester :
- simple ;
- modulaire ;
- lisible ;
- exploitable vite ;
- améliorable plus tard.

On évite volontairement :
- la surconception ;
- le temps réel ;
- les dépendances cloud inutiles ;
- l’UI complexe ;
- le machine learning ;
- le sealed fonctionnel en V1.

## Stack V1

- **Base principale** ; SQLite
- **Repo local** ; développement avec Codex
- **Source métier interne** ; PKM Portal via export contrôlé
- **Sources externes pivot** ; Pokémon TCG API en priorité
- **Sortie V1** ; reporting simple ; exports ; alertes lisibles

## Objectifs V1

1. stocker un référentiel minimal des cartes surveillées ;
2. importer le stock utile depuis PKM Portal ;
3. récupérer des snapshots marché externes ;
4. calculer des features simples ;
5. produire des scores lisibles ;
6. émettre des alertes actionnables ;
7. générer une lecture humaine minimale.

## Hors périmètre V1

- app complète type Collectr ;
- auth ;
- sync temps réel ;
- sealed fonctionnel ;
- IA / modèle prédictif ;
- multi-sources complexes si faible valeur immédiate ;
- migration PostgreSQL immédiate.

## Structure du repo

```text
pkm-market-engine/
├─ README.md
├─ AGENTS.md
├─ .gitignore
├─ .env.example
├─ docs/
├─ db/
├─ data/
├─ src/
├─ scripts/
├─ tests/
└─ logs/