import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseAndValidateArgs } from '../scrapers/mirror-images.mjs';

test('threat-matrix: CLI parameter injection resistance', () => {
  const maliciousInputs = [
    "--country=PE' OR 1=1--",
    '--country=<script>alert(1)</script>',
    '--country=../../etc/passwd',
    '--limit=100; DROP TABLE Stamp;',
  ];

  for (const input of maliciousInputs) {
    const options = parseAndValidateArgs([input]);
    if (options.country) {
      assert.match(options.country, /^[A-Z0-9]+$/);
      assert.ok(!options.country.includes("'"));
      assert.ok(!options.country.includes(';'));
      assert.ok(!options.country.includes('<'));
    }
    assert.equal(typeof options.limit, 'number');
    assert.ok(!Number.isNaN(options.limit));
  }
});

test('threat-matrix: secret scan audit for hardcoded API keys in scraper code', () => {
  const libDir = './scrapers/lib';
  const scraperFiles = fs.readdirSync(libDir).map((f) => path.join(libDir, f));
  scraperFiles.push('./scrapers/mirror-images.mjs', './scrapers/hydrate-d1-urls.mjs', './scrapers/check-integrity.mjs');

  const secretRegexes = [
    /AKIA[0-9A-Z]{16}/,
    /R2_SECRET_[A-Za-z0-9_]+=[a-zA-Z0-9_-]{20,}/,
    /bearer\s+[a-zA-Z0-9._-]{30,}/i,
  ];

  for (const filePath of scraperFiles) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const regex of secretRegexes) {
      assert.ok(
        !regex.test(content),
        `Potential hardcoded secret matching ${regex} found in ${filePath}`
      );
    }
  }
});
