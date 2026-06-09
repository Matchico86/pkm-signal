import pytest
from analysis.reactive_trend_keywords import (
    process_order_for_trends,
    build_subject_key
)

def test_1_same_card_multiple_times_deduplicates_subject():
    order = {
        "order_ref": "cmd1",
        "items": [
            {"name": "Giratina V", "number": "186/196", "set_name": "Origine Perdue", "pokemon": "Giratina", "price_buy": 100, "portal_cote": 150},
            {"name": "Giratina V", "number": "186/196", "set_name": "Origine Perdue", "pokemon": "Giratina", "price_buy": 100, "portal_cote": 150}
        ]
    }
    result = process_order_for_trends(order, {})
    
    # 2 items in order, but same subject -> only 1 subject tested
    assert len(result["subjects"]) == 1
    assert result["trend_budget"]["selected_live_queries"] == 1
    assert len(result["skipped"]) == 0

def test_2_same_pokemon_multiple_times_deduplicates_pokemon():
    order = {
        "order_ref": "cmd2",
        "items": [
            {"name": "Pikachu V", "number": "1/100", "pokemon": "Pikachu", "price_buy": 50, "portal_cote": 80},
            {"name": "Pikachu VMAX", "number": "2/100", "pokemon": "Pikachu", "price_buy": 50, "portal_cote": 80}
        ]
    }
    # Forcing high value so they get tested. If no exact match or set match is found, pokemon type is used.
    # To force the pokemon type to be the top query, we just provide pokemon name and no set or number that forms a good keyword
    # Wait, the number is provided, so "card_exact" will be generated for both.
    # "card_exact" is prioritized.
    # To test pokemon deduplication, let's provide only pokemon name and nothing else, so "pokemon" is the only type generated.
    order_only_pokemon = {
        "order_ref": "cmd2",
        "items": [
            {"name": "Pikachu card A", "pokemon": "Pikachu", "price_buy": 50, "portal_cote": 80},
            {"name": "Pikachu card B", "pokemon": "Pikachu", "price_buy": 50, "portal_cote": 80}
        ]
    }
    result = process_order_for_trends(order_only_pokemon, {})
    
    import json
    print(json.dumps(result, indent=2))
    assert len(result["subjects"]) == 1 # Second one is skipped because all its queries (just "pokemon") were deduplicated
    assert result["trend_budget"]["selected_live_queries"] == 1
    assert "all_queries_deduplicated" in [s["reason"] for s in result["skipped"]]

def test_3_same_set_multiple_times_deduplicates_set():
    order = {
        "order_ref": "cmd3",
        "items": [
            {"name": "Card A", "set_name": "Origine Perdue", "price_buy": 50, "portal_cote": 80},
            {"name": "Card B", "set_name": "Origine Perdue", "price_buy": 50, "portal_cote": 80}
        ]
    }
    result = process_order_for_trends(order, {})
    
    assert len(result["subjects"]) == 1
    assert result["trend_budget"]["selected_live_queries"] == 1
    assert "all_queries_deduplicated" in [s["reason"] for s in result["skipped"]]

def test_4_global_budget_max_3_queries():
    order = {
        "order_ref": "cmd4",
        "items": [
            {"name": "A", "number": "1", "pokemon": "A", "price_buy": 50, "portal_cote": 80},
            {"name": "B", "number": "2", "pokemon": "B", "price_buy": 50, "portal_cote": 80},
            {"name": "C", "number": "3", "pokemon": "C", "price_buy": 50, "portal_cote": 80},
            {"name": "D", "number": "4", "pokemon": "D", "price_buy": 50, "portal_cote": 80}
        ]
    }
    result = process_order_for_trends(order, {})
    
    assert len(result["subjects"]) == 3
    assert result["trend_budget"]["selected_live_queries"] == 3
    assert result["trend_budget"]["remaining"] == 0
    assert "budget_exceeded" in [s["reason"] for s in result["skipped"]]

def test_5_exact_card_cache_recent_no_api():
    order = {
        "order_ref": "cmd5",
        "items": [
            {"name": "Giratina V", "number": "186/196", "pokemon": "Giratina", "price_buy": 100, "portal_cote": 150}
        ]
    }
    # exact query generated will be "giratina 186"
    local_context = {
        "cached_queries": {
            "giratina 186": {"age_days": 2}
        }
    }
    result = process_order_for_trends(order, local_context)
    
    # Needs lookup is true, but query is filtered out
    assert len(result["subjects"]) == 0
    assert "all_queries_deduplicated" in [s["reason"] for s in result["skipped"]]
    assert result["trend_budget"]["selected_live_queries"] == 0

def test_6_set_cache_recent_no_api():
    order = {
        "order_ref": "cmd6",
        "items": [
            {"name": "Card A", "set_name": "Origine Perdue", "price_buy": 100, "portal_cote": 150}
        ]
    }
    local_context = {
        "cached_sets": {
            "origine perdue pokemon": {"age_days": 2}
        }
    }
    result = process_order_for_trends(order, local_context)
    assert len(result["subjects"]) == 0
    assert "all_queries_deduplicated" in [s["reason"] for s in result["skipped"]]

def test_7_low_value_no_cache_no_api():
    order = {
        "order_ref": "cmd7",
        "items": [
            {"name": "Pikachu", "number": "1/100", "pokemon": "Pikachu", "price_buy": 1, "portal_cote": 2}
        ]
    }
    result = process_order_for_trends(order, {})
    assert len(result["subjects"]) == 0
    assert "low_value_card" in [s["reason"] for s in result["skipped"]]

def test_8_premium_no_cache_api_allowed():
    order = {
        "order_ref": "cmd8",
        "items": [
            {"name": "Pikachu Alt", "number": "1/100", "pokemon": "Pikachu", "price_buy": 10, "portal_cote": 15}
        ]
    }
    # Not expensive enough to be high value, but premium via name
    result = process_order_for_trends(order, {})
    assert len(result["subjects"]) == 1
    assert result["subjects"][0]["reasons"] == ["premium_target", "trend_cache_missing"]

def test_9_expensive_card_no_exact_keyword_related_queries():
    order = {
        "order_ref": "cmd9",
        "items": [
            {"name": "Mewtwo", "pokemon": "Mewtwo", "price_buy": 200, "portal_cote": 300}
        ]
    }
    # High value, but only generates "pokemon" type keyword, no "card_exact"
    result = process_order_for_trends(order, {})
    assert len(result["subjects"]) == 1
    query = result["subjects"][0]["selected_queries"][0]
    assert query["data_type"] == "RELATED_QUERIES"

def test_10_json_contract():
    order = {
        "order_ref": "cmd10",
        "items": [
            {"name": "Giratina V", "number": "186/196", "set_name": "Origine Perdue", "pokemon": "Giratina", "price_buy": 120, "portal_cote": 180}
        ]
    }
    result = process_order_for_trends(order, {})
    
    assert result["order_ref"] == "cmd10"
    assert "trend_budget" in result
    assert result["trend_budget"]["max_live_queries"] == 3
    assert len(result["subjects"]) == 1
    
    subject = result["subjects"][0]
    assert subject["subject_key"] == "card:giratina_v_186_origine_perdue"
    assert subject["requires_trend_lookup"] is True
    assert isinstance(subject["importance_score"], float)
    assert len(subject["selected_queries"]) == 1
    
    query = subject["selected_queries"][0]
    assert query["query"] == "giratina 186"
    assert query["type"] == "card_exact"
    assert "priority" in query
    assert "data_type" in query
