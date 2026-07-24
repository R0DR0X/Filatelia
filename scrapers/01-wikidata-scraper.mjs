/**
 * SCRAPER 01 - Wikidata SPARQL
 * ============================
 * Extrae sellos postales de Wikidata via SPARQL (gratuito, sin bloqueos).
 * Fuente: https://query.wikidata.org/sparql
 * Cobertura estimada: ~80,000 sellos históricos
 *
 * USO:
 *   node scrapers/01-wikidata-scraper.mjs
 *   node scrapers/01-wikidata-scraper.mjs --country PE  (solo Perú)
 *   node scrapers/01-wikidata-scraper.mjs --limit 500   (test con 500)
 */

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const CHECKPOINT_FILE = './scrapers/checkpoints/wikidata.json';
const BATCH_SIZE = 10;       // Enviar al API en lotes de 10 (evita CPU limit Worker)
const QUERY_LIMIT = 5000;    // Resultados por query SPARQL
const DELAY_MS = 1500;       // 1.5s entre queries SPARQL (respetar rate limits)

// Parsear argumentos CLI
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v || true])
);
const COUNTRY_FILTER = args.country || null;
const LIMIT_FILTER = args.limit ? parseInt(args.limit) : null;

import fs from 'fs';
import path from 'path';

// Mapa ISO de países (Wikidata label → ISO code)
const COUNTRY_MAP = {
  'Peru': 'PE', 'Perú': 'PE',
  'United States': 'US', 'United States of America': 'US',
  'Germany': 'DE', 'France': 'FR', 'United Kingdom': 'GB',
  'Spain': 'ES', 'Italy': 'IT', 'Japan': 'JP',
  'Australia': 'AU', 'Canada': 'CA', 'Brazil': 'BR',
  'Argentina': 'AR', 'Mexico': 'MX', 'Chile': 'CL',
  'Colombia': 'CO', 'Venezuela': 'VE', 'Uruguay': 'UY',
  'Bolivia': 'BO', 'Ecuador': 'EC', 'Paraguay': 'PY',
  'Soviet Union': 'SU', 'China': 'CN', 'India': 'IN',
  'Israel': 'IL', 'Netherlands': 'NL', 'Belgium': 'BE',
  'Switzerland': 'CH', 'Austria': 'AT', 'Poland': 'PL',
  'Romania': 'RO', 'Czechoslovakia': 'CS', 'Hungary': 'HU',
  'Portugal': 'PT', 'Sweden': 'SE', 'Norway': 'NO',
  'Denmark': 'DK', 'Finland': 'FI', 'New Zealand': 'NZ',
  'South Africa': 'ZA', 'Egypt': 'EG', 'Nigeria': 'NG',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadCheckpoint() {
  fs.mkdirSync('./scrapers/checkpoints', { recursive: true });
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
    }
  } catch {}
  return { offset: 0, totalFound: 0, totalInserted: 0, totalUpdated: 0, totalErrors: 0 };
}

function saveCheckpoint(data) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(data, null, 2));
}

async function querySparql(offset) {
  const countryFilter = COUNTRY_FILTER
    ? `FILTER(CONTAINS(?countryLabel, "${COUNTRY_FILTER}") || ?isoCode = "${COUNTRY_FILTER}")`
    : '';

  // Usa SERVICE wikibase:label con fallback a cualquier idioma para maximizar resultados
  const sparql = `
    SELECT DISTINCT ?stamp ?stampLabel ?countryLabel ?isoCode ?year ?image WHERE {
      ?stamp wdt:P31 wd:Q37930.
      ?stamp wdt:P495 ?country.
      ?country wdt:P297 ?isoCode.
      OPTIONAL { ?stamp wdt:P577 ?date. BIND(YEAR(?date) AS ?year) }
      OPTIONAL { ?stamp wdt:P18 ?image. }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en,es,fr,de,pt,it".
        ?stamp rdfs:label ?stampLabel.
        ?country rdfs:label ?countryLabel.
      }
      ${countryFilter}
    }
    ORDER BY ?isoCode ?year
    LIMIT ${LIMIT_FILTER || QUERY_LIMIT}
    OFFSET ${offset}
  `;

  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(sparql)}&format=json`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'FilateliaPeruana/1.0 (github.com/filatelia; scraper@filatelia.pe)',
      'Accept': 'application/sparql-results+json',
    }
  });

  if (!res.ok) throw new Error(`SPARQL error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.results.bindings;
}

