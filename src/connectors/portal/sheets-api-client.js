require('dotenv').config();

async function fetchSheetsBundle(tables = "STOCK,PURCH_ITEMS,SALES_ITEMS,INVEST_ITEMS", cardId = null) {
  const url = process.env.PKM_SHEETS_API_URL;
  const token = process.env.PKM_SHEETS_API_TOKEN;

  if (!url || !token) {
    return { ok: false, error: "PKM_SHEETS_API_URL ou PKM_SHEETS_API_TOKEN manquant." };
  }

  try {
    let fullUrl = `${url}?action=bundle&tables=${tables}&token=${encodeURIComponent(token)}`;
    if (cardId) {
      fullUrl += `&card_id=${encodeURIComponent(cardId)}`;
    }
    const response = await fetch(fullUrl);
    const data = await response.json();
    return data;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = { fetchSheetsBundle };
