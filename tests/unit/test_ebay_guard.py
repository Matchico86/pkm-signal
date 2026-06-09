import os
import json
import pytest
from unittest import mock
from connectors.marketplaces.ebay_guard import EbayGuard, EbayGuardError, QuotaExceededError

@pytest.fixture
def mock_env_client(monkeypatch):
    monkeypatch.setenv("EBAY_CLIENT_ID", "mocked_client_id")
    monkeypatch.setenv("EBAY_CLIENT_SECRET", "mocked_client_secret")
    monkeypatch.setenv("EBAY_MARKETPLACE_ID", "EBAY_FR")
    monkeypatch.setenv("EBAY_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("EBAY_MAX_REQUESTS_PER_RUN", "3")
    monkeypatch.setenv("EBAY_MAX_REQUESTS_PER_DAY", "10")

@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "ebay_quotas.json"
    monkeypatch.setattr("connectors.marketplaces.ebay_guard.EBAY_QUOTA_FILE_PATH", str(quota_file))
    return quota_file

def test_guard_blocks_when_live_disabled(mock_env_client, mock_quota_file, monkeypatch):
    monkeypatch.setenv("EBAY_LIVE_CALLS_ENABLED", "false")
    guard = EbayGuard()
    with pytest.raises(EbayGuardError, match="Live calls are disabled"):
        guard.check_pre_call()

def test_guard_blocks_missing_credentials(mock_env_client, mock_quota_file, monkeypatch):
    monkeypatch.delenv("EBAY_CLIENT_ID", raising=False)
    guard = EbayGuard()
    with pytest.raises(EbayGuardError, match="eBay credentials missing"):
        guard.check_pre_call()

def test_guard_blocks_wrong_marketplace(mock_env_client, mock_quota_file, monkeypatch):
    monkeypatch.setenv("EBAY_MARKETPLACE_ID", "EBAY_US")
    guard = EbayGuard()
    with pytest.raises(EbayGuardError, match="strictly restricted to EBAY_FR"):
        guard.check_pre_call()

def test_guard_respects_run_quota(mock_env_client, mock_quota_file):
    guard = EbayGuard()
    guard.check_pre_call()
    guard.check_pre_call()
    guard.check_pre_call()
    
    with pytest.raises(QuotaExceededError, match="max requests per run reached"):
        guard.check_pre_call()

def test_guard_respects_daily_quota(mock_env_client, mock_quota_file):
    guard = EbayGuard()
    
    # Manually write daily quota at max
    quotas = {"daily_calls": 10, "last_reset_date": guard._get_current_date()}
    with open(mock_quota_file, 'w') as f:
        json.dump(quotas, f)
        
    with pytest.raises(QuotaExceededError, match="daily quota reached"):
        guard.check_pre_call()

def test_guard_resets_daily_quota_on_new_day(mock_env_client, mock_quota_file):
    guard = EbayGuard()
    
    # Old date
    quotas = {"daily_calls": 10, "last_reset_date": "2020-01-01"}
    with open(mock_quota_file, 'w') as f:
        json.dump(quotas, f)
        
    # Should not raise because date changed, resetting daily to 0
    guard.check_pre_call()
    
    with open(mock_quota_file, 'r') as f:
        new_quotas = json.load(f)
        
    assert new_quotas["daily_calls"] == 1
    assert new_quotas["last_reset_date"] == guard._get_current_date()
