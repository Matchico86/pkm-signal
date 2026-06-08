# Connecteurs Marché FR Strict (POC)

Ce POC implémente l'accès aux données du marché strictement français via RapidAPI (CardMarket) et SerpApi (Google Trends).

## Configuration
Copiez le fichier `.env.example` en `.env` et renseignez les clés d'API.

## Sécurité des Quotas
Afin de ne pas dépasser les quotas gratuits (RapidAPI et SerpApi), une sécurité stricte est en place.
Le POC stocke un compteur local de requêtes dans `data/cache/quotas.json`. 
- Vous pouvez faire au maximum `3` requêtes par exécution.
- Vous pouvez faire au maximum `10` requêtes par jour.
- Le header `x-ratelimit-requests-remaining` de RapidAPI est systématiquement surveillé. S'il passe en dessous de 85, tout s'arrête.

> [!CAUTION]
> **Ne jamais modifier à la main le fichier `quotas.json`** pour contourner la sécurité, au risque de déclencher des appels hors-forfait facturés.

## Utilisation des appels Live
Par défaut, le code ne fait **aucun appel réel** sur le réseau.
Pour désactiver le cache (dry run) et passer en mode "live", vous devez **explicitement** définir dans le fichier `.env` :
```env
RAPIDAPI_LIVE_CALLS_ENABLED=true
SERPAPI_LIVE_CALLS_ENABLED=true
```

> [!TIP]
> Pour **désactiver immédiatement les appels live**, remettez simplement ces variables à `false`. Tout le système rebasculera en échec sécurisé si le cache local n'existe pas.

## Politique "Strict FR"
L'analyse Signal ne peut et ne doit se faire que sur les données France pour la V1.
Tout prix retourné par un connecteur qui ne mentionne pas explicitement que la carte provient de France (ex: `country=FR`, `seller_country=FR` ou condition `lowest_near_mint_FR`) sera automatiquement rejeté et marqué comme `usable_for_signal=false`.
Les prix globaux EU ou US sont formellement interdits pour calculer la rentabilité sur Signal.

## Limites actuelles du POC
- Pas de retries en cas d'échec réseau pour ne pas gâcher les quotas.
- Pas d'appels concurrents.
- Pas de pagination (un seul résultat récupéré par recherche).
- Les données Trend doivent être formatées (Timeseries).
