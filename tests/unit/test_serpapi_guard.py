import os
import json
import pytest
from datetime import date

from connectors.trends.serpapi_guard import SerpApiGuard, SerpApiGuardError, QuotaExceededError

@pytest.fixture
def mock_env(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test_key")
    monkeypatch.setenv("SERPAPI_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("SERPAPI_MAX_REQUESTS_PER_RUN", "3")
    monkeypatch.setenv("SERPAPI_MAX_REQUESTS_PER_DAY", "10")

@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "quotas.json"
    monkeypatch.setattr("connectors.trends.serpapi_guard.QUOTA_FILE_PATH", str(quota_file))
    return quota_file

def test_guard_fails_if_live_disabled(mock_env, mock_quota_file, monkeypatch):
    monkeypatch.setenv("SERPAPI_LIVE_CALLS_ENABLED", "false")
    guard = SerpApiGuard()
    with pytest.raises(SerpApiGuardError, match="Live calls are disabled"):
        guard.check_pre_call({"geo": "FR", "hl": "fr"})

def test_guard_fails_if_key_missing(mock_env, mock_quota_file, monkeypatch):
    monkeypatch.delenv("SERPAPI_KEY")
    guard = SerpApiGuard()
    with pytest.raises(SerpApiGuardError, match="Missing SERPAPI_KEY"):
        guard.check_pre_call({"geo": "FR", "hl": "fr"})

def test_guard_fails_on_wrong_geo(mock_env, mock_quota_file):
    guard = SerpApiGuard()
    with pytest.raises(SerpApiGuardError, match="restricted to geo=FR"):
        guard.check_pre_call({"geo": "US", "hl": "fr"})

def test_guard_fails_on_wrong_hl(mock_env, mock_quota_file):
    guard = SerpApiGuard()
    with pytest.raises(SerpApiGuardError, match="require hl=fr"):
        guard.check_pre_call({"geo": "FR", "hl": "en"})

def test_guard_passes_and_increments_quotas(mock_env, mock_quota_file):
    guard = SerpApiGuard()
    guard.check_pre_call({"geo": "FR", "hl": "fr"})
    assert guard.run_count == 1
    
    with open(mock_quota_file, 'r') as f:
        data = json.load(f)
    assert data["serpapi"]["day_count"] == 1

def test_guard_fails_on_run_quota_exceeded(mock_env, mock_quota_file):
    guard = SerpApiGuard()
    guard.check_pre_call({"geo": "FR", "hl": "fr"})
    guard.check_pre_call({"geo": "FR", "hl": "fr"})
    guard.check_pre_call({"geo": "FR", "hl": "fr"})
    # 4th call should fail
    with pytest.raises(QuotaExceededError, match="Run quota exceeded"):
        guard.check_pre_call({"geo": "FR", "hl": "fr"})

def test_guard_fails_on_daily_quota_exceeded(mock_env, mock_quota_file):
    today = str(date.today())
    with open(mock_quota_file, 'w') as f:
        json.dump({"serpapi": {"date": today, "day_count": 10}}, f)
        
    guard = SerpApiGuard()
    with pytest.raises(QuotaExceededError, match="Daily quota exceeded"):
        guard.check_pre_call({"geo": "FR", "hl": "fr"})
