import pytest
from unittest import mock
import os

from connectors.prices.cardmarket_api_tcg_client import CardmarketApiTcgClient

@pytest.fixture
def mock_env_client(monkeypatch):
    monkeypatch.setenv("CARDMARKET_RAPIDAPI_KEY", "test_key")
    monkeypatch.setenv("CARDMARKET_RAPIDAPI_HOST", "test_host")
    monkeypatch.setenv("RAPIDAPI_LIVE_CALLS_ENABLED", "true")
    monkeypatch.setenv("RAPIDAPI_MAX_REQUESTS_PER_RUN", "10")
    monkeypatch.setenv("RAPIDAPI_MAX_REQUESTS_PER_DAY", "50")
    monkeypatch.setenv("RAPIDAPI_MIN_REMAINING_REQUIRED", "10")
    
@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "quotas.json"
    monkeypatch.setattr("connectors.prices.rapidapi_guard.QUOTA_FILE_PATH", str(quota_file))
    return quota_file

class MockResponse:
    def __init__(self, json_data, headers):
        self._json_data = json_data
        self.headers = headers

    def json(self):
        return self._json_data

    def raise_for_status(self):
        pass

@mock.patch("requests.get")
@mock.patch("connectors.prices.cardmarket_api_tcg_client.CardmarketApiTcgClient._save_cache")
def test_fetch_price_strict_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "data/cache/cardmarket_api_tcg/mocked.json"
    
    mock_get.return_value = MockResponse(
        json_data={"data": [{"seller_country": "FR", "price": 42.5, "price_type": "lowest_near_mint_fr"}]},
        headers={"x-ratelimit-requests-remaining": "100"}
    )
    
    client = CardmarketApiTcgClient()
    result = client.fetch_price("Dracaufeu ex")
    
    assert result["is_strict_fr"] is True
    assert result["usable_for_signal"] is True
    assert result["price"] == 42.5
    assert result["seller_country"] == "FR"

@mock.patch("requests.get")
@mock.patch("connectors.prices.cardmarket_api_tcg_client.CardmarketApiTcgClient._save_cache")
def test_fetch_price_rejects_non_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "data/cache/cardmarket_api_tcg/mocked.json"
    
    # Returning a US seller
    mock_get.return_value = MockResponse(
        json_data={"data": [{"seller_country": "US", "price": 10.0, "price_type": "global"}]},
        headers={"x-ratelimit-requests-remaining": "100"}
    )
    
    client = CardmarketApiTcgClient()
    result = client.fetch_price("Dracaufeu ex")
    
    assert result["is_strict_fr"] is False
    assert result["usable_for_signal"] is False
    assert "price_not_strict_fr" in result["warnings"]

@mock.patch("requests.get")
def test_fetch_price_handles_network_error(mock_get, mock_env_client, mock_quota_file):
    import requests
    mock_get.side_effect = requests.RequestException("Timeout")
    
    client = CardmarketApiTcgClient()
    result = client.fetch_price("Dracaufeu ex")
    
    assert result["is_strict_fr"] is False
    assert result["usable_for_signal"] is False
    assert "network_error: Timeout" in result["warnings"][0]

@mock.patch("requests.get")
@mock.patch("connectors.prices.cardmarket_api_tcg_client.CardmarketApiTcgClient._read_cache")
@mock.patch("connectors.prices.rapidapi_guard.RapidApiGuard.check_pre_call")
def test_fetch_price_uses_cache_and_skips_network(mock_check_pre_call, mock_read_cache, mock_get, mock_env_client, mock_quota_file):
    # Simulate a cache hit
    mock_read_cache.return_value = (
        {"data": [{"seller_country": "FR", "price": 42.5, "price_type": "lowest_near_mint_fr"}]},
        "data/cache/cardmarket_api_tcg/Dracaufeuex.json"
    )
    
    client = CardmarketApiTcgClient()
    result = client.fetch_price("Dracaufeu ex")
    
    # Assert network was not called
    mock_get.assert_not_called()
    # Assert quota guard was not incremented
    mock_check_pre_call.assert_not_called()
    
    # Check that normalization still ran on the cached data
    assert result["is_strict_fr"] is True
    assert result["price"] == 42.5
