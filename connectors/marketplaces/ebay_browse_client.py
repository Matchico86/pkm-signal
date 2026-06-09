import os
import json
import requests
from connectors.marketplaces.ebay_guard import EbayGuard

class EbayBrowseClient:
    def __init__(self):
        self.guard = EbayGuard()
        self.base_url = "https://api.ebay.com/buy/browse/v1"
        
    def _get_cache_filename(self, query: str) -> str:
        safe_query = "".join([c if c.isalnum() else "_" for c in query])
        return f"{safe_query}.json"

    def _get_cache_dir(self) -> str:
        cache_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'ebay_browse')
        os.makedirs(cache_dir, exist_ok=True)
        return cache_dir

    def _read_cache(self, query: str):
        filepath = os.path.join(self._get_cache_dir(), self._get_cache_filename(query))
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f), f"data/cache/ebay_browse/{self._get_cache_filename(query)}"
        return None, None

    def _save_cache(self, query: str, raw_data: dict) -> str:
        filename = self._get_cache_filename(query)
        filepath = os.path.join(self._get_cache_dir(), filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(raw_data, f)
            
        return f"data/cache/ebay_browse/{filename}"

    def fetch_active_listings(self, query: str, limit: int = 5) -> dict:
        """
        Fetches active listings from eBay Browse API.
        Strictly an observation source. usable_for_price_decision=False always.
        """
        # 0. Check Cache First
        cached_data, cache_path = self._read_cache(query)
        
        if cached_data is not None:
            raw_data = cached_data
        else:
            # 1. Pre-call Security Check
            try:
                self.guard.check_pre_call()
            except Exception as e:
                return {
                    "source": "ebay_browse",
                    "market": "FR",
                    "type": "listing_observation",
                    "query": query,
                    "items": [],
                    "usable_for_price_decision": False,
                    "usable_for_opportunity_signal": False,
                    "warnings": [f"guard_blocked: {str(e)}"]
                }
                
            # 2. Prepare Request (Mocking OAuth token for this phase)
            url = f"{self.base_url}/item_summary/search"
            headers = {
                "Authorization": "Bearer MOCKED_TOKEN_PHASE_6",
                "X-EBAY-C-MARKETPLACE-ID": self.guard.marketplace_id
            }
            params = {
                "q": query,
                "limit": limit,
                "filter": "itemLocationCountry:FR" # Try to ask eBay to filter
            }
            
            # 3. Execute Request
            try:
                response = requests.get(url, headers=headers, params=params, timeout=10)
                response.raise_for_status()
            except requests.RequestException as e:
                return {
                    "source": "ebay_browse",
                    "market": "FR",
                    "type": "listing_observation",
                    "query": query,
                    "items": [],
                    "usable_for_price_decision": False,
                    "usable_for_opportunity_signal": False,
                    "warnings": [f"network_error: {str(e)}"]
                }
                
            raw_data = response.json()
            
            # 4. Save Cache
            cache_path = self._save_cache(query, raw_data)
            
        # 5. Normalize and Validate
        items = []
        all_fr_proven = True
        warnings = []
        
        for item in raw_data.get("itemSummaries", []):
            price_val = item.get("price", {}).get("value")
            currency = item.get("price", {}).get("currency")
            
            # Seller info is sometimes available or nested
            seller = item.get("seller", {})
            location = item.get("itemLocation", {})
            country = location.get("country", "").upper()
            
            if currency != "EUR":
                warnings.append("item_currency_not_eur")
                all_fr_proven = False
                continue
                
            if country != "FR":
                warnings.append("item_location_not_fr")
                all_fr_proven = False
                continue
                
            try:
                price_float = float(price_val) if price_val is not None else 0.0
            except ValueError:
                price_float = 0.0
                
            items.append({
                "title": item.get("title", ""),
                "price": price_float,
                "currency": currency,
                "condition": item.get("condition", ""),
                "seller_country": country, # Usually we'd get seller country if API gives it
                "item_location_country": country,
                "url": item.get("itemWebUrl", "")
            })
            
        # usable_for_opportunity_signal is true only if we found items and ALL were proven FR
        # If no items, we can't really signal opportunity.
        has_valid_items = len(items) > 0
        opportunity = has_valid_items and all_fr_proven
        
        if not opportunity and has_valid_items:
            warnings.append("some_items_rejected_non_fr_or_eur")

        return {
            "source": "ebay_browse",
            "market": "FR",
            "type": "listing_observation",
            "query": query,
            "items": items,
            "usable_for_price_decision": False, # ALWAYS FALSE
            "usable_for_opportunity_signal": opportunity,
            "warnings": warnings
        }
