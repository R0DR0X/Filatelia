/**
 * SCRAPER 02 — WNS (WADP Numbering System) v2
 * =============================================
 * API correcta: GET /Home/autoStampSearch (requiere session cookie + GUID de miembro)
 * Cobertura: ~123,752 sellos modernos (2002-presente) de 201 países.
 *
 * USO:
 *   node scrapers/02-wns-scraper.mjs                    → todos los países
 *   node scrapers/02-wns-scraper.mjs --country=PE       → solo Perú
 *   node scrapers/02-wns-scraper.mjs --country=PE,AR,CL → varios países
 */

import fs from 'fs';

const API_URL  = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const WNS_BASE = 'https://www.wnsstamps.post';
const CHECKPOINT_FILE = './scrapers/checkpoints/wns.json';
const PAGE_SIZE    = 50;   // Cuántos se piden al WNS por página
const BATCH_SIZE   = 10;   // Cuántos se envían al Worker por lote (evita CPU limit 1102)
const DELAY_MS     = 4000; // 4s entre páginas WNS

// --- Parsear args CLI ---
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v || true])
);
const COUNTRY_FILTER = args.country ? args.country.split(',') : null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- Checkpoint ---
function loadCheckpoint() {
  fs.mkdirSync('./scrapers/checkpoints', { recursive: true });
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  } catch {}
  return { memberIdx: 0, page: 1, totalFound: 0, totalInserted: 0, totalUpdated: 0, totalErrors: 0, completedMembers: [] };
}

function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- Retry helper ---
async function withRetry(fn, retries = 5, baseDelay = 15000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      const delay = baseDelay * Math.pow(1.5, i);
      console.log(`  ⚠️  ${e.message} — reintento ${i + 1}/${retries} en ${Math.round(delay/1000)}s...`);
      await sleep(delay);
    }
  }
}

// --- Obtener session cookie del WNS ---
async function getSession() {
  return withRetry(async () => {
    const res = await fetch(`${WNS_BASE}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Accept': 'text/html' },
      redirect: 'follow',
    });
    const cookies = res.headers.getSetCookie?.()?.join('; ') || res.headers.get('set-cookie') || '';
    if (!cookies) throw new Error('No se pudo obtener la cookie de sesión del WNS');
    return cookies;
  });
}

// --- Obtener lista de miembros (países) con sus GUIDs ---
async function getMembers(cookies) {
  const res = await fetch(`${WNS_BASE}/Home/GetMembers`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 Chrome/124',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookies,
    },
  });
  if (!res.ok) throw new Error(`GetMembers ${res.status}`);
  const members = await res.json();
  return members.map(m => ({ name: m.text, guid: m.value })).sort((a, b) => a.name.localeCompare(b.name));
}

// --- Obtener una página de sellos para un miembro ---
async function fetchPage(memberGuid, pageIndex, cookies) {
  const params = new URLSearchParams({
    member:      memberGuid,
    allMember:   0,
    year:        '',
    allYear:     1,
    ddlmonth:    '',
    allMonth:    1,
    themeId:     '',
    subTheme:    '',
    wNSNumber:   '',
    sorting:     'WNSNumber',
    searchType:  0,
    pageIndex,
    pageSize:    PAGE_SIZE,
    termsFilters: '',
    setw:        '',
    lang:        'en',
    refine:      false,
  });

  return withRetry(async () => {
    const res = await fetch(`${WNS_BASE}/Home/autoStampSearch?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Referer': `${WNS_BASE}/en/Stamps-Search`,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': cookies,
      },
    });
    if (!res.ok) throw new Error(`autoStampSearch ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) throw new Error(`WNS devolvió HTML (bloqueado): ${res.status}`);
    return res.json();
  }, 4, 20000);
}

// --- Mapear un sello WNS al schema de D1 ---
function mapStamp(s, memberName) {
  const year = s.DATE_OF_ISSUE ? new Date(s.DATE_OF_ISSUE).getFullYear() : null;
  const countryCode = s.WNS_NUMBER ? s.WNS_NUMBER.replace(/^([A-Z]{2})\d.*/, '$1') : null;

  return {
    wnsNumber:     s.WNS_NUMBER,
    nameEn:        s.SUBJECT || `${memberName} ${s.WNS_NUMBER}`,
    nameEs:        s.SUBJECT || `${memberName} ${s.WNS_NUMBER}`,
    countryCode:   countryCode || null,
    year,
    issueDate:     s.DATE_OF_ISSUE ? s.DATE_OF_ISSUE.slice(0, 10) : null,
    denomination:  s.DENOMINATION ? parseFloat(s.DENOMINATION) : null,
    currency:      s.CURRENCY || null,
    perforation:   s.PERFORATIONS || null,
    printTechnique: s.PrintingTechnique || null,
    printRun:      s.Quantity ? parseInt(String(s.Quantity).replace(/,/g, '')) : null,
    imageUrl:      s.ImageName ? `${WNS_BASE}/images/T600/${s.ImageName}` : null,
    source:        'wns',
    sourceUrl:     `${WNS_BASE}/en/stamps/${s.WNS_NUMBER}`,
    groupTitleEs:  `${memberName} — Emisiones ${year || 'Sin Año'}`,
    catalogName:   `${memberName} (WNS Oficial)`,
  };
}

// --- Enviar lote al API ---
async function sendBatch(stamps) {
  const res = await fetch(`${API_URL}/import-stamp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stamps }),
  });
  if (!res.ok) throw new Error(`import-stamp ${res.status}: ${await res.text()}`);
  return res.json();
}

