import os
import json
from datetime import date
from dotenv import load_dotenv

# Try to load .env, but won't crash if it doesn't exist
load_dotenv()

QUOTA_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'quotas.json')

class QuotaExceededError(Exception):
    pass

class RapidApiGuardError(Exception):
    pass

def _get_quotas_file_path() -> str:
    # Ensure directory exists
    os.makedirs(os.path.dirname(QUOTA_FILE_PATH), exist_ok=True)
    return QUOTA_FILE_PATH

def _read_quotas():
    filepath = _get_quotas_file_path()
    if not os.path.exists(filepath):
        return {"rapidapi": {"date": str(date.today()), "day_count": 0}}
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # Reset if date changed
            today_str = str(date.today())
            if data.get("rapidapi", {}).get("date") != today_str:
                data["rapidapi"] = {"date": today_str, "day_count": 0}
            return data
    except (json.JSONDecodeError, IOError):
        # Fail closed if corrupted
        raise RapidApiGuardError("Quota file is corrupted or unreadable.")

def _write_quotas(data):
    filepath = _get_quotas_file_path()
    try:
        temp_path = filepath + ".tmp"
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp_path, filepath)
    except Exception as e:
        raise RapidApiGuardError(f"Failed to write quota file: {e}")

class RapidApiGuard:
    def __init__(self):
        self.run_count = 0
        self.live_enabled = os.environ.get("RAPIDAPI_LIVE_CALLS_ENABLED", "false").lower() == "true"
        self.max_run = int(os.environ.get("RAPIDAPI_MAX_REQUESTS_PER_RUN", "3"))
        self.max_day = int(os.environ.get("RAPIDAPI_MAX_REQUESTS_PER_DAY", "10"))
        self.min_remaining = int(os.environ.get("RAPIDAPI_MIN_REMAINING_REQUIRED", "85"))
        self.api_key = os.environ.get("CARDMARKET_RAPIDAPI_KEY")
        self.api_host = os.environ.get("CARDMARKET_RAPIDAPI_HOST")

    def check_pre_call(self):
        if not self.live_enabled:
            raise RapidApiGuardError("Live calls are disabled (RAPIDAPI_LIVE_CALLS_ENABLED is false).")
            
        if not self.api_key or not self.api_host:
            raise RapidApiGuardError("Missing CARDMARKET_RAPIDAPI_KEY or CARDMARKET_RAPIDAPI_HOST.")
            
        if self.run_count >= self.max_run:
            raise QuotaExceededError(f"Run quota exceeded ({self.max_run}).")
            
        quotas = _read_quotas()
        day_count = quotas.get("rapidapi", {}).get("day_count", 0)
        
        if day_count >= self.max_day:
            raise QuotaExceededError(f"Daily quota exceeded ({self.max_day}).")
            
        # Increment quotas
        self.run_count += 1
        quotas["rapidapi"]["day_count"] = day_count + 1
        _write_quotas(quotas)

    def verify_post_call_headers(self, headers: dict):
        # Header keys are often case insensitive in python requests (Response.headers)
        # But we provide a dict. Let's make it case-insensitive search.
        headers_lower = {k.lower(): v for k, v in headers.items()}
        remaining_str = headers_lower.get("x-ratelimit-requests-remaining")
        
        if remaining_str is None:
            raise RapidApiGuardError("Missing x-ratelimit-requests-remaining header.")
            
        try:
            remaining = int(remaining_str)
        except ValueError:
            raise RapidApiGuardError("Invalid x-ratelimit-requests-remaining header value.")
            
        if remaining < self.min_remaining:
            raise QuotaExceededError(f"Remaining RapidAPI requests ({remaining}) below safety threshold ({self.min_remaining}).")

    def validate_strict_fr_response(self, response_data: dict) -> bool:
        """
        Returns true if the response proves it's strictly a French market price.
        """
        # We look for explicit FR markers based on user prompt
        country = response_data.get("country", "").upper()
        seller_country = response_data.get("seller_country", "").upper()
        price_type = response_data.get("price_type", "").lower()
        
        if country == "FR" or seller_country == "FR" or "fr" in price_type:
            return True
        return False
