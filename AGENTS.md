
## `AGENTS.md`

```md
# AGENTS.md

## Rôle de ce fichier

Ce fichier donne le cadre de travail pour les agents de code intervenant sur ce repo.

Objectif ;
- garder le projet simple ;
- respecter le scope V1 ;
- éviter la dérive d’architecture ;
- produire du code directement utile.

## Contexte produit

PKM Market Engine est un moteur séparé de PKM Portal.

- **PKM Portal** ; source métier principale ; stock ; achats ; ventes
- **PKM Market Engine** ; moteur analytique ; surveillance marché ; scoring ; alertes

Le moteur doit aider à détecter :
- tensions de marché ;
- débuts de hype ;
- opportunités de surveillance ;
- opportunités de reprice ;
- fenêtres potentielles de vente.

## Règle centrale

Toujours privilégier :
- simplicité ;
- robustesse ;
- lisibilité ;
- modularité ;
- livraison rapide.

Toujours éviter :
- surconception ;
- abstractions prématurées ;
- dépendances inutiles ;
- refontes larges sans besoin clair ;
- logique opaque.

## Scope V1

La V1 couvre uniquement :
- les **cartes**
- le **stock utile** importé depuis PKM Portal
- une **watchlist externe**
- des **snapshots marché**
- des **features simples**
- des **scores lisibles**
- des **alertes actionnables**
- un **reporting minimal**

## Hors scope V1

Ne pas implémenter sans demande explicite :
- sealed fonctionnel ;
- application complète ;
- auth ;
- temps réel ;
- machine learning ;
- système de recommandation avancé ;
- pipeline cloud complexe ;
- migration PostgreSQL ;
- refonte UX riche.

## Stack attendue

- base principale ; **SQLite**
- stockage local ; **fichier `.db`**
- code modulaire dans `src/`
- docs fonctionnelles dans `docs/`

## Structure logique à respecter

- `src/connectors/` ; acquisition de données
- `src/core/` ; logique métier pure
- `src/jobs/` ; orchestration
- `src/reporting/` ; sorties lisibles
- `src/db/` ; accès SQLite ; migrations ; requêtes

Ne pas mélanger massivement :
- acquisition externe ;
- logique métier ;
- rendu ;
- SQL brut.

## Ordre de développement à respecter

1. schéma SQLite ;
2. import PKM Portal ;
3. ingestion sources externes ;
4. calcul des features ;
5. scoring ;
6. alertes ;
7. reporting ;
8. fiabilisation.

Ne pas sauter directement à l’UI ou à des optimisations futures.

## Sources de vérité

### Fonctionnel
- `README.md`
- `docs/*.md`
- thread **00 Pilotage**

### Technique
- `db/schema.sql`
- `db/migrations/*.sql`

En cas de doute ;
- suivre le schéma existant ;
- minimiser les changements ;
- documenter les écarts nécessaires.

## Principes de code

### Général
- écrire petit ; clair ; testable ;
- une responsabilité par module ;
- pas de framework lourd sans besoin ;
- commentaires utiles seulement ;
- pas de “magic numbers” non expliqués ;
- privilégier des fonctions pures pour les calculs métier.

### Nommage
- noms explicites ;
- éviter les sigles non documentés ;
- garder une cohérence entre SQL ; JS/TS/Python ; docs.

### Erreurs
- ne pas échouer silencieusement ;
- remonter les erreurs avec contexte utile ;
- journaliser les échecs de jobs ;
- éviter les `catch` vides.

### Évolutivité
- préparer la V2 sans l’implémenter ;
- pas de table ou couche inutile “au cas où” ;
- préférer une migration simple plus tard à une complexité immédiate.

## Principes SQL

- SQLite d’abord ;
- schéma lisible ;
- peu de tables ;
- index seulement si utiles ;
- contraintes raisonnables ;
- historique conservé quand il a de la valeur ;
- séparer si possible :
  - référentiel ;
  - snapshots ;
  - calculs ;
  - alertes.

Ne pas introduire de complexité relationnelle excessive tant que le besoin n’est pas prouvé.

## Principes métier

### Cibles surveillées
Le moteur ne surveille pas tout le catalogue.

Il priorise :
- cartes chères ;
- cartes récentes ;
- chase cards ;
- alt / SAR / équivalents ;
- stock utile ;
- watchlist forcée.

### Signal
Les signaux doivent être :
- interprétables ;
- actionnables ;
- peu bruyants ;
- compatibles avec validation humaine.

### Score
Le scoring V1 doit rester :
- transparent ;
- pondéré ;
- modulaire ;
- non prédictif ;
- sans black box.

## Règles de modification

Avant une modification importante ;
- vérifier si elle change le scope V1 ;
- vérifier si elle touche le schéma ;
- vérifier si elle mérite une note dans `docs/`.

Pour toute modification structurelle ;
- mettre à jour la doc concernée ;
- garder le diff aussi petit que possible ;
- éviter les renommages massifs gratuits.

## Ce qu’un agent doit faire en priorité

Quand une tâche arrive ;
1. identifier si elle relève du scope V1 ;
2. choisir la plus petite implémentation utile ;
3. préserver la structure du repo ;
4. documenter si nécessaire ;
5. éviter les ajouts non demandés.

## Ce qu’un agent doit éviter

- ajouter une couche d’abstraction sans besoin immédiat ;
- remplacer toute une architecture pour un gain mineur ;
- créer de nouveaux dossiers inutiles ;
- mélanger MVP et idées V2 ;
- coder des fonctionnalités futures non validées ;
- faire de gros refactors opportunistes.

## Livrable attendu du repo

À court terme, le repo doit pouvoir :
- créer la base SQLite ;
- importer le stock utile ;
- récupérer des snapshots marché ;
- calculer les scores du jour ;
- générer des alertes lisibles.

Si une proposition n’aide pas directement ce flux, elle doit être suspecte.

## En cas d’arbitrage

Toujours choisir dans cet ordre :
1. simplicité ;
2. vitesse de livraison ;
3. lisibilité ;
4. robustesse ;
5. extensibilité raisonnable.

Pas l’inverse.