// --- Main ---
async function main() {
  const cp = loadCheckpoint();
  console.log(`\n📮 WNS Scraper v2 iniciado`);
  console.log(`   Filtro países: ${COUNTRY_FILTER?.join(', ') || 'todos (201)'}`);
  console.log(`   Insertados antes: ${cp.totalInserted}\n`);

  console.log('🔑 Obteniendo sesión WNS...');
  let cookies = await getSession();

  console.log('🌍 Obteniendo lista de países...');
  let members = await getMembers(cookies);

  // Filtrar por países si se especificó
  if (COUNTRY_FILTER) {
    const filter = COUNTRY_FILTER.map(c => c.toUpperCase());
    // Filtrar por código ISO (primeras 2 letras del WNS number) o nombre aproximado
    members = members.filter(m => {
      const nameUpper = m.name.toUpperCase();
      return filter.some(f => nameUpper.includes(f) || nameUpper.startsWith(f));
    });
    if (!members.length) {
      console.error(`❌ No se encontraron países para: ${COUNTRY_FILTER.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`✅ ${members.length} países a procesar\n`);

  // Reanudar desde el último miembro procesado
  const startIdx = cp.memberIdx || 0;

  for (let mi = startIdx; mi < members.length; mi++) {
    const member = members[mi];

    if (cp.completedMembers?.includes(member.guid)) {
      console.log(`  ⏭️  [${mi + 1}/${members.length}] ${member.name} — ya completado`);
      continue;
    }

    cp.memberIdx = mi;
    console.log(`\n🗺️  [${mi + 1}/${members.length}] ${member.name}`);

    let pageIndex = (mi === startIdx && cp.page > 1) ? cp.page : 1;
    let memberInserted = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        process.stdout.write(`  📄 Página ${pageIndex}... `);

        // Refrescar cookie cada 50 páginas para evitar expiración
        if (pageIndex % 50 === 0) {
          cookies = await getSession();
        }

        const data = await fetchPage(member.guid, pageIndex, cookies);

        if (!Array.isArray(data) || data.length === 0) {
          console.log('0 resultados (fin)');
          hasMore = false;
          break;
        }

        const stamps = data.map(s => mapStamp(s, member.name));
        cp.totalFound += stamps.length;

        // Enviar en sub-lotes de BATCH_SIZE para no exceder CPU limit del Worker
        let pageInserted = 0, pageUpdated = 0;
        for (let bi = 0; bi < stamps.length; bi += BATCH_SIZE) {
          const chunk = stamps.slice(bi, bi + BATCH_SIZE);
          const result = await sendBatch(chunk);
          pageInserted += result.inserted || 0;
          pageUpdated  += result.updated  || 0;
          if (result.errors?.length) cp.totalErrors += result.errors.length;
          if (bi + BATCH_SIZE < stamps.length) await sleep(800);
        }
        memberInserted    += pageInserted;
        cp.totalInserted  += pageInserted;
        cp.totalUpdated   += pageUpdated;

        console.log(`${data.length} sellos → +${pageInserted} nuevos, +${pageUpdated} actualizados`);

        if (data.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          pageIndex++;
          cp.page = pageIndex;
          saveCheckpoint(cp);
          await sleep(DELAY_MS);
        }

      } catch (e) {
        console.error(`\n  ❌ Error: ${e.message}`);
        cp.totalErrors++;
        saveCheckpoint(cp);

        if (e.message.includes('429') || e.message.includes('503')) {
          console.log('  ⏳ Rate limit, esperando 30s...');
          await sleep(30000);
          cookies = await getSession(); // Refrescar sesión
        } else {
          await sleep(5000);
        }
      }
    }

    console.log(`  ✅ ${member.name}: ${memberInserted} sellos nuevos`);
    cp.completedMembers = cp.completedMembers || [];
    cp.completedMembers.push(member.guid);
    cp.page = 1;
    cp.memberIdx = mi + 1;
    saveCheckpoint(cp);

    await sleep(DELAY_MS);
  }

  console.log(`\n✅ WNS Scraper completado!`);
  console.log(`   Total encontrados:  ${cp.totalFound.toLocaleString()}`);
  console.log(`   Total insertados:   ${cp.totalInserted.toLocaleString()}`);
  console.log(`   Total actualizados: ${cp.totalUpdated.toLocaleString()}`);
  console.log(`   Total errores:      ${cp.totalErrors}`);
}

main().catch(console.error);
