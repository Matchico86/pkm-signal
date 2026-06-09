import re
from typing import List, Dict, Any

MAX_LIVE_QUERIES_PER_ORDER = 3
MAX_LIVE_QUERIES_PER_SUBJECT = 1

def build_subject_key(card_ref: dict) -> str:
    """Construit une clé canonique pour identifier le sujet."""
    name = str(card_ref.get("name", "")).lower()
    number = str(card_ref.get("number", "")).split('/')[0].lower()
    set_name = str(card_ref.get("set_name", "")).lower()
    
    # Normalize alphanum
    name = re.sub(r'[^a-z0-9]', '_', name)
    number = re.sub(r'[^a-z0-9]', '_', number)
    set_name = re.sub(r'[^a-z0-9]', '_', set_name)
    
    parts = [p for p in [name, number, set_name] if p]
    base = "_".join(parts)
    base = re.sub(r'_+', '_', base).strip('_')
    return f"card:{base}"

def enrich_local_data(card_ref: dict, local_context: dict) -> dict:
    """Mock enrichissement local basé sur l'entrée."""
    subject_key = build_subject_key(card_ref)
    
    enriched = {
        "trend_cache_missing": True,
        "trend_cache_stale": False,
        "high_value_card": False,
        "large_buy_cote_delta": False,
        "premium_target": False,
        "low_value_card": False,
        "overstock_warning": False,
        "stagnant_inventory_risk": False,
        "personal_collection_missing": False
    }
    
    price_buy = float(card_ref.get("price_buy", 0.0))
    cote = float(card_ref.get("portal_cote", 0.0))
    
    # Définition métier V1
    if cote >= 50 or price_buy >= 40:
        enriched["high_value_card"] = True
    elif cote < 5 and price_buy < 5:
        enriched["low_value_card"] = True
        
    if cote > 0 and price_buy > 0 and (cote - price_buy) >= 30:
        enriched["large_buy_cote_delta"] = True
        
    name_full = str(card_ref.get("name", "")).lower()
    number_full = str(card_ref.get("number", "")).lower()
    
    # Indicateurs premium (Alt, SAR, Secrète, EX, V)
    if any(k in name_full.split() for k in ["alt", "v", "ex", "vmax", "vstar", "sar", "secret", "secrète"]):
        enriched["premium_target"] = True
        
    # Vérification du cache mocké dans local_context
    cached_subjects = local_context.get("cached_subjects", {})
    if subject_key in cached_subjects:
        age_days = cached_subjects[subject_key].get("age_days", 0)
        enriched["trend_cache_missing"] = False
        if age_days > 7:
            enriched["trend_cache_stale"] = True
            
    # Héritage explicite des signaux locaux fournis dans le contexte
    context_signals = local_context.get("signals", {}).get(subject_key, [])
    for signal in ["overstock_warning", "stagnant_inventory_risk", "personal_collection_missing"]:
        if signal in context_signals:
            enriched[signal] = True
            
    return enriched

def calculate_trend_lookup_importance(card_ref: dict, enriched_data: dict) -> tuple[bool, float, List[str]]:
    """Calcule le score d'importance local pour décider si un appel est justifié."""
    reasons = []
    score = 0.0
    
    if enriched_data.get("low_value_card"):
        return False, 0.1, ["low_value_card"]
        
    if not enriched_data.get("trend_cache_missing") and not enriched_data.get("trend_cache_stale"):
        return False, 0.2, ["cache_recent_enough"]
        
    if enriched_data.get("high_value_card"):
        score += 0.4
        reasons.append("high_value_card")
        
    if enriched_data.get("premium_target"):
        score += 0.3
        reasons.append("premium_target")
        
    if enriched_data.get("large_buy_cote_delta"):
        score += 0.2
        reasons.append("large_buy_cote_delta")
        
    if enriched_data.get("trend_cache_missing"):
        score += 0.1
        reasons.append("trend_cache_missing")
        
    if enriched_data.get("trend_cache_stale"):
        score += 0.1
        reasons.append("trend_cache_stale")
        
    requires_lookup = score >= 0.35
    return requires_lookup, min(score, 1.0), reasons

def generate_candidate_keywords(card_ref: dict) -> List[dict]:
    """Génère les requêtes candidates pour Trends."""
    name = str(card_ref.get("name", "")).strip()
    number_full = str(card_ref.get("number", "")).split('/')[0].strip()
    set_name = str(card_ref.get("set_name", "")).strip()
    pokemon = str(card_ref.get("pokemon", "")).strip()
    
    candidates = []
    
    if pokemon and number_full:
        candidates.append({
            "query": f"{pokemon} {number_full}".lower(),
            "type": "card_exact",
            "priority": 0.95,
            "data_type": "TIMESERIES"
        })
        
    if pokemon and set_name:
        candidates.append({
            "query": f"{pokemon} {set_name}".lower(),
            "type": "card_set",
            "priority": 0.85,
            "data_type": "TIMESERIES"
        })
        
    if pokemon:
        candidates.append({
            "query": f"{pokemon} pokemon".lower(),
            "type": "pokemon",
            "priority": 0.60,
            "data_type": "TIMESERIES"
        })
        
    if set_name:
        candidates.append({
            "query": f"{set_name} pokemon".lower(),
            "type": "set",
            "priority": 0.50,
            "data_type": "TIMESERIES"
        })
        
    return candidates

