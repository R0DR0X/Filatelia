/**
 * SCRAPER 04 - AI Philatelic Catalog Enricher
 * ====================================================
 * Processes un-enriched stamps using OpenRouter (Claude 3.5 Sonnet).
 * Generates Spanish descriptions (description_es), thematic tags (themes),
 * and computes integer rarityScore (1-10) with strict bounds clamping.
 *
 * USO:
 *   node scrapers/04-ai-enricher.mjs
 *   node scrapers/04-ai-enricher.mjs --country=PE --limit=100
 */

import fs from 'fs';

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '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';
const CHECKPOINT_FILE = './scrapers/checkpoints/ai-enricher.json';
const DELAY_MS = 1000;
const BATCH_SIZE = 5; // Max 5 parallel requests
const MODEL_NAME = 'anthropic/claude-3.5-sonnet';

/**
 * Validates and sanitizes CLI arguments to prevent parameter injection
 */
export function sanitizeCliArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts.length > 1 ? parts.slice(1).join('=') : 'true';

      if (key === 'country') {
        if (!/^[A-Za-z]{2}$/.test(val)) {
          throw new Error(`Invalid country code argument: "${val}". Must be a 2-letter ISO country code.`);
        }
        parsed.country = val.toUpperCase();
      } else if (key === 'limit') {
        const num = parseInt(val, 10);
        if (isNaN(num) || num <= 0 || num > 5000) {
          throw new Error(`Invalid limit argument: "${val}". Must be a positive integer between 1 and 5000.`);
        }
        parsed.limit = num;
      }
    }
  }
  return {
    country: parsed.country || null,
    limit: parsed.limit || 500,
  };
}

/**
 * Sanitizes API keys and bearer tokens from log messages
 */
export function sanitizeLogs(text, secretKey = OPENROUTER_KEY) {
  if (!text || typeof text !== 'string') return text;
  let sanitized = text;
  if (secretKey) {
    sanitized = sanitized.split(secretKey).join('[REDACTED_SECRET]');
  }
  sanitized = sanitized
    .replace(/sk-or-v1-[a-f0-9]{32,64}/gi, '[REDACTED_SECRET]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_SECRET]');
  return sanitized;
}

/**
 * Validates and normalizes AI response payload, enforcing rarityScore bounds (1-10)
 */
export function validateAndNormalizeAIResponse(rawJson) {
  if (!rawJson || typeof rawJson !== 'object') {
    throw new Error('Schema violation: AI output is not a valid JSON object');
  }

  const description_es = rawJson.description_es || rawJson.descriptionEs || '';
  if (!description_es || typeof description_es !== 'string' || description_es.trim().length === 0) {
    throw new Error('Schema violation: Missing or empty description_es');
  }

  let themes = rawJson.themes || rawJson.theme || [];
  if (typeof themes === 'string') {
    themes = themes.split(',').map(t => t.trim()).filter(Boolean);
  }
  if (!Array.isArray(themes)) {
    themes = [];
  }

  // Parse and clamp rarityScore strictly between 1 and 10 as an integer
  let rawScore = rawJson.rarityScore ?? rawJson.rarity_score ?? 5;
  let parsedScore = typeof rawScore === 'number' ? rawScore : parseFloat(rawScore);
  if (isNaN(parsedScore)) parsedScore = 5;

  const rarityScore = Math.min(10, Math.max(1, Math.round(parsedScore)));
  const isRare = rarityScore >= 7 || Boolean(rawJson.isRare);
  const isErrorStamp = Boolean(rawJson.isErrorStamp || rawJson.is_error_stamp);

  return {
    description_es: description_es.trim(),
    description_en: (rawJson.description_en || rawJson.descriptionEn || '').trim(),
    themes,
    rarityScore,
    isRare,
    isErrorStamp,
  };
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function loadCheckpoint() {
  fs.mkdirSync('./scrapers/checkpoints', { recursive: true });
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  } catch {}
  return { offset: 0, totalProcessed: 0, totalErrors: 0 };
}

export function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

/**
 * Query D1 for un-enriched stamps
 */
export async function fetchStampsToEnrich(offset, limit, countryFilter = null) {
  const conditions = ['(descriptionEs IS NULL OR descriptionEs = "" OR rarityScore IS NULL)'];
  const params = [];

  if (countryFilter) {
    conditions.push('countryCode = ?');
    params.push(countryFilter);
  }

  const sql = `
    SELECT id, wnsNumber, nameEs, nameEn, countryCode, year, 
           denomination, currency, theme, color, printTechnique,
           imageUrl, source
    FROM Stamp
    WHERE ${conditions.join(' AND ')}
    ORDER BY createdAt ASC
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);

  const res = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) throw new Error(`D1 API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.results || [];
}

/**
 * Invoke OpenRouter Anthropic Claude 3.5 Sonnet for stamp enrichment
 */
