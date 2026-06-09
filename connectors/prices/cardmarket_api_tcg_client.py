import os
import json
import time
import requests
from connectors.prices.rapidapi_guard import RapidApiGuard, RapidApiGuardError

class CardmarketApiTcgClient:
    def __init__(self):
        self.guard = RapidApiGuard()
        self.base_url = f"https://{self.guard.api_host}"

    def _get_cache_filename(self, query: str) -> str:
        safe_query = "".join([c if c.isalnum() else "_" for c in query])
        return f"{safe_query}.json"

    def _get_cache_dir(self) -> str:
        cache_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'cardmarket_api_tcg')
        os.makedirs(cache_dir, exist_ok=True)
        return cache_dir

    def _read_cache(self, query: str):
        filepath = os.path.join(self._get_cache_dir(), self._get_cache_filename(query))
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f), f"data/cache/cardmarket_api_tcg/{self._get_cache_filename(query)}"
        return None, None

    def _save_cache(self, query: str, raw_data: dict) -> str:
        filename = self._get_cache_filename(query)
        filepath = os.path.join(self._get_cache_dir(), filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(raw_data, f)
        
        return f"data/cache/cardmarket_api_tcg/{filename}"

    def fetch_price(self, query: str, condition: str = "NM") -> dict:
        """
        Fetches price from CardMarket API TCG via RapidAPI.
        Normalizes the response to enforce the strict FR policy.
        """
        # 0. Check Cache First (before guard and quota)
        cached_data, cache_path = self._read_cache(query)
        
        if cached_data is not None:
            raw_data = cached_data
        else:
            # 1. Pre-call Security Check (increments quota)
            try:
                self.guard.check_pre_call()
            except Exception as e:
                return {
                    "is_strict_fr": False,
                    "usable_for_signal": False,
                    "warnings": [f"guard_blocked: {str(e)}"]
                }
            
            # 2. Prepare Request
            url = f"{self.base_url}/search"
            headers = {
                "x-rapidapi-key": self.guard.api_key,
                "x-rapidapi-host": self.guard.api_host
            }
            params = {"q": query}
            
            # 3. Execute Request
            try:
                response = requests.get(url, headers=headers, params=params, timeout=10)
                response.raise_for_status()
            except requests.RequestException as e:
                return {
                    "is_strict_fr": False,
                    "usable_for_signal": False,
                    "warnings": [f"network_error: {str(e)}"]
                }

            # 4. Post-call Security Check
            self.guard.verify_post_call_headers(response.headers)
            
            raw_data = response.json()
            
            # 5. Save to Cache
            cache_path = self._save_cache(query, raw_data)
            
        # 6. Normalize and Validate FR Strict
        item = raw_data.get("data", [{}])[0] if isinstance(raw_data.get("data"), list) and raw_data.get("data") else raw_data
        
        is_strict_fr = self.guard.validate_strict_fr_response(item)
        
        if not is_strict_fr:
            return {
                "is_strict_fr": False,
                "usable_for_signal": False,
                "warnings": ["price_not_strict_fr"]
            }
            
        return {
            "source": "cardmarket_api_tcg",
            "market": "cardmarket",
            "country": "FR",
            "currency": "EUR",
            "seller_country": item.get("seller_country", "FR").upper(),
            "query": query,
            "condition": condition,
            "price_type": item.get("price_type", "lowest_near_mint_fr"),
            "price": item.get("price", 0.0),
            "raw_cache_path": cache_path.replace("\\", "/"),
            "is_strict_fr": True,
            "usable_for_signal": True,
            "warnings": []
        }
