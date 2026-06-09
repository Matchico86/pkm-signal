import pytest
from unittest import mock
import os

from connectors.trends.serpapi_trends_client import SerpapiTrendsClient

@pytest.fixture
def mock_env_client(monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test_key")
    monkeypatch.setenv("SERPAPI_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("SERPAPI_MAX_REQUESTS_PER_RUN", "10")
    monkeypatch.setenv("SERPAPI_MAX_REQUESTS_PER_DAY", "50")

@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "quotas.json"
    monkeypatch.setattr("connectors.trends.serpapi_guard.QUOTA_FILE_PATH", str(quota_file))
    return quota_file

class MockResponse:
    def __init__(self, json_data):
        self._json_data = json_data

    def json(self):
        return self._json_data

    def raise_for_status(self):
        pass

@mock.patch("requests.get")
@mock.patch("connectors.trends.serpapi_trends_client.SerpapiTrendsClient._save_cache")
def test_fetch_trends_strict_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "data/cache/serpapi_trends/mocked.json"
    
    mock_get.return_value = MockResponse({
        "search_parameters": {"geo": "FR", "hl": "fr"},
        "interest_over_time": {
            "timeline_data": [
                {"date": "2026-06-01", "values": [{"extracted_value": 42}]}
            ]
        }
    })
    
    client = SerpapiTrendsClient()
    result = client.fetch_trends("Dracaufeu ex")
    
    assert result["is_strict_fr"] is True
    assert result["usable_for_signal"] is True
    assert len(result["points"]) == 1
    assert result["points"][0]["value"] == 42
    
    # Verify the correct parameters were sent, including data_type=TIMESERIES
    mock_get.assert_called_once()
    called_params = mock_get.call_args[1].get('params', {})
    assert called_params.get('data_type') == 'TIMESERIES'

@mock.patch("requests.get")
@mock.patch("connectors.trends.serpapi_trends_client.SerpapiTrendsClient._save_cache")
def test_fetch_trends_rejects_non_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "data/cache/serpapi_trends/mocked.json"
    
    mock_get.return_value = MockResponse({
        "search_parameters": {"geo": "US", "hl": "en"},
        "interest_over_time": {}
    })
    
    client = SerpapiTrendsClient()
    result = client.fetch_trends("Dracaufeu ex")
    
    assert result["is_strict_fr"] is False
    assert result["usable_for_signal"] is False
    assert "trends_not_strict_fr" in result["warnings"]

def test_fetch_trends_guard_blocks_pre_call(mock_env_client, mock_quota_file):
    client = SerpapiTrendsClient()
    # geo="US" should be blocked directly by the guard before even doing a request
    result = client.fetch_trends("Dracaufeu ex", geo="US")
    
    assert result["is_strict_fr"] is False
    assert "restricted to geo=FR" in result["warnings"][0]

@mock.patch("requests.get")
def test_fetch_trends_handles_network_error(mock_get, mock_env_client, mock_quota_file):
    import requests
    mock_get.side_effect = requests.RequestException("Timeout")
    
    client = SerpapiTrendsClient()
    result = client.fetch_trends("Dracaufeu ex")
    
    assert result["is_strict_fr"] is False
    assert result["usable_for_signal"] is False
    assert "network_error: Timeout" in result["warnings"][0]

@mock.patch("requests.get")
@mock.patch("connectors.trends.serpapi_trends_client.SerpapiTrendsClient._read_cache")
@mock.patch("connectors.trends.serpapi_guard.SerpApiGuard.check_pre_call")
def test_fetch_trends_uses_cache_and_skips_network(mock_check_pre_call, mock_read_cache, mock_get, mock_env_client, mock_quota_file):
    mock_read_cache.return_value = (
        {
            "search_parameters": {"geo": "FR", "hl": "fr"},
            "interest_over_time": {
                "timeline_data": [
                    {"date": "2026-06-01", "values": [{"extracted_value": 42}]}
                ]
            }
        },
        "data/cache/serpapi_trends/Dracaufeuex.json"
    )
    
    client = SerpapiTrendsClient()
    result = client.fetch_trends("Dracaufeu ex")
    
    # Assert network was not called
    mock_get.assert_not_called()
    # Assert quota guard was not incremented
    mock_check_pre_call.assert_not_called()
    
    # Check that normalization still ran on the cached data
    assert result["is_strict_fr"] is True
    assert result["points"][0]["value"] == 42
