import os
import json
import time
import requests
from connectors.trends.serpapi_guard import SerpApiGuard, SerpApiGuardError

class SerpapiTrendsClient:
    def __init__(self):
        self.guard = SerpApiGuard()
        self.base_url = "https://serpapi.com/search"

    def _get_cache_filename(self, query: str) -> str:
        safe_query = "".join([c if c.isalnum() else "_" for c in query])
        return f"{safe_query}.json"

    def _get_cache_dir(self) -> str:
        cache_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'serpapi_trends')
        os.makedirs(cache_dir, exist_ok=True)
        return cache_dir

    def _read_cache(self, query: str):
        filepath = os.path.join(self._get_cache_dir(), self._get_cache_filename(query))
        if os.path.exists(filepath):
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f), f"data/cache/serpapi_trends/{self._get_cache_filename(query)}"
        return None, None

    def _save_cache(self, query: str, raw_data: dict) -> str:
        filename = self._get_cache_filename(query)
        filepath = os.path.join(self._get_cache_dir(), filename)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(raw_data, f)
            
        return f"data/cache/serpapi_trends/{filename}"

    def fetch_trends(self, query: str, geo: str = "FR", hl: str = "fr", timeframe: str = "today 3-m") -> dict:
        """
        Fetches Google Trends data via SerpApi.
        Normalizes the response to enforce the strict FR policy.
        """
        # 0. Check Cache First (before guard and quota)
        cached_data, cache_path = self._read_cache(query)
        
        if cached_data is not None:
            raw_data = cached_data
        else:
            params = {
                "engine": "google_trends",
                "q": query,
                "geo": geo,
                "hl": hl,
                "date": timeframe,
                "data_type": "TIMESERIES",
                "api_key": self.guard.api_key
            }
            
            # 1. Pre-call Security Check
            try:
                self.guard.check_pre_call(params)
            except Exception as e:
                return {
                    "is_strict_fr": False,
                    "usable_for_signal": False,
                    "warnings": [f"guard_blocked: {str(e)}"]
                }
                
            # 2. Execute Request
            try:
                response = requests.get(self.base_url, params=params, timeout=10)
                response.raise_for_status()
            except requests.RequestException as e:
                return {
                    "is_strict_fr": False,
                    "usable_for_signal": False,
                    "warnings": [f"network_error: {str(e)}"]
                }
                
            raw_data = response.json()
            
            # 3. Save to Cache
            cache_path = self._save_cache(query, raw_data)
            
        # 4. Normalize and Validate FR Strict
        returned_geo = raw_data.get("search_parameters", {}).get("geo", "").upper()
        returned_hl = raw_data.get("search_parameters", {}).get("hl", "").lower()
        
        if returned_geo != "FR" or returned_hl != "fr":
            return {
                "is_strict_fr": False,
                "usable_for_signal": False,
                "warnings": ["trends_not_strict_fr"]
            }
            
        points = []
        for item in raw_data.get("interest_over_time", {}).get("timeline_data", []):
            points.append({
                "date": item.get("date"),
                "value": item.get("values", [{}])[0].get("extracted_value", 0)
            })
            
        return {
            "source": "serpapi_google_trends",
            "geo": "FR",
            "hl": "fr",
            "query": query,
            "timeframe": timeframe,
            "points": points,
            "is_strict_fr": True,
            "usable_for_signal": True,
            "warnings": []
        }
