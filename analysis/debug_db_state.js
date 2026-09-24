require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugDB() {
  console.log("=== DB DEBUG ===");
  
  // Check assist_sessions
  console.log("\n[1] Fetching last 3 assist_sessions (domain='buy')...");
  const { data: sessions, error: sessErr } = await supabase
    .from('assist_sessions')
    .select('session_id, slot, external_ref, updated_at, latest_snapshot')
    .eq('domain', 'buy')
    .order('updated_at', { ascending: false })
    .limit(3);

  if (sessErr) {
    console.error("Error fetching sessions:", sessErr.message);
  } else {
    sessions.forEach((s, i) => {
      console.log(`\n--- Session ${i + 1} ---`);
      console.log(`ID: ${s.session_id}`);
      console.log(`Slot: ${s.slot}`);
      console.log(`External Ref: ${s.external_ref}`);
      console.log(`Updated At: ${s.updated_at}`);
      const snap = s.latest_snapshot || {};
      console.log(`Event Type: ${snap.event_type || 'N/A (full snapshot?)'}`);
      if (snap.item) {
        console.log(`Item Line ID: ${snap.item.line_id}`);
        console.log(`Item Card ID: ${snap.item.card_id}`);
      }
    });
  }

  // Check assist_signals
  console.log("\n[2] Fetching last 5 assist_signals...");
  const { data: signals, error: sigErr } = await supabase
    .from('assist_signals')
    .select('session_id, scope, entity_ref, title, severity, status, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (sigErr) {
    console.error("Error fetching signals:", sigErr.message);
  } else {
    signals.forEach((sig, i) => {
      console.log(`\n--- Signal ${i + 1} ---`);
      console.log(`Session ID: ${sig.session_id}`);
      console.log(`Entity Ref: ${sig.entity_ref}`);
      console.log(`Title: ${sig.title}`);
      console.log(`Severity: ${sig.severity}`);
      console.log(`Status: ${sig.status}`);
      console.log(`Created At: ${sig.created_at}`);
    });
  }
}

debugDB().catch(console.error);