def deduplicate_and_filter(candidates: List[dict], enriched_data: dict, local_context: dict) -> List[dict]:
    """Filtre les requêtes déjà récentes en cache par mot-clé précis ou par pokemon/set (cache niveau série)."""
    filtered = []
    cached_queries = local_context.get("cached_queries", {})
    
    for c in candidates:
        q = c["query"]
        q_type = c["type"]
        
        # Filtre sur la query exacte
        if q in cached_queries and cached_queries[q].get("age_days", 0) <= 7:
            if q_type == "card_exact":
                return []
            continue
            
        # Filtre intelligent sur le set/pokemon si déjà testé récemment
        cached_sets = local_context.get("cached_sets", {})
        if q_type == "set" and q in cached_sets and cached_sets[q].get("age_days", 0) <= 7:
            continue
            
        cached_pokemons = local_context.get("cached_pokemons", {})
        if q_type == "pokemon" and q in cached_pokemons and cached_pokemons[q].get("age_days", 0) <= 7:
            continue
            
        filtered.append(c)
        
    return filtered

def select_top_queries(candidates: List[dict], enriched_data: dict, limit: int = 1) -> List[dict]:
    """Sélectionne le meilleur keyword et active RELATED_QUERIES si pertinent."""
    if not candidates:
        return []
        
    sorted_candidates = sorted(candidates, key=lambda x: x["priority"], reverse=True)
    
    # Règle : carte chère sans keyword exact (ex: pas de numéro reconnu) -> RELATED_QUERIES
    has_exact = any(c["type"] == "card_exact" for c in sorted_candidates)
    if enriched_data.get("high_value_card") and not has_exact and len(sorted_candidates) > 0:
        best_fallback = sorted_candidates[0]
        # On force un RELATED_QUERIES à la place du TIMESERIES pour découvrir
        related_cand = {
            "query": best_fallback["query"],
            "type": best_fallback["type"],
            "priority": best_fallback["priority"] + 0.01,
            "data_type": "RELATED_QUERIES"
        }
        sorted_candidates.insert(0, related_cand)
        
    # Applique la limite stricte max_live_queries_per_subject
    return sorted_candidates[:limit]

def process_card_for_trends(card_ref: dict, local_context: dict) -> dict:
    """Traite une seule carte pour voir si elle mérite Trends."""
    subject_key = build_subject_key(card_ref)
    enriched = enrich_local_data(card_ref, local_context)
    requires, score, reasons = calculate_trend_lookup_importance(card_ref, enriched)
    
    result = {
        "subject_key": subject_key,
        "requires_trend_lookup": requires,
        "importance_score": round(score, 2),
        "reasons": reasons,
        "selected_queries": [],
        "enriched_data": enriched
    }
    
    if requires:
        cands = generate_candidate_keywords(card_ref)
        filtered = deduplicate_and_filter(cands, enriched, local_context)
        top = select_top_queries(filtered, enriched, limit=MAX_LIVE_QUERIES_PER_SUBJECT)
        result["selected_queries"] = top
        
    return result

def process_order_for_trends(order_snapshot: dict, local_context: dict) -> dict:
    """Orchestrateur global appliquant le budget et la déduplication au niveau de la commande."""
    cards = order_snapshot.get("items", [])
    order_ref = order_snapshot.get("order_ref", "unknown")
    
    processed_subjects = {}
    skipped = []
    scored_items = []
    
    # 1. Évaluation locale de chaque carte
    for card in cards:
        res = process_card_for_trends(card, local_context)
        subj = res["subject_key"]
        
        # Déduplication par sujet (plusieurs fois la même carte)
        if subj in processed_subjects:
            continue
        processed_subjects[subj] = True
        
        if res["requires_trend_lookup"]:
            scored_items.append(res)
        else:
            skipped.append({
                "subject_key": subj,
                "reason": res["reasons"][0] if res["reasons"] else "unknown"
            })
            
    # 2. Tri par importance
    import json
    print("Scored items:", json.dumps(scored_items, indent=2))
    scored_items.sort(key=lambda x: x["importance_score"], reverse=True)
    
    # 3. Application du budget et déduplication Pokemon/Série intra-commande
    final_subjects = []
    used_queries = set()
    used_pokemon_queries = set()
    used_set_queries = set()
    
    live_queries_allocated = 0
    
    for item in scored_items:
        if live_queries_allocated >= MAX_LIVE_QUERIES_PER_ORDER:
            skipped.append({
                "subject_key": item["subject_key"],
                "reason": "budget_exceeded"
            })
            continue
            
        final_queries = []
        for q in item["selected_queries"]:
            q_str = q["query"]
            q_type = q["type"]
            
            # Déduplication de la requête exacte
            if q_str in used_queries:
                continue
                
            # Déduplication des requêtes pokemon/set sur la commande
            if q_type == "pokemon":
                if q_str in used_pokemon_queries:
                    continue
                used_pokemon_queries.add(q_str)
                
            if q_type == "set":
                if q_str in used_set_queries:
                    continue
                used_set_queries.add(q_str)
                
            final_queries.append(q)
            used_queries.add(q_str)
            live_queries_allocated += 1
            
            # Limite globale
            if live_queries_allocated >= MAX_LIVE_QUERIES_PER_ORDER:
                break
                
        # Nettoyage des objets internes
        item.pop("enriched_data", None)
        
        if final_queries:
            item["selected_queries"] = final_queries
            final_subjects.append(item)
        else:
            skipped.append({
                "subject_key": item["subject_key"],
                "reason": "all_queries_deduplicated"
            })
            
    return {
        "order_ref": order_ref,
        "trend_budget": {
            "max_live_queries": MAX_LIVE_QUERIES_PER_ORDER,
            "selected_live_queries": live_queries_allocated,
            "remaining": MAX_LIVE_QUERIES_PER_ORDER - live_queries_allocated
        },
        "subjects": final_subjects,
        "skipped": skipped,
        "warnings": []
    }
