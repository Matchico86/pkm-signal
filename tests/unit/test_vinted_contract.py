import pytest
from connectors.marketplaces.vinted_contract import VintedContractStub

def test_vinted_stub_always_returns_false_for_decision_and_signal():
    stub = VintedContractStub()
    result = stub.fetch_listings("Dracaufeu ex")
    
    assert result["source"] == "vinted"
    assert result["status"] == "stub_only"
    assert result["usable_for_price_decision"] is False
    assert result["usable_for_opportunity_signal"] is False
    assert "scraping_risk" in result["warnings"]
    assert "excluded_from_v1" in result["warnings"]
    assert len(result["items"]) == 0