export async function enrichStampWithAI(stamp, options = {}) {
  if (options.mockResponse) {
    return validateAndNormalizeAIResponse(options.mockResponse);
  }

  const apiKey = options.apiKey || OPENROUTER_KEY;
  const prompt = `Analiza los siguientes datos filatélicos y devuelve un JSON ESTRICTO con los campos de enriquecimiento:

DATOS DEL SELLO:
- Nombre: ${stamp.nameEs || stamp.nameEn || 'Desconocido'}
- País: ${stamp.countryCode || 'Desconocido'}
- Año: ${stamp.year || 'Desconocido'}
- Valor facial: ${stamp.denomination ? `${stamp.denomination} ${stamp.currency || ''}` : 'Desconocido'}
- Técnica: ${stamp.printTechnique || 'Desconocida'}
- Color: ${stamp.color || 'Desconocido'}

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON CON LA SIGUIENTE ESTRUCTURA (sin explicaciones, sin markdown):
{
  "description_es": "Descripción filatélica detallada en español (2-3 oraciones).",
  "description_en": "Detailed philatelic description in English.",
  "themes": ["historia", "fauna"],
  "rarityScore": 7,
  "isRare": false,
  "isErrorStamp": false
}

REGLAS:
- rarityScore: entero del 1 al 10 (1=común, 10=raro/valioso).
- themes: array de etiquetas de temáticas (ej: flora, fauna, aviacion, historia).`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://filatelia-web.pages.dev',
      'X-Title': 'Filatelia AI Enricher',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 600,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const sanitizedErr = sanitizeLogs(errText, apiKey);
    throw new Error(`OpenRouter HTTP ${res.status}: ${sanitizedErr}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`IA no devolvió JSON válido: ${sanitizeLogs(content.slice(0, 150), apiKey)}`);
  }

  const rawJson = JSON.parse(jsonMatch[0]);
  return validateAndNormalizeAIResponse(rawJson);
}

/**
 * Atomic idempotent update to Cloudflare D1 database
 */
export async function updateStampInD1(stampId, enriched) {
  const themesStr = Array.isArray(enriched.themes) ? enriched.themes.join(',') : (enriched.themes || '');

  const sql = `
    UPDATE Stamp SET
      descriptionEs = ?,
      description_es = ?,
      descriptionEn = ?,
      description_en = ?,
      theme = COALESCE(?, theme),
      themes = ?,
      rarityScore = ?,
      rarity_score = ?,
      isRare = ?,
      isErrorStamp = ?,
      last_enriched_at = datetime('now'),
      updatedAt = datetime('now')
    WHERE id = ?
  `;

  const params = [
    enriched.description_es,
    enriched.description_es,
    enriched.description_en || null,
    enriched.description_en || null,
    enriched.themes?.[0] || null,
    themesStr,
    enriched.rarityScore,
    enriched.rarityScore,
    enriched.isRare ? 1 : 0,
    enriched.isErrorStamp ? 1 : 0,
    stampId,
  ];

  const res = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    throw new Error(`D1 Update API failed with HTTP ${res.status}`);
  }
}

/**
 * Processes a batch of stamps concurrently (max BATCH_SIZE)
 */
export async function processBatch(stamps, options = {}) {
  const results = await Promise.allSettled(
    stamps.map(async stamp => {
      const enriched = await enrichStampWithAI(stamp, options);
      await updateStampInD1(stamp.id, enriched);
      return { stampId: stamp.id, enriched };
    })
  );
  return results;
}

async function main() {
  const config = sanitizeCliArgs();
  const cp = loadCheckpoint();

  console.log(`\n🤖 AI Enricher starting (Model: ${MODEL_NAME})`);
  console.log(`   Country: ${config.country || 'ALL'}`);
  console.log(`   Limit: ${config.limit} stamps`);
  console.log(`   Processed so far: ${cp.totalProcessed}\n`);

  let processed = 0;

  while (processed < config.limit) {
    const currentLimit = Math.min(BATCH_SIZE, config.limit - processed);
    let stamps;
    try {
      stamps = await fetchStampsToEnrich(cp.offset, currentLimit, config.country);
    } catch (err) {
      console.error(sanitizeLogs(`❌ Error fetching stamps: ${err.message}`));
      break;
    }

    if (!stamps || stamps.length === 0) {
      console.log('✅ No more stamps require enrichment.');
      break;
    }

    console.log(`\n📋 Processing batch of ${stamps.length} stamps (offset ${cp.offset})`);

    const results = await processBatch(stamps);

    let failedCount = 0;
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      const stamp = stamps[i];
      if (res.status === 'fulfilled') {
        console.log(`  🔮 [${stamp.countryCode}/${stamp.year}] ${stamp.id} -> score=${res.value.enriched.rarityScore}`);
        cp.totalProcessed++;
        processed++;
      } else {
        console.error(sanitizeLogs(`  ❌ ${stamp.id}: ${res.reason.message}`));
        cp.totalErrors++;
        failedCount++;
      }
    }

    // Only increment offset over failed items so successful (now enriched) items don't cause page drift
    cp.offset += failedCount;
    saveCheckpoint(cp);
    await sleep(DELAY_MS);
  }

  console.log(`\n✅ AI Enricher completed!`);
  console.log(`   Total Processed: ${cp.totalProcessed}`);
  console.log(`   Total Errors:    ${cp.totalErrors}`);
}

if (process.argv[1] && process.argv[1].endsWith('04-ai-enricher.mjs')) {
  main().catch(err => {
    console.error(sanitizeLogs(`Fatal error: ${err.message}`));
    process.exit(1);
  });
}
