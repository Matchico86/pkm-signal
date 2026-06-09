class VintedContractStub:
    """
    Stub for Vinted integration.
    Lab à haut risque scraping, exclu V1.
    """
    def __init__(self):
        pass

    def fetch_listings(self, query: str) -> dict:
        return {
            "source": "vinted",
            "market": "FR",
            "type": "listing_observation_stub",
            "status": "stub_only",
            "query": query,
            "items": [],
            "usable_for_price_decision": False,
            "usable_for_opportunity_signal": False,
            "warnings": ["stub_only", "scraping_risk", "excluded_from_v1"]
        }
