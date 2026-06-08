import os
import json
from datetime import date
from dotenv import load_dotenv

load_dotenv()

QUOTA_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'quotas.json')

class SerpApiGuardError(Exception):
    pass

class QuotaExceededError(Exception):
    pass

def _get_quotas_file_path() -> str:
    os.makedirs(os.path.dirname(QUOTA_FILE_PATH), exist_ok=True)
    return QUOTA_FILE_PATH

def _read_quotas():
    filepath = _get_quotas_file_path()
    if not os.path.exists(filepath):
        return {"serpapi": {"date": str(date.today()), "day_count": 0}}
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            today_str = str(date.today())
            if data.get("serpapi", {}).get("date") != today_str:
                data["serpapi"] = {"date": today_str, "day_count": 0}
            return data
    except (json.JSONDecodeError, IOError):
        raise SerpApiGuardError("Quota file is corrupted or unreadable.")

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
        raise SerpApiGuardError(f"Failed to write quota file: {e}")


class SerpApiGuard:
    def __init__(self):
        self.run_count = 0
        self.live_enabled = os.environ.get("SERPAPI_LIVE_CALLS_ENABLED", "false").lower() == "true"
        self.max_run = int(os.environ.get("SERPAPI_MAX_REQUESTS_PER_RUN", "3"))
        self.max_day = int(os.environ.get("SERPAPI_MAX_REQUESTS_PER_DAY", "10"))
        self.api_key = os.environ.get("SERPAPI_KEY")

    def check_pre_call(self, params: dict):
        if not self.live_enabled:
            raise SerpApiGuardError("Live calls are disabled (SERPAPI_LIVE_CALLS_ENABLED is false).")
            
        if not self.api_key:
            raise SerpApiGuardError("Missing SERPAPI_KEY.")
            
        # Check mandatory FR params
        geo = params.get("geo")
        hl = params.get("hl")
        
        if geo != "FR":
            raise SerpApiGuardError("SerpApi calls are restricted to geo=FR strictly.")
            
        if hl != "fr":
            raise SerpApiGuardError("SerpApi calls require hl=fr.")
            
        if self.run_count >= self.max_run:
            raise QuotaExceededError(f"Run quota exceeded ({self.max_run}).")
            
        quotas = _read_quotas()
        day_count = quotas.get("serpapi", {}).get("day_count", 0)
        
        if day_count >= self.max_day:
            raise QuotaExceededError(f"Daily quota exceeded ({self.max_day}).")
            
        # Increment quotas
        self.run_count += 1
        quotas["serpapi"]["day_count"] = day_count + 1
        _write_quotas(quotas)
