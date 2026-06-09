import os
import json
import argparse
import sys
from dotenv import load_dotenv

from connectors.prices.cardmarket_api_tcg_client import CardmarketApiTcgClient
from connectors.trends.serpapi_trends_client import SerpapiTrendsClient

def main():
    parser = argparse.ArgumentParser(description="PKM Signal - Sonde Marché FR Strict")
    parser.add_argument("--query", required=True, help="Nom de la carte à analyser (ex: 'Dracaufeu ex')")
    parser.add_argument("--live", action="store_true", help="Autoriser les appels réels (sous réserve des variables .env)")
    parser.add_argument("--limit", type=int, default=1, help="Limite de résultats (actuellement toujours 1 par le POC)")
    parser.add_argument("--source", choices=['price', 'trends', 'both'], default='both', help="Source de données à analyser")
    
    args = parser.parse_args()
    
    # Load .env (Though guards load it too, good practice)
    load_dotenv()
    
    # Si --live N'EST PAS passé, on GARANTIT le dry-run en forçant les variables d'environnement
    if not args.live:
        print("[INFO] Mode dry-run (pas de --live). Blocage forcé des appels réseau au niveau processus.")
        os.environ["RAPIDAPI_LIVE_CALLS_ENABLED"] = "false"
        os.environ["SERPAPI_LIVE_CALLS_ENABLED"] = "false"
    else:
        print("[INFO] Mode --live demandé par CLI. Les appels réels sont soumis aux variables LIVE_CALLS_ENABLED du .env.")
    
    print(f"[INFO] Analyse pour la requête : '{args.query}' (Source: {args.source})")
    
    price_snapshot = {}
    trend_snapshot = {}
    
    # 1. Fetch Prices
    if args.source in ['price', 'both']:
        print("[INFO] Récupération des prix CardMarket...")
        price_client = CardmarketApiTcgClient()
        price_snapshot = price_client.fetch_price(args.query)
    
    # 2. Fetch Trends
    if args.source in ['trends', 'both']:
        print("[INFO] Récupération des trends SerpApi...")
        trend_client = SerpapiTrendsClient()
        trend_snapshot = trend_client.fetch_trends(args.query)
    
    # 3. Combine Results
    warnings = price_snapshot.get("warnings", []) + trend_snapshot.get("warnings", [])
    
    usable = True
    if args.source in ['price', 'both'] and not price_snapshot.get("usable_for_signal", False):
        usable = False
    if args.source in ['trends', 'both'] and not trend_snapshot.get("usable_for_signal", False):
        usable = False
        
    output_data = {
        "query": args.query,
        "source": args.source,
        "price_snapshot": price_snapshot,
        "trend_snapshot": trend_snapshot,
        "usable_for_signal": usable,
        "warnings": warnings
    }
    
    # 4. Write Output
    output_dir = os.path.join(os.path.dirname(__file__), "..", "outputs")
    os.makedirs(output_dir, exist_ok=True)
    output_file = os.path.join(output_dir, "market_fr_probe.json")
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
        
    print(f"[SUCCESS] Résultat écrit dans : {output_file}")
    
    # Quick summary in console
    if usable:
        print("\n=> [STATUS] USABLE FOR SIGNAL: OK")
    else:
        print("\n=> [STATUS] USABLE FOR SIGNAL: REJECTED")
        for w in warnings:
            print(f"   - {w}")

if __name__ == "__main__":
    main()
