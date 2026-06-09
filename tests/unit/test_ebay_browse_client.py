import os
import pytest
from unittest import mock
from connectors.marketplaces.ebay_browse_client import EbayBrowseClient

class MockResponse:
    def __init__(self, json_data, status_code=200):
        self.json_data = json_data
        self.status_code = status_code

    def json(self):
        return self.json_data

    def raise_for_status(self):
        if self.status_code != 200:
            import requests
            raise requests.RequestException(f"HTTP Error {self.status_code}")

@pytest.fixture
def mock_env_client():
    env_vars = {
        "EBAY_CLIENT_ID": "mocked",
        "EBAY_CLIENT_SECRET": "mocked",
        "EBAY_MARKETPLACE_ID": "EBAY_FR",
        "EBAY_LIVE_CALLS_ENABLED": "true"
    }
    with mock.patch.dict(os.environ, env_vars, clear=True):
        yield

@pytest.fixture
def mock_quota_file(tmp_path, monkeypatch):
    quota_file = tmp_path / "ebay_quotas.json"
    monkeypatch.setattr("connectors.marketplaces.ebay_guard.EBAY_QUOTA_FILE_PATH", str(quota_file))
    return quota_file

@mock.patch("requests.get")
@mock.patch("connectors.marketplaces.ebay_browse_client.EbayBrowseClient._save_cache")
def test_fetch_active_listings_valid_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "cache.json"
    
    mock_get.return_value = MockResponse({
        "itemSummaries": [
            {
                "title": "Dracaufeu ex",
                "price": {"value": "45.0", "currency": "EUR"},
                "itemLocation": {"country": "FR"}
            }
        ]
    })
    
    client = EbayBrowseClient()
    result = client.fetch_active_listings("Dracaufeu ex")
    
    assert result["usable_for_price_decision"] is False # ALWAYS FALSE
    assert result["usable_for_opportunity_signal"] is True # Proven FR
    assert len(result["items"]) == 1
    assert result["items"][0]["price"] == 45.0
    assert result["items"][0]["currency"] == "EUR"
    assert result["items"][0]["seller_country"] == "FR"

@mock.patch("requests.get")
@mock.patch("connectors.marketplaces.ebay_browse_client.EbayBrowseClient._save_cache")
def test_fetch_active_listings_rejects_non_eur(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "cache.json"
    
    mock_get.return_value = MockResponse({
        "itemSummaries": [
            {
                "title": "Dracaufeu ex",
                "price": {"value": "50.0", "currency": "USD"}, # USD should be rejected
                "itemLocation": {"country": "FR"}
            }
        ]
    })
    
    client = EbayBrowseClient()
    result = client.fetch_active_listings("Dracaufeu ex")
    
    assert result["usable_for_price_decision"] is False
    assert result["usable_for_opportunity_signal"] is False # Item rejected
    assert len(result["items"]) == 0
    assert "item_currency_not_eur" in result["warnings"]

@mock.patch("requests.get")
@mock.patch("connectors.marketplaces.ebay_browse_client.EbayBrowseClient._save_cache")
def test_fetch_active_listings_rejects_non_fr(mock_save_cache, mock_get, mock_env_client, mock_quota_file):
    mock_save_cache.return_value = "cache.json"
    
    mock_get.return_value = MockResponse({
        "itemSummaries": [
            {
                "title": "Dracaufeu ex",
                "price": {"value": "45.0", "currency": "EUR"},
                "itemLocation": {"country": "US"} # US should be rejected
            }
        ]
    })
    
    client = EbayBrowseClient()
    result = client.fetch_active_listings("Dracaufeu ex")
    
    assert result["usable_for_price_decision"] is False
    assert result["usable_for_opportunity_signal"] is False
    assert len(result["items"]) == 0

@mock.patch("requests.get")
@mock.patch("connectors.marketplaces.ebay_browse_client.EbayBrowseClient._read_cache")
@mock.patch("connectors.marketplaces.ebay_guard.EbayGuard.check_pre_call")
def test_fetch_active_listings_uses_cache(mock_check_pre_call, mock_read_cache, mock_get, mock_env_client, mock_quota_file):
    mock_read_cache.return_value = (
        {
            "itemSummaries": [
                {
                    "title": "Dracaufeu ex cached",
                    "price": {"value": "10.0", "currency": "EUR"},
                    "itemLocation": {"country": "FR"}
                }
            ]
        },
        "cache.json"
    )
    
    client = EbayBrowseClient()
    result = client.fetch_active_listings("Dracaufeu ex")
    
    mock_get.assert_not_called()
    mock_check_pre_call.assert_not_called()
    
    assert result["usable_for_opportunity_signal"] is True
    assert result["items"][0]["price"] == 10.0

@mock.patch("requests.get")
def test_fetch_active_listings_guard_blocked(mock_get, mock_quota_file):
    # LIVE is implicitly false without env setup
    client = EbayBrowseClient()
    result = client.fetch_active_listings("Dracaufeu ex")
    
    mock_get.assert_not_called()
    assert result["usable_for_price_decision"] is False
    assert result["usable_for_opportunity_signal"] is False
    assert "guard_blocked: Live calls are disabled" in result["warnings"][0]
