import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePrice,
  sanitizeCliArgs,
  detectBotChallenge,
  executeBackoffRetry,
} from '../scrapers/02-stealth-scraper.mjs';

test('stealth-scraper: parsePrice parses currencies into USD and EUR floats', () => {
  const usdResult = parsePrice('$14.99 USD');
  assert.equal(usdResult.priceUsd, 14.99);
  assert.equal(usdResult.currency, 'USD');
  assert.ok(usdResult.priceEur > 0);

  const eurResult = parsePrice('€12.50');
  assert.equal(eurResult.priceEur, 12.50);
  assert.equal(eurResult.currency, 'EUR');
  assert.equal(eurResult.priceUsd, 13.50); // 12.50 * 1.08 = 13.50

  const commaEur = parsePrice('12,50 EUR');
  assert.equal(commaEur.priceEur, 12.50);
  assert.equal(commaEur.currency, 'EUR');

  const gbpResult = parsePrice('£10.00');
  assert.equal(gbpResult.priceUsd, 12.70); // 10.00 * 1.27
  assert.equal(gbpResult.currency, 'GBP');
});

test('stealth-scraper: detectBotChallenge detects anti-bot signatures (RED-02)', () => {
  const challengeHtml = '<html><body><div class="cf-turnstile">Verify you are human</div></body></html>';
  assert.equal(detectBotChallenge(challengeHtml), true);

  const normalHtml = '<html><body><h1>Stamp Details</h1><div>Price: $10</div></body></html>';
  assert.equal(detectBotChallenge(normalHtml), false);
});

test('stealth-scraper: sanitizeCliArgs validates parameters and blocks command injection (RED-04)', () => {
  const validArgs = sanitizeCliArgs(['--country=PE', '--limit=20', '--rareOnly=true']);
  assert.equal(validArgs.country, 'PE');
  assert.equal(validArgs.limit, 20);
  assert.equal(validArgs.rareOnly, true);

  // RED-04 parameter injection test
  assert.throws(
    () => sanitizeCliArgs(['--country=PE; rm -rf /']),
    /Invalid country code argument/
  );

  assert.throws(
    () => sanitizeCliArgs(['--limit=-5']),
    /Invalid limit argument/
  );
});

test('stealth-scraper: executeBackoffRetry retries on failure with backoff interval', async () => {
  let attempts = 0;
  const retryableFn = async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('429 Rate Limit Exceeded');
    }
    return 'SUCCESS';
  };

  const retried = executeBackoffRetry(retryableFn, {
    maxRetries: 3,
    initialDelayMs: 10,
  });

  const result = await retried();
  assert.equal(result, 'SUCCESS');
  assert.equal(attempts, 3);
});
