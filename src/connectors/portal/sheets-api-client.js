/**
 * @deprecated Google Apps Script / Sheets API has been decommissioned from Portal.
 * All live data is now hosted directly in Portal's Supabase instance.
 * Use src/connectors/portal/supabase-portal-reader.js instead.
 */
async function fetchSheetsBundle(tables = "STOCK,PURCH_ITEMS,SALES_ITEMS,INVEST_ITEMS", cardId = null) {
  return {
    ok: false,
    error: "Sheets API decommissioned: Google Apps Script has been retired. Use Supabase Portal reader."
  };
}

module.exports = { fetchSheetsBundle };

