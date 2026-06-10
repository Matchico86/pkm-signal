require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

let supabaseClient = null;

// Découverte de tables - Variables de cache
let resolvedCoteTable = null;
let resolvedCollectionTable = null;
let discoveryDone = false;

const COTE_CANDIDATES = [
  'cote_history', 'cotes', 'cotes_history', 'card_cote_history', 'prices_history', 'invest_cote_history'
];

const COLLECTION_CANDIDATES = [
  'collection', 'collections', 'collection_items', 'user_collection'
];

function createPortalSupabaseClientFromEnv() {
  if (supabaseClient) return supabaseClient;

  const url = process.env.PKM_PORTAL_SUPABASE_URL;
  const key = process.env.PKM_PORTAL_SUPABASE_READ_KEY;

  if (!url || !key) {
    return null;
  }

  // Initialisation sans retries agressifs pour ne pas bloquer en read-only
  supabaseClient = createClient(url, key, { auth: { persistSession: false } });
  return supabaseClient;
}

async function checkPortalSupabaseConnection() {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) return { connected: false, reason: "missing_env" };
  
  // Test minimal (juste ping RPC ou simple select avec limite 1 sur un nom de table bidon, on regarde juste si c'est AuthError ou Network)
  try {
    const { error } = await client.from('non_existent_table_ping').select('*').limit(1);
    if (error && (error.code === 'PGRST116' || error.code === '42P01' || error.message.includes('relation "public.non_existent_table_ping" does not exist'))) {
      return { connected: true };
    }
    return { connected: true }; // Si la base répond un message d'erreur SQL de base, c'est que c'est co.
  } catch (err) {
    return { connected: false, reason: err.message };
  }
}

async function discoverTables(client) {
  if (discoveryDone) return;
  discoveryDone = true;

  // 1. Env Overrides
  if (process.env.PKM_PORTAL_SUPABASE_COTE_TABLE) {
    resolvedCoteTable = process.env.PKM_PORTAL_SUPABASE_COTE_TABLE;
  } else {
    for (const table of COTE_CANDIDATES) {
      const { error } = await client.from(table).select('id').limit(1);
      if (!error || error.code !== '42P01') { // 42P01 = undefined_table
        resolvedCoteTable = table;
        break;
      }
    }
  }

  if (process.env.PKM_PORTAL_SUPABASE_COLLECTION_TABLE) {
    resolvedCollectionTable = process.env.PKM_PORTAL_SUPABASE_COLLECTION_TABLE;
  } else {
    for (const table of COLLECTION_CANDIDATES) {
      const { error } = await client.from(table).select('id').limit(1);
      if (!error || error.code !== '42P01') {
        resolvedCollectionTable = table;
        break;
      }
    }
  }
}

async function fetchPortalCoteHistoryByCardId(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();
  if (!client) {
    return { available: false, points: [], last_cote: null, last_cote_updated_at: null, warning: "portal_supabase_missing_env" };
  }

  await discoverTables(client);

  if (!resolvedCoteTable) {
    return { available: false, points: [], last_cote: null, last_cote_updated_at: null, warning: "portal_supabase_cote_table_not_found" };
  }

  let data = null;
  let error = null;

  // Try ordering by date first
  const resultDate = await client
    .from(resolvedCoteTable)
    .select('*')
    .eq('card_id', cardId)
    .order('date', { ascending: false, nullsFirst: false })
    .limit(100);

  if (resultDate.error && resultDate.error.message.includes('does not exist')) {
    // Fallback to created_at
    const resultCreatedAt = await client
      .from(resolvedCoteTable)
      .select('*')
      .eq('card_id', cardId)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(100);
    
    data = resultCreatedAt.data;
    error = resultCreatedAt.error;
  } else {
    data = resultDate.data;
    error = resultDate.error;
  }

  if (error) {
    return { available: false, points: [], last_cote: null, last_cote_updated_at: null, warning: `portal_supabase_cote_error: ${error.message}` };
  }

  if (!data || data.length === 0) {
    return { available: false, points: [], last_cote: null, last_cote_updated_at: null, warning: "portal_supabase_cote_history_missing" };
  }

  // Fallback map pour coller aux structures probables
  const points = data.map(r => ({
    date: r.date || r.created_at || null,
    value: Number(r.value || r.cote || r.price || 0),
    source: "portal_supabase"
  }));

  const lastPoint = points[0];

  return {
    available: true,
    points,
    last_cote: lastPoint.value,
    last_cote_updated_at: lastPoint.date,
    trend_30d: null,
    warning: null
  };
}

