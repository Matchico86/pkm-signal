import os
import json
import time
from dotenv import load_dotenv

EBAY_QUOTA_FILE_PATH = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'cache', 'ebay_quotas.json')

class EbayGuardError(Exception):
    pass

class QuotaExceededError(Exception):
    pass

class EbayGuard:
    def __init__(self):
        load_dotenv()
        
        self.client_id = os.getenv("EBAY_CLIENT_ID")
        self.client_secret = os.getenv("EBAY_CLIENT_SECRET")
        self.marketplace_id = os.getenv("EBAY_MARKETPLACE_ID", "EBAY_FR")
        
        self.live_calls_enabled = os.getenv("EBAY_LIVE_CALLS_ENABLED", "false").lower() == "true"
        
        try:
            self.max_requests_per_run = int(os.getenv("EBAY_MAX_REQUESTS_PER_RUN", "3"))
            self.max_requests_per_day = int(os.getenv("EBAY_MAX_REQUESTS_PER_DAY", "10"))
        except ValueError:
            self.max_requests_per_run = 3
            self.max_requests_per_day = 10
            
        self.run_calls = 0
        
    def _read_quotas(self) -> dict:
        if not os.path.exists(EBAY_QUOTA_FILE_PATH):
            return {"daily_calls": 0, "last_reset_date": self._get_current_date()}
            
        try:
            with open(EBAY_QUOTA_FILE_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            if data.get("last_reset_date") != self._get_current_date():
                return {"daily_calls": 0, "last_reset_date": self._get_current_date()}
                
            return data
        except Exception:
            raise EbayGuardError("Failed to read eBay quota file or corrupted JSON. Fail closed.")

    def _write_quotas(self, data: dict):
        os.makedirs(os.path.dirname(EBAY_QUOTA_FILE_PATH), exist_ok=True)
        tmp_file = EBAY_QUOTA_FILE_PATH + ".tmp"
        try:
            with open(tmp_file, 'w', encoding='utf-8') as f:
                json.dump(data, f)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_file, EBAY_QUOTA_FILE_PATH)
        except Exception as e:
            if os.path.exists(tmp_file):
                try:
                    os.remove(tmp_file)
                except Exception:
                    pass
            raise EbayGuardError(f"Failed to write eBay quota file securely: {str(e)}. Fail closed.")

    def _get_current_date(self) -> str:
        return time.strftime("%Y-%m-%d")

    def check_pre_call(self):
        if not self.live_calls_enabled:
            raise EbayGuardError("Live calls are disabled (EBAY_LIVE_CALLS_ENABLED is false).")
            
        if not self.client_id or not self.client_secret:
            raise EbayGuardError("eBay credentials missing in environment.")
            
        if self.marketplace_id != "EBAY_FR":
            raise EbayGuardError(f"eBay queries are strictly restricted to EBAY_FR. Got: {self.marketplace_id}")
            
        if self.run_calls >= self.max_requests_per_run:
            raise QuotaExceededError(f"eBay max requests per run reached ({self.max_requests_per_run}).")
            
        quotas = self._read_quotas()
        
        if quotas.get("daily_calls", 0) >= self.max_requests_per_day:
            raise QuotaExceededError(f"eBay daily quota reached ({self.max_requests_per_day}).")
            
        # Increment quota
        self.run_calls += 1
        quotas["daily_calls"] = quotas.get("daily_calls", 0) + 1
        self._write_quotas(quotas)
