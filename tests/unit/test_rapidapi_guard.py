import os
import json
import pytest
from unittest import mock
from datetime import date

from connectors.prices.rapidapi_guard import RapidApiGuard, RapidApiGuardError, QuotaExceededError

@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("CARDMARKET_RAPIDAPI_KEY", "test_key")
    monkeypatch.setenv("CARDMARKET_RAPIDAPI_HOST", "test_host")
    monkeypatch.setenv("RAPIDAPI_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("RAPIDAPI_MAX_REQUESTS_PER_RUN", "3")
    monkeypatch.setenv("RAPIDAPI_MAX_REQUESTS_PER_DAY", "10")
    monkeypatch.setenv("RAPIDAPI_MIN_REMAINING_REQUIRED", "85")

@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "quotas.json"
    monkeypatch.setattr("connectors.prices.rapidapi_guard.QUOTA_FILE_PATH", str(quota_file))
    return quota_file

def test_guard_fails_if_live_disabled(mock_env, mock_quota_file, monkeypatch):
    monkeypatch.setenv("RAPIDAPI_LIVE_CALLS_ENABLED", "false")
    guard = RapidApiGuard()
    with pytest.raises(RapidApiGuardError, match="Live calls are disabled"):
        guard.check_pre_call()

def test_guard_fails_if_key_missing(mock_env, mock_quota_file, monkeypatch):
    monkeypatch.delenv("CARDMARKET_RAPIDAPI_KEY")
    guard = RapidApiGuard()
    with pytest.raises(RapidApiGuardError, match="Missing CARDMARKET_RAPIDAPI_KEY"):
        guard.check_pre_call()

def test_guard_passes_and_increments_quotas(mock_env, mock_quota_file):
    guard = RapidApiGuard()
    guard.check_pre_call()
    assert guard.run_count == 1
    
    with open(mock_quota_file, 'r') as f:
        data = json.load(f)
    assert data["rapidapi"]["day_count"] == 1

def test_guard_fails_on_run_quota_exceeded(mock_env, mock_quota_file):
    guard = RapidApiGuard()
    guard.check_pre_call()
    guard.check_pre_call()
    guard.check_pre_call()
    # 4th call should fail
    with pytest.raises(QuotaExceededError, match="Run quota exceeded"):
        guard.check_pre_call()

def test_guard_fails_on_daily_quota_exceeded(mock_env, mock_quota_file):
    # Setup max day quota reached
    today = str(date.today())
    with open(mock_quota_file, 'w') as f:
        json.dump({"rapidapi": {"date": today, "day_count": 10}}, f)
        
    guard = RapidApiGuard()
    with pytest.raises(QuotaExceededError, match="Daily quota exceeded"):
        guard.check_pre_call()

def test_verify_headers_missing(mock_env):
    guard = RapidApiGuard()
    with pytest.raises(RapidApiGuardError, match="Missing x-ratelimit-requests-remaining"):
        guard.verify_post_call_headers({"some-other-header": "123"})

def test_verify_headers_below_threshold(mock_env):
    guard = RapidApiGuard()
    with pytest.raises(QuotaExceededError, match="below safety threshold"):
        guard.verify_post_call_headers({"x-ratelimit-requests-remaining": "80"})

def test_verify_headers_success(mock_env):
    guard = RapidApiGuard()
    # Should not raise exception
    guard.verify_post_call_headers({"x-ratelimit-requests-remaining": "100"})

def test_validate_strict_fr_response():
    guard = RapidApiGuard()
    assert guard.validate_strict_fr_response({"country": "FR"}) is True
    assert guard.validate_strict_fr_response({"seller_country": "fr"}) is True
    assert guard.validate_strict_fr_response({"price_type": "lowest_near_mint_FR"}) is True
    assert guard.validate_strict_fr_response({"country": "US", "price_type": "global"}) is False
    assert guard.validate_strict_fr_response({}) is False

@mock.patch("os.replace")
def test_guard_write_corrupted_fails_closed(mock_replace, mock_env, mock_quota_file):
    # Simulate a write failure (e.g. permission issue on Windows replace)
    mock_replace.side_effect = Exception("Mocked Windows PermissionError")
    guard = RapidApiGuard()
    with pytest.raises(RapidApiGuardError, match="Failed to write quota file"):
        guard.check_pre_call()