async function fetchPortalCollectionByCardId(cardId, options = {}) {
  const client = createPortalSupabaseClientFromEnv();
  
  const baseResult = {
    owners: {},
    warning: "portal_supabase_collection_missing"
  };

  if (!client) {
    baseResult.warning = "portal_supabase_missing_env";
    return { collection: baseResult };
  }

  await discoverTables(client);

  if (!resolvedCollectionTable) {
    baseResult.warning = "portal_supabase_collection_table_not_found";
    return { collection: baseResult };
  }

  const { data, error } = await client
    .from(resolvedCollectionTable)
    .select('*')
    .eq('card_id', cardId);

  if (error) {
    baseResult.warning = `portal_supabase_collection_error: ${error.message}`;
    return { collection: baseResult };
  }

  if (!data || data.length === 0) {
    return { collection: baseResult };
  }

  baseResult.warning = null; 

  const getOwnerKey = (rawName) => {
    const low = String(rawName).toLowerCase();
    if (low === 'mat' || low === 'mathieu') return 'mathieu';
    if (low === 'ewa' || low === 'ewan') return 'ewan';
    return low;
  };

  const initOwner = () => ({ owned: false, quantity: 0, best_condition: null, versions: [] });

  data.forEach(row => {
    // Si la table contient des colonnes mathieu_owned, ewan_owned
    if (row.mathieu_owned !== undefined || row.ewan_owned !== undefined) {
      if (row.mathieu_owned) {
        if (!baseResult.owners.mathieu) baseResult.owners.mathieu = initOwner();
        baseResult.owners.mathieu.owned = true;
        baseResult.owners.mathieu.quantity += Number(row.mathieu_qty || 1);
        if (row.mathieu_condition && !baseResult.owners.mathieu.best_condition) {
          baseResult.owners.mathieu.best_condition = row.mathieu_condition;
        }
      }
      if (row.ewan_owned) {
        if (!baseResult.owners.ewan) baseResult.owners.ewan = initOwner();
        baseResult.owners.ewan.owned = true;
        baseResult.owners.ewan.quantity += Number(row.ewan_qty || 1);
        if (row.ewan_condition && !baseResult.owners.ewan.best_condition) {
          baseResult.owners.ewan.best_condition = row.ewan_condition;
        }
      }
    }

    // Si la table contient une colonne owner (standard)
    if (row.owner || row.user_id) {
      const ownerName = getOwnerKey(row.owner || row.user_id);
      if (!baseResult.owners[ownerName]) baseResult.owners[ownerName] = initOwner();
      
      const targetOwner = baseResult.owners[ownerName];
      targetOwner.owned = true;
      targetOwner.quantity += Number(row.quantity || row.qty || 1);
      
      const condition = row.condition || row.state || row.etat || null;
      if (condition && !targetOwner.best_condition) {
        targetOwner.best_condition = condition;
      }
    }
  });

  return { collection: baseResult };
}

// Memory cache pour context global
const contextCache = new Map();

async function fetchPortalContextByCardId(cardId, options = {}) {
  if (contextCache.has(cardId)) {
    return contextCache.get(cardId);
  }

  const [cote_history, collectionData] = await Promise.all([
    fetchPortalCoteHistoryByCardId(cardId, options),
    fetchPortalCollectionByCardId(cardId, options)
  ]);

  const result = {
    card_id: cardId,
    cote_history,
    collection: collectionData.collection
  };

  contextCache.set(cardId, result);
  return result;
}

module.exports = {
  createPortalSupabaseClientFromEnv,
  checkPortalSupabaseConnection,
  fetchPortalCoteHistoryByCardId,
  fetchPortalCollectionByCardId,
  fetchPortalContextByCardId
};
