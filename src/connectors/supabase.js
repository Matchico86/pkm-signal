require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const isHttpUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);
const supabaseUrl = (isHttpUrl(process.env.SUPABASE_URL) ? process.env.SUPABASE_URL : process.env.PKM_PORTAL_SUPABASE_URL) || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (isHttpUrl(supabaseUrl) && supabaseKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
  } catch (e) {
    console.warn('[Supabase] Erreur initialisation client Supabase:', e.message);
  }
} else {
  console.warn('[Supabase] Credentials manquants ou URL invalide. Mode Mock activé (aucune écriture en base).');
}

/**
 * Insère ou récupère une session.
 * Pour l'achat, domain='buy', slot='validation', external_ref=draft_order_id
 */
async function upsertSession(domain, slot, externalRef, snapshot) {
  if (!supabase) return { session_id: 'mock-session-id' };

  // On cherche une session existante active (contrainte unique sur domain + external_ref)
  const { data: existing, error: searchError } = await supabase
    .from('assist_sessions')
    .select('session_id')
    .eq('domain', domain)
    .eq('external_ref', externalRef)
    .maybeSingle();

  if (existing) {
    // Mettre à jour le snapshot et le slot
    await supabase
      .from('assist_sessions')
      .update({ slot, latest_snapshot: snapshot, updated_at: new Date().toISOString() })
      .eq('session_id', existing.session_id);
    return existing;
  }

  // Sinon création
  const { data, error } = await supabase
    .from('assist_sessions')
    .insert({
      domain,
      slot,
      external_ref: externalRef,
      latest_snapshot: snapshot,
      status: 'active'
    })
    .select('session_id')
    .single();

  if (error) {
    console.error('[Supabase] Erreur upsertSession:', error);
    throw error;
  }
  return data;
}

/**
 * Crée un nouveau Run d'assistant.
 */
async function createRun(sessionId, domain, slot, snapshot) {
  if (!supabase) return { run_id: 'mock-run-id' };

  const { data, error } = await supabase
    .from('assist_runs')
    .insert({
      session_id: sessionId,
      input_snapshot: snapshot,
      status: 'running'
    })
    .select('run_id')
    .single();

  if (error) {
    console.error('[Supabase] Erreur createRun:', error);
    throw error;
  }
  return data;
}

/**
 * Met à jour le statut du run (succès ou échec).
 */
async function updateRunStatus(runId, status, durationMs = null, errorMessage = null) {
  if (!supabase) return;

  const updatePayload = { status };
  if (durationMs !== null) updatePayload.duration_ms = durationMs;
  if (errorMessage !== null) updatePayload.error_message = errorMessage;

  const { error } = await supabase
    .from('assist_runs')
    .update(updatePayload)
    .eq('run_id', runId);

  if (error) {
    console.error('[Supabase] Erreur updateRunStatus:', error);
  }
}

/**
 * Insère une liste de signaux générés par les patterns ou les jobs.
 */
async function insertSignals(sessionId, runId, domain, slot, signalsArray) {
  if (!supabase || signalsArray.length === 0) return;

  const rows = signalsArray.map(sig => ({
    session_id: sessionId,
    run_id: runId,
    scope: sig.scope || (sig.entity_type === 'line' || sig.entity_ref || (sig.context && sig.context.draft_item_id) ? 'item' : 'order'),
    entity_ref: sig.entity_ref || (sig.context && sig.context.draft_item_id) || (sig.context && sig.context.draft_order_id) || null,
    card_id: sig.card_id || (sig.context && sig.context.card_id) || (sig.payload && sig.payload.card_id) || null,
    severity: sig.severity || (sig.level === 'warning' ? 'warning' : 'info'),
    title: sig.title || sig.signal_type || sig.type,
    message: sig.message,
    payload: sig.payload || (sig.context && sig.context.payload) || null,
    status: sig.status || 'active'
  }));

  const { error } = await supabase
    .from('assist_signals')
    .insert(rows);

  if (error) {
    console.error('[Supabase] Erreur insertSignals:', error);
    throw error;
  }
}

/**
 * Met à jour le statut des signaux liés à une entité précise (ex: line_id) dans une session.
 */
async function updateSignalsStatusByEntity(sessionId, entityRef, newStatus) {
  if (!supabase) return;

  const { error } = await supabase
    .from('assist_signals')
    .update({ status: newStatus })
    .eq('session_id', sessionId)
    .eq('entity_ref', entityRef);

  if (error) {
    console.error('[Supabase] Erreur updateSignalsStatusByEntity:', error);
  }
}

module.exports = {
  upsertSession,
  createRun,
  updateRunStatus,
  insertSignals,
  updateSignalsStatusByEntity
};
