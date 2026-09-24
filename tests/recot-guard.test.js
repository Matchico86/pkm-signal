const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateLiveRecotEligibility } = require('../src/core/enrichment/recot-guard');

describe('Garde-fous de Recotation en Direct (Filtres Stricts V1)', () => {
  const refDate = '2026-09-12T12:00:00Z';

  // Base ligne valide : Variant N, NM, FR, non gradé, prix 15€ (> 10€)
  const validBaseLine = {
    buy_price_unit: 15.0,
    condition: 'NM',
    language: 'FR',
    variant: 'N',
    is_graded: false
  };

  test('Succès : Tous les critères réunis (Variant N, NM, FR, non gradé, prix > 10€)', () => {
    const rawFacts = { cote: { last_value: null, updated_at: null } };
    const result = evaluateLiveRecotEligibility(validBaseLine, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, true);
    assert.equal(result.reason, 'eligible');
    assert.equal(result.details.buy_price, 15.0);
    assert.equal(result.details.variant, 'N');
  });

  test('Filtre 1: Refusé si prix d achat <= 10€ (ex: 10.00€ ou 6.50€)', () => {
    const lineLow = { ...validBaseLine, buy_price_unit: 10.0 };
    const rawFacts = { cote: null };
    const result = evaluateLiveRecotEligibility(lineLow, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'buy_price_must_exceed_10');
    assert.equal(result.details.buy_price, 10.0);
  });

  test('Filtre 1 bis: Refusé si aucun prix d achat saisi (ex: 0€ ou vide), même si cote en base existe', () => {
    const lineNoPrice = { ...validBaseLine, buy_price_unit: 0 };
    const rawFacts = { cote: { last_value: 50.0 } };
    const result = evaluateLiveRecotEligibility(lineNoPrice, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'no_buy_price_entered');
  });

  test('Filtre 2: Refusé si la langue n est pas FR (ex: EN ou JP)', () => {
    const lineEn = { ...validBaseLine, language: 'EN' };
    const rawFacts = { cote: null };
    const result = evaluateLiveRecotEligibility(lineEn, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'not_french_language');
    assert.equal(result.details.language, 'EN');
  });

  test('Filtre 3: Refusé si l état n est pas NM / MINT (ex: EX, GD, LP)', () => {
    const lineEx = { ...validBaseLine, condition: 'EX' };
    const rawFacts = { cote: null };
    const resultEx = evaluateLiveRecotEligibility(lineEx, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });
    assert.equal(resultEx.eligible, false);
    assert.equal(resultEx.reason, 'condition_not_nm');
    assert.equal(resultEx.details.condition, 'EX');

    const lineGd = { ...validBaseLine, condition: 'GD' };
    const resultGd = evaluateLiveRecotEligibility(lineGd, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });
    assert.equal(resultGd.eligible, false);
    assert.equal(resultGd.reason, 'condition_not_nm');
  });

  test('Filtre 4: Refusé si la carte est gradée (GRA / PSA / state_mode graded)', () => {
    const lineGraded1 = { ...validBaseLine, is_graded: true };
    const lineGraded2 = { ...validBaseLine, condition: 'GRA' };

    const res1 = evaluateLiveRecotEligibility(lineGraded1, {}, { referenceDate: refDate, skipQuotaCheck: true });
    assert.equal(res1.eligible, false);
    assert.equal(res1.reason, 'card_is_graded');

    const res2 = evaluateLiveRecotEligibility(lineGraded2, {}, { referenceDate: refDate, skipQuotaCheck: true });
    assert.equal(res2.eligible, false);
    assert.equal(res2.reason, 'card_is_graded');
  });

  test('Filtre 5: Refusé si la variante n est pas dans les variantes autorisées (défaut: N)', () => {
    const lineReverse = { ...validBaseLine, variant: 'R' };
    const rawFacts = { cote: null };
    const result = evaluateLiveRecotEligibility(lineReverse, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'variant_not_eligible');
    assert.equal(result.details.variant, 'R');
  });

  test('Filtre 5 bis: Autorisé si options.allowedVariants inclut R', () => {
    const lineReverse = { ...validBaseLine, variant: 'R' };
    const rawFacts = { cote: null };
    const result = evaluateLiveRecotEligibility(lineReverse, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true,
      allowedVariants: ['N', 'R']
    });

    assert.equal(result.eligible, true);
    assert.equal(result.reason, 'eligible');
  });

  test('Garde-fou Fraîcheur: Refusé si la cote en base a <= 7 jours', () => {
    const rawFacts = { cote: { last_value: 25.0, updated_at: '2026-09-09T10:00:00Z' } }; // 3 jours
    const result = evaluateLiveRecotEligibility(validBaseLine, rawFacts, {
      referenceDate: refDate,
      skipQuotaCheck: true
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'recent_quote_fresh');
    assert.equal(result.details.age_days, 3);
  });

  test('Garde-fou Quota: Refusé si quota journalier Acheter (10 req/j) dépassé', () => {
    const origEnv = process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY;
    process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY = '0';

    const result = evaluateLiveRecotEligibility(validBaseLine, {}, {
      referenceDate: refDate,
      skipQuotaCheck: false
    });

    assert.equal(result.eligible, false);
    assert.equal(result.reason, 'live_assist_daily_limit_reached');

    process.env.LIVE_ASSIST_MAX_REQUESTS_PER_DAY = origEnv;
  });
});
