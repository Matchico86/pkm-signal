const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { findPerfectCandidate } = require('../src/connectors/prices/cardmarket-tcg-client');

describe('CardMarket TCG Perfect Matcher (Parfait ou rien)', () => {
  const sampleCandidatesMewtwo = [
    {
      id: 17696,
      name: 'Mewtwo ex',
      card_number: 101,
      card_code_number: 'RS 101',
      episode: { name: 'EX Ruby & Sapphire', code: 'RS' },
      cardmarket_id: 275749,
      prices: {
        cardmarket: {
          lowest_near_mint: 375,
          lowest_near_mint_FR: null
        }
      }
    },
    {
      id: 5240,
      name: 'Mewtwo-EX',
      card_number: 54,
      card_code_number: 'CEL 54',
      episode: { name: 'Celebrations', code: 'CEL' },
      cardmarket_id: 576792,
      prices: {
        cardmarket: {
          lowest_near_mint: 11.95,
          lowest_near_mint_FR: 68
        }
      }
    }
  ];

  test('Mewtwo Celebrations selectionne strictement la carte Celebrations FR NM (68e) et rejette le vintage 2004 (375e)', () => {
    const target = {
      name: 'Mewtwo-EX',
      number: 'CC022',
      set_id: 'CEL',
      set_name: 'Celebrations'
    };

    const match = findPerfectCandidate(sampleCandidatesMewtwo, target);
    assert.ok(match, 'Un match parfait doit etre trouve');
    assert.equal(match.candidate.id, 5240);
    assert.equal(match.frPrice, 68);
    assert.equal(match.candidate.cardmarket_id, 576792);
  });

  const sampleCandidatesSylveon = [
    {
      id: 4894,
      name: 'Sylveon V',
      card_number: 'TG14',
      card_code_number: 'BRS TG14',
      episode: { name: 'Brilliant Stars', code: 'BRS' },
      cardmarket_id: 604921,
      prices: { cardmarket: { lowest_near_mint_FR: 35 } }
    },
    {
      id: 48303,
      name: 'Dark Sylveon V (Oversized)',
      type: 'oversized',
      card_number: 'SWSH134',
      card_code_number: 'PR-SW SWSH134',
      episode: { name: 'SWSH Black Star Promos', code: 'PR-SW' },
      cardmarket_id: 576907,
      prices: { cardmarket: { lowest_near_mint_FR: 1.49 } }
    },
    {
      id: 7165,
      name: 'Dark Sylveon V',
      type: 'singles',
      card_number: 'SWSH134',
      card_code_number: 'PR-SW SWSH134',
      episode: { name: 'SWSH Black Star Promos', code: 'PR-SW' },
      cardmarket_id: 576733,
      prices: { cardmarket: { lowest_near_mint_FR: 16.8 } }
    }
  ];

  test('Nymphali SWSH134 selectionne Dark Sylveon V reguliere (16.80e) et rejette la TG14 (35e) et la Jumbo', () => {
    const target = {
      name: 'Nymphali obscur V',
      number: 'SWSH134',
      set_id: 'SWSH',
      set_name: 'Promo SWSH'
    };

    const match = findPerfectCandidate(sampleCandidatesSylveon, target);
    assert.ok(match, 'Un match parfait doit etre trouve');
    assert.equal(match.candidate.id, 7165);
    assert.equal(match.frPrice, 16.8);
    assert.equal(match.candidate.cardmarket_id, 576733);
  });

  test('Rejet absolu si aucune cotation FR NM disponible (regle 100% FR stricte)', () => {
    const candidatesNoFr = [
      {
        id: 9999,
        name: 'Rayquaza VMAX',
        card_number: '218',
        episode: { name: 'Evolving Skies', code: 'EVS' },
        prices: {
          cardmarket: {
            lowest_near_mint: 1200,
            lowest_near_mint_FR: null
          }
        }
      }
    ];

    const target = {
      name: 'Rayquaza VMAX',
      number: '218',
      set_id: 'EVS',
      set_name: 'Evolution Celeste'
    };

    const match = findPerfectCandidate(candidatesNoFr, target);
    assert.equal(match, null, 'Doit retourner null quand pas de FR');
  });

  test('Rejet si la serie et le numero ne correspondent pas', () => {
    const mismatch = [
      {
        id: 1111,
        name: 'Pikachu',
        card_number: '025',
        episode: { name: 'Base Set', code: 'BS' },
        prices: { cardmarket: { lowest_near_mint_FR: 50 } }
      }
    ];

    const target = {
      name: 'Pikachu',
      number: '160',
      set_id: 'CRZ',
      set_name: 'Crown Zenith'
    };

    const match = findPerfectCandidate(mismatch, target);
    assert.equal(match, null, 'Doit rejeter un mismatch de serie');
  });
});