async function sendBatch(stamps) {
  const res = await fetch(`${API_URL}/import-stamp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stamps }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseStamp(item) {
  const nameEn = item.stampLabel?.value || null;
  // Skip si no tiene label o si el label es un Q-ID (Qdigitos)
  if (!nameEn || /^Q\d+$/.test(nameEn)) return null;

  const countryLabel = item.countryLabel?.value || '';
  const isoCode = item.isoCode?.value || COUNTRY_MAP[countryLabel] || null;
  const year = item.year?.value ? parseInt(item.year.value) : null;
  const imageUrl = item.image?.value || null;

  // Generar IDs semipermanentes
  const countrySlug = isoCode?.toLowerCase() || 'xx';
  const yearStr = year || 'unknown';
  const nameSlug = nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
  const wnsNumber = `WD-${countrySlug.toUpperCase()}-${yearStr}-${nameSlug}`;

  return {
    wnsNumber,
    nameEn,
    nameEs: nameEn, // Wikidata devuelve el label en español si disponible
    countryCode: isoCode,
    year,
    imageUrl,
    groupTitleEs: `${isoCode || 'XX'} — Emisiones ${year || 'Sin Año'}`,
    catalogName: `${countryLabel || 'País Desconocido'} (Wikidata)`,
    source: 'wikidata',
    sourceUrl: `https://www.wikidata.org/wiki/${item.stamp?.value?.split('/').pop()}`,
  };
}

async function main() {
  const checkpoint = loadCheckpoint();
  console.log(`\n📚 Wikidata Scraper iniciado`);
  console.log(`   Filtro país: ${COUNTRY_FILTER || 'todos'}`);
  console.log(`   Reanudando desde offset: ${checkpoint.offset}`);
  console.log(`   Insertados hasta ahora: ${checkpoint.totalInserted}\n`);

  let hasMore = true;
  let batch = [];

  while (hasMore) {
    try {
      process.stdout.write(`🔍 Consultando SPARQL (offset ${checkpoint.offset})... `);
      const results = await querySparql(checkpoint.offset);
      console.log(`${results.length} resultados`);

      if (results.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of results) {
        const stamp = parseStamp(item);
        if (!stamp) continue;
        checkpoint.totalFound++;
        batch.push(stamp);

        if (batch.length >= BATCH_SIZE) {
          try {
            const r = await sendBatch(batch);
            checkpoint.totalInserted += r.inserted || 0;
            checkpoint.totalUpdated += r.updated || 0;
            if (r.errors?.length) checkpoint.totalErrors += r.errors.length;
            process.stdout.write(`  ✅ Enviado lote: +${r.inserted} nuevos, +${r.updated} actualizados\n`);
          } catch (e) {
            checkpoint.totalErrors++;
            console.error(`  ❌ Error al enviar lote: ${e.message}`);
          }
          batch = [];
          saveCheckpoint(checkpoint);
        }
      }

      // Enviar remainder
      if (batch.length > 0) {
        const r = await sendBatch(batch);
        checkpoint.totalInserted += r.inserted || 0;
        checkpoint.totalUpdated += r.updated || 0;
        batch = [];
      }

      checkpoint.offset += results.length;
      saveCheckpoint(checkpoint);

      if (LIMIT_FILTER) { hasMore = false; break; }
      if (results.length < QUERY_LIMIT) { hasMore = false; break; }

      await sleep(DELAY_MS);

    } catch (e) {
      console.error(`\n❌ Error: ${e.message}`);
      checkpoint.totalErrors++;
      saveCheckpoint(checkpoint);
      await sleep(5000);
    }
  }

  console.log(`\n✅ Wikidata Scraper completado!`);
  console.log(`   Total encontrados: ${checkpoint.totalFound}`);
  console.log(`   Total insertados:  ${checkpoint.totalInserted}`);
  console.log(`   Total actualizados: ${checkpoint.totalUpdated}`);
  console.log(`   Total errores:     ${checkpoint.totalErrors}`);
}

main().catch(console.error);
