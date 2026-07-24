/**
 * SCRAPER — Wikimedia Commons → Cloudflare R2
 * ============================================
 * Busca imágenes en Wikimedia Commons y las sube a R2 via el Worker.
 * Actualiza imageUrl / imageThumbUrl en D1.
 *
 * USO:
 *   node scrapers/fetch-wikimedia.mjs
 *   node scrapers/fetch-wikimedia.mjs --country=PE --limit=200
 *   node scrapers/fetch-wikimedia.mjs --dry-run
 */

import fs from 'fs';

const API_URL        = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const WIKIMEDIA_API  = 'https://commons.wikimedia.org/w/api.php';
const CHECKPOINT     = './scrapers/checkpoints/wikimedia.json';
const DELAY_MS       = 1000;
const PAGE_SIZE      = 20;

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v || true])
);
const COUNTRY = args.country || null;
const LIMIT   = args.limit ? parseInt(args.limit) : 2000;
const DRY_RUN = args['dry-run'] === true;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadCheckpoint() {
  fs.mkdirSync('./scrapers/checkpoints', { recursive: true });
  try { if (fs.existsSync(CHECKPOINT)) return JSON.parse(fs.readFileSync(CHECKPOINT, 'utf-8')); } catch {}
  return { offset: 0, uploaded: 0, skipped: 0, errors: 0 };
}
function saveCheckpoint(cp) { fs.writeFileSync(CHECKPOINT, JSON.stringify(cp, null, 2)); }

// Obtener sellos sin imageUrl desde D1 (via Worker /query)
async function fetchStampsWithoutImage(offset, limit) {
  const cond = COUNTRY ? 'WHERE (imageUrl IS NULL OR imageUrl = "") AND countryCode = ?' : 'WHERE (imageUrl IS NULL OR imageUrl = "")';
  const params = COUNTRY ? [COUNTRY, limit, offset] : [limit, offset];
  const sql = `SELECT id, wnsNumber, nameEs, nameEn, countryCode, year FROM Stamp ${cond} ORDER BY year ASC LIMIT ? OFFSET ?`;

  const res = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  if (!res.ok) throw new Error(`/query ${res.status}`);
  return (await res.json()).results || [];
}

// Buscar imagen en Wikimedia Commons
async function searchWikimediaImage(query) {
  const params = new URLSearchParams({
    action: 'query', list: 'search', format: 'json', origin: '*',
    srsearch: `postage stamp ${query} filetype:bitmap`,
    srnamespace: '6', srlimit: '3',
  });
  const res = await fetch(`${WIKIMEDIA_API}?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const hits = data?.query?.search || [];
  if (!hits.length) return null;
  return getImageInfo(hits[0].title);
}

// Obtener URL directa de archivo en Wikimedia
async function getImageInfo(fileName) {
  const params = new URLSearchParams({
    action: 'query', titles: fileName, prop: 'imageinfo', format: 'json', origin: '*',
    iiprop: 'url|size|mime', iiurlwidth: '600',
  });
  const res = await fetch(`${WIKIMEDIA_API}?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  const pages = data?.query?.pages || {};
  const info = Object.values(pages)[0]?.imageinfo?.[0];
  if (!info?.url) return null;
  return { original: info.url, thumb: info.thumburl || info.url, mime: info.mime };
}

// Subir imagen a R2 — Wikimedia es abierto, el Worker puede fetchear directamente
async function uploadToR2(key, imageUrl, bucket = 'images') {
  const res = await fetch(`${API_URL}/upload-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, url: imageUrl, bucket }),
  });
  if (!res.ok) throw new Error(`upload-image ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data.url;
}

// Actualizar imageUrl en D1
async function updateStampImage(stampId, imageUrl, thumbUrl) {
  const sql = `UPDATE Stamp SET imageUrl = ?, imageThumbUrl = ?, updatedAt = datetime('now') WHERE id = ?`;
  const res = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params: [imageUrl, thumbUrl || imageUrl, stampId] }),
  });
  if (!res.ok) throw new Error(`update imageUrl ${res.status}`);
}

async function main() {
  const cp = loadCheckpoint();
  console.log(`\n🖼️  Wikimedia → R2 Image Uploader`);
  console.log(`   País:       ${COUNTRY || 'todos'}`);
  console.log(`   Límite:     ${LIMIT}`);
  console.log(`   Dry run:    ${DRY_RUN}`);
  console.log(`   Subidas ya: ${cp.uploaded}\n`);

  let processed = 0;

  while (processed < LIMIT) {
    const batch = Math.min(PAGE_SIZE, LIMIT - processed);
    const stamps = await fetchStampsWithoutImage(cp.offset, batch);

    if (!stamps.length) { console.log('\n✅ No hay más sellos sin imagen.'); break; }

    for (const stamp of stamps) {
      const query = `${stamp.nameEn || stamp.nameEs || ''} ${stamp.countryCode || ''} ${stamp.year || ''}`.trim();
      process.stdout.write(`  🔍 [${stamp.countryCode}/${stamp.year}] ${query.slice(0, 40)}... `);

      try {
        const imgInfo = await searchWikimediaImage(query);
        if (!imgInfo) { console.log('sin imagen'); cp.skipped++; processed++; cp.offset++; continue; }

        if (DRY_RUN) {
          console.log(`[DRY] → ${imgInfo.original.slice(0, 60)}`);
        } else {
          const ext  = (imgInfo.mime || 'image/jpeg').split('/')[1]?.replace('jpeg','jpg') || 'jpg';
          const key  = `${stamp.id}.${ext}`;
          const tkey = `${stamp.id}-thumb.${ext}`;

          const r2Url      = await uploadToR2(key, imgInfo.original, 'images');
          const r2ThumbUrl = imgInfo.thumb !== imgInfo.original
            ? await uploadToR2(tkey, imgInfo.thumb, 'thumbs')
            : r2Url;

          await updateStampImage(stamp.id, r2Url, r2ThumbUrl);
          console.log(`✅ R2 → ${r2Url.split('/').pop()}`);
          cp.uploaded++;
        }

        processed++;
        cp.offset++;
        await sleep(DELAY_MS);
      } catch (e) {
        console.error(`❌ ${e.message}`);
        cp.errors++;
        processed++;
        cp.offset++;
        await sleep(2000);
      }
    }

    saveCheckpoint(cp);
  }

  console.log(`\n✅ Completado — subidas: ${cp.uploaded}, saltadas: ${cp.skipped}, errores: ${cp.errors}`);
}

main().catch(console.error);
