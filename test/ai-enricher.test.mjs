import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAndNormalizeAIResponse,
  sanitizeLogs,
  sanitizeCliArgs,
  enrichStampWithAI,
} from '../scrapers/04-ai-enricher.mjs';

test('ai-enricher: validateAndNormalizeAIResponse clamps rarityScore to bounds [1, 10] (RED-01, TM-04)', () => {
  // Test score > 10 clamped to 10
  const highScored = validateAndNormalizeAIResponse({
    description_es: 'Sello de prueba rarísimo de 1860.',
    themes: ['historia'],
    rarityScore: 15,
  });
  assert.equal(highScored.rarityScore, 10);

  // Test score < 1 clamped to 1
  const lowScored = validateAndNormalizeAIResponse({
    description_es: 'Sello común de prueba.',
    themes: ['fauna'],
    rarityScore: -3,
  });
  assert.equal(lowScored.rarityScore, 1);

  // Test floating point rounded to integer
  const floatScored = validateAndNormalizeAIResponse({
    description_es: 'Sello clásico de valor medio.',
    themes: ['flora'],
    rarityScore: 6.7,
  });
  assert.equal(floatScored.rarityScore, 7);
});

test('ai-enricher: validateAndNormalizeAIResponse throws on missing description (RED-01)', () => {
  assert.throws(
    () => validateAndNormalizeAIResponse({ rarityScore: 5 }),
    /Schema violation/
  );
});

test('ai-enricher: sanitizeLogs redacts API keys and Bearer tokens (RED-05, TM-03)', () => {
  const secretKey = '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';
  const rawLog = `Error invoking OpenRouter with key ${secretKey} using Authorization: Bearer ${secretKey}`;
  const sanitized = sanitizeLogs(rawLog, secretKey);

  assert.equal(sanitized.includes(secretKey), false);
  assert.ok(sanitized.includes('[REDACTED_SECRET]'));
});

test('ai-enricher: sanitizeCliArgs validates inputs and rejects invalid parameters (RED-04)', () => {
  const parsed = sanitizeCliArgs(['--country=PE', '--limit=100']);
  assert.equal(parsed.country, 'PE');
  assert.equal(parsed.limit, 100);

  assert.throws(
    () => sanitizeCliArgs(['--country=PERU_EXTRA_LONG']),
    /Invalid country code argument/
  );
});

test('ai-enricher: enrichStampWithAI returns normalized payload on mock response', async () => {
  const mockStamp = { id: 'PER-1860-001', nameEs: 'Un Dinero Azul', countryCode: 'PE', year: 1860 };
  const mockResponse = {
    description_es: 'Sello clasico peruano impreso en 1860.',
    themes: ['historia', "escudos"],
    rarityScore: 8,
    isRare: true,
  };

  const result = await enrichStampWithAI(mockStamp, { mockResponse });
  assert.equal(result.description_es, 'Sello clasico peruano impreso en 1860.');
  assert.equal(result.rarityScore, 8);
  assert.equal(result.isRare, true);
});
