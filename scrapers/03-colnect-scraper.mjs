/**
 * SCRAPER 03 - Colnect (El Más Completo)
 * ========================================
 * Extrae catálogos de https://colnect.com/es/stamps
 * Cobertura: ~1,200,000 sellos con números Scott, Michel, Yvert y precios.
 *
 * REQUISITOS:
 *   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth
 *
 * USO:
 *   node scrapers/03-colnect-scraper.mjs --country PE
 *   node scrapers/03-colnect-scraper.mjs --country PE --year 1980
 *   node scrapers/03-colnect-scraper.mjs --url "https://colnect.com/es/stamps/list/country/4966-Peru"
 *
 * ESTRATEGIA ANTIBOT:
 *   - Puppeteer con stealth mode (evita detección de bot)
 *   - User-agent real rotatorio
 *   - Delays aleatorios entre 5-15 segundos (comportamiento humano)
 *   - Movimientos de mouse simulados
 *   - No usar proxy por defecto (añadir si hay bloqueos)
 */

import fs from 'fs';
import { requireAdminToken, adminTokenHeader } from './lib/admin-token.mjs';

const ADMIN_TOKEN = requireAdminToken();

const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';
const BATCH_SIZE = 20;
const DELAY_MIN = 12000; // 12 segundos mínimo
const DELAY_MAX = 28000; // 28 segundos máximo

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('='))
    .map(([k, v]) => [k, v || true])
);

// URLs de países en Colnect (los más importantes para la plataforma)
const COLNECT_COUNTRIES = {
  'PE': { id: '169', name: 'Peru' },
  'AR': { id: '10', name: 'Argentina' },
  'CL': { id: '43', name: 'Chile' },
  'BR': { id: '30', name: 'Brazil' },
  'MX': { id: '139', name: 'Mexico' },
  'CO': { id: '47', name: 'Colombia' },
  'US': { id: '225', name: 'United_States_of_America' },
  'GB': { id: '224', name: 'United_Kingdom_of_Great_Britain_Northern_Ireland' },
  'FR': { id: '74', name: 'France' },
  'DE': { id: '81', name: 'Germany_Federal_Republic' },
  'ES': { id: '199', name: 'Spain' },
  'IT': { id: '106', name: 'Italy' },
  'JP': { id: '108', name: 'Japan' },
  'CN': { id: '442', name: 'China' },
  'AU': { id: '13', name: 'Australia' },
  'CA': { id: '38', name: 'Canada' },
  'IL': { id: '105', name: 'Israel' },
  'UY': { id: '227', name: 'Uruguay' },
  'VE': { id: '230', name: 'Venezuela' },
  'BO': { id: '26', name: 'Bolivia' },
  'EC': { id: '63', name: 'Ecuador' },
  'PY': { id: '168', name: 'Paraguay' },
};

const COUNTRY_TO_SCRAPE = args.country || 'PE';
const CUSTOM_URL = args.url || null;
const countryData = COLNECT_COUNTRIES[COUNTRY_TO_SCRAPE];
const CHECKPOINT_FILE = `./scrapers/checkpoints/colnect_${COUNTRY_TO_SCRAPE}.json`;

// User agents reales para rotación
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randomDelay() { return sleep(DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN)); }
function randomUserAgent() { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

async function getProxyList() {
  try {
    const res = await fetch('https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all');
    if (!res.ok) return [];
    const text = await res.text();
    return text.split('\n').map(p => p.trim()).filter(p => p.length > 0);
  } catch (e) {
    console.error('  ⚠️ Error obteniendo lista de proxies:', e.message);
    return [];
  }
}

async function launchBrowser(puppeteer, proxy) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-web-security',
  ];
  if (proxy) {
    args.push(`--proxy-server=http://${proxy}`);
    console.log(`🔌 Iniciando navegador con proxy: http://${proxy}`);
  } else {
    console.log(`🔌 Iniciando navegador con IP Local`);
  }
  return await puppeteer.launch({
    headless: 'new',
    args,
    defaultViewport: null,
  });
}

function loadCheckpoint() {
  fs.mkdirSync('./scrapers/checkpoints', { recursive: true });
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf-8'));
  } catch {}
  return { page: 1, totalFound: 0, totalInserted: 0, totalUpdated: 0, totalErrors: 0, processed_urls: [] };
}

function saveCheckpoint(cp) {
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

async function sendBatch(stamps) {
  const res = await fetch(`${API_URL}/import-stamp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...adminTokenHeader(ADMIN_TOKEN) },
    body: JSON.stringify({ stamps }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function scrapeColnectPage(page, browser, url) {
  const pageObj = await browser.newPage();

  try {
    await pageObj.setViewport({ width: 1280 + Math.floor(Math.random() * 200), height: 800 + Math.floor(Math.random() * 200) });

    console.log(`  📄 Cargando: ${url}`);
    await pageObj.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Esperar a que carguen los elementos (resolviendo reto Anubis)
    console.log("  ⏳ Esperando a que carguen los sellos (reto antibot)...");
    await pageObj.waitForSelector('div.pl-it', { timeout: 20000 });

    // Simular comportamiento humano - scroll lento
    await pageObj.evaluate(() => {
      return new Promise(resolve => {
        let y = 0;
        const timer = setInterval(() => {
          window.scrollBy(0, 100 + Math.random() * 100);
          y += 150;
          if (y > document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 200);
      });
    });

    await sleep(2000);

    // Extraer stamps de la página de lista de Colnect
    const stamps = await pageObj.evaluate((countryCode) => {
      const results = [];
      const items = document.querySelectorAll('div.pl-it');
      
      items.forEach(item => {
        try {
          const link = item.querySelector('h2.item_header a');
          if (!link) return;
          
          const sourceUrl = link.href || '';
          const name = link.innerText.trim();
          
          let series = '';
          let catalogCodesText = '';
          let themes = [];
          let colors = '';
          let designers = '';
          let denominationText = '';
          let description = '';
          
          const dts = item.querySelectorAll('dt');
          dts.forEach(dt => {
            const label = dt.innerText.trim().toLowerCase();
            const dd = dt.nextElementSibling;
            if (!dd) return;
            
            if (label.includes('series:')) {
              series = dd.innerText.trim();
            } else if (label.includes('catalog codes:')) {
              catalogCodesText = dd.innerText.trim();
            } else if (label.includes('themes:')) {
              themes = Array.from(dd.querySelectorAll('a')).map(a => a.innerText.trim());
            } else if (label.includes('colors:')) {
              colors = dd.innerText.trim();
            } else if (label.includes('designers:')) {
              designers = dd.innerText.trim();
            } else if (label.includes('face value:')) {
              denominationText = dd.innerText.trim();
            } else if (label.includes('description:')) {
              description = dd.innerText.trim();
            }
          });
          
          const img = item.querySelector('div.item_thumb img');
          const imageUrl = img ? (img.src || img.dataset.src || null) : null;
          
          // Parse Year from series or title
          let year = null;
          const yearMatch = (series + ' ' + name).match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);
          if (yearMatch) {
            year = parseInt(yearMatch[1]);
          }
          
          // Parse Catalog Numbers
          const snMatch = catalogCodesText.match(/Sn:([A-Za-z0-9\s#\-+]+)(,|$)/);
          const scottNumber = snMatch ? snMatch[1].trim() : null;

          const miMatch = catalogCodesText.match(/Mi:([A-Za-z0-9\s#\-+]+)(,|$)/);
          const michelNumber = miMatch ? miMatch[1].trim() : null;

          const ytMatch = catalogCodesText.match(/Yt:([A-Za-z0-9\s#\-+]+)(,|$)/);
          const yvertNumber = ytMatch ? ytMatch[1].trim() : null;

          // Parse Denomination
          let denomination = null;
          if (denominationText) {
            const match = denominationText.match(/^([\d.,]+)/);
            if (match) {
              denomination = parseFloat(match[1].replace(',', '.'));
            }
          }
          
          if (name.length > 3) {
            results.push({
              nameEn: name,
              nameEs: name,
              countryCode,
              year,
              denomination,
              imageUrl,
              scottNumber,
              michelNumber,
              yvertNumber,
              source: 'colnect',
              sourceUrl,
              theme: themes.join(', ') || null,
              color: colors || null,
              descriptionEs: description || null,
            });
          }
        } catch (e) {}
      });
      
      return results.filter(s => s.nameEn && s.nameEn.length > 3);
    }, COUNTRY_TO_SCRAPE);

    // Buscar enlace a la siguiente página (ej. data-page="2")
    const nextPageUrl = await pageObj.evaluate((nextPageNum) => {
      const next = document.querySelector(`a.pager_page[data-page="${nextPageNum}"]`);
      return next?.href || null;
    }, page + 1);

    await pageObj.close();
    return { stamps, nextPageUrl };

  } catch (e) {
    await pageObj.close();
    throw e;
  }
}

async function scrapeStampDetail(pageObj, url) {
  // Extraer detalles completos de la página individual de un sello
  try {
    await pageObj.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(1500);

    return await pageObj.evaluate(() => {
      const info = {};
      
      // Extraer tabla de info de Colnect
      document.querySelectorAll('table.item_info_table tr, .stamp_details tr, .info_table tr').forEach(row => {
        const label = row.querySelector('td.label, th')?.innerText?.trim()?.toLowerCase() || '';
        const value = row.querySelector('td.value, td:last-child')?.innerText?.trim() || '';
        if (label && value) info[label] = value;
      });

      // Extraer imagen de alta calidad
      const mainImg = document.querySelector('.stamp_image img, #item_image img, .main-image img');
      const backImg = document.querySelector('.stamp_back img, #back_image img');
      
      return {
        scottNumber: info['scott'] || info['scott #'] || info['número scott'] || null,
        michelNumber: info['michel'] || info['michel #'] || null,
        yvertNumber: info['yvert'] || info['yvert & tellier'] || null,
        color: info['color'] || info['colours'] || info['colores'] || null,
        perforation: info['perforación'] || info['perforation'] || info['perf.'] || null,
        printTechnique: info['técnica de impresión'] || info['printing technique'] || null,
        paperType: info['papel'] || info['paper'] || null,
        printer: info['imprenta'] || info['printer'] || null,
        designer: info['diseñador'] || info['designer'] || null,
        printRun: info['tirada'] || info['print run'] ? parseInt((info['tirada'] || info['print run']).replace(/\D/g, '')) : null,
        conditionMintUsd: info['nuevo (sin fijasellos)'] ? parseFloat(info['nuevo (sin fijasellos)'].replace(/[^\d.]/g, '')) : null,
        conditionUsedUsd: info['usado'] ? parseFloat(info['usado'].replace(/[^\d.]/g, '')) : null,
        theme: info['tema'] || info['topic'] || info['subject'] || null,
        imageUrl: mainImg?.src || null,
        imageBackUrl: backImg?.src || null,
        descriptionEs: document.querySelector('.item_description, .description')?.innerText?.trim() || null,
      };
    });
  } catch (e) {
    return {};
  }
}

async function main() {
  console.log(`\n🔍 Colnect Scraper iniciado`);
  console.log(`   País: ${COUNTRY_TO_SCRAPE} (${countryData?.name || 'Custom URL'})`);
  console.log(`   Requiere: puppeteer y puppeteer-extra instalados\n`);

  // Verificar que puppeteer esté instalado
  let puppeteer, StealthPlugin;
  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const stealth = await import('puppeteer-extra-plugin-stealth');
    puppeteer = puppeteerExtra.default;
    StealthPlugin = stealth.default;
    puppeteer.use(StealthPlugin());
  } catch (e) {
    console.error(`❌ Puppeteer no encontrado. Instalar con:`);
    console.error(`   npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth`);
    process.exit(1);
  }

  const cp = loadCheckpoint();
  console.log(`📍 Reanudando desde página ${cp.page}, insertados: ${cp.totalInserted}`);

  let proxyList = await getProxyList();
  console.log(`📡 Pool de proxies cargado: ${proxyList.length} proxies disponibles`);
  
  let currentProxy = null;
  if (proxyList.length > 0) {
    currentProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
  }

  let browser = await launchBrowser(puppeteer, currentProxy);
  let batch = [];

  try {
    // Construir URL base de Colnect
    let startUrl = CUSTOM_URL;
    if (!startUrl && countryData) {
      startUrl = `https://colnect.com/en/stamps/list/country/${countryData.id}-${countryData.name}`;
    }
    if (!startUrl) {
      console.error('❌ Especifica --country o --url');
      await browser.close();
      return;
    }

    // Navegar hasta la página del checkpoint
    let currentUrl = startUrl;
    if (cp.page > 1) {
      currentUrl = `${startUrl}/page/${cp.page}`;
    }

    let pageNum = cp.page;
    let pagesScrapedInSession = 0;
    let consecutiveErrors = 0;

    while (currentUrl) {
      console.log(`\n📄 Página ${pageNum}: ${currentUrl}`);

      try {
        const { stamps: pageStamps, nextPageUrl } = await scrapeColnectPage(pageNum, browser, currentUrl);
        console.log(`  Encontrados: ${pageStamps.length} sellos`);

        cp.totalFound += pageStamps.length;
        consecutiveErrors = 0; // Reset errors on success
        pagesScrapedInSession++;

        for (const stamp of pageStamps) {
          stamp.groupTitleEs = `${COUNTRY_TO_SCRAPE} — Emisiones ${stamp.year || 'Sin Año'}`;
          stamp.catalogName = `${countryData?.name || COUNTRY_TO_SCRAPE} (Colnect)`;
          batch.push(stamp);

          if (batch.length >= BATCH_SIZE) {
            const r = await sendBatch(batch);
            cp.totalInserted += r.inserted || 0;
            cp.totalUpdated += r.updated || 0;
            console.log(`  📦 Lote enviado: +${r.inserted} nuevos, +${r.updated} actualizados`);
            batch = [];
            saveCheckpoint(cp);
          }
        }

        currentUrl = nextPageUrl;
        cp.page = ++pageNum;
        saveCheckpoint(cp);

        if (!currentUrl) {
          console.log('  ✅ Última página alcanzada');
          break;
        }

        // Si procesamos 5 páginas, tomar descanso largo de 2.5 minutos
        if (pagesScrapedInSession % 5 === 0) {
          console.log(`  ⏳ [Evasión de bloqueo] Tomando descanso preventivo de 2.5 minutos para enfriar IP...`);
          await sleep(150000);
        } else {
          await randomDelay();
        }

      } catch (e) {
        consecutiveErrors++;
        console.error(`  ❌ Error en página ${pageNum} con proxy ${currentProxy || 'IP Local'} (intento ${consecutiveErrors}/15): ${e.message}`);
        cp.totalErrors++;
        saveCheckpoint(cp);

        if (consecutiveErrors >= 15) {
          console.error(`  ⚠️ Demasiados errores consecutivos (15/15). Esperando 45 segundos para refrescar pool de proxies...`);
          await sleep(45000);
          try {
            proxyList = await getProxyList();
          } catch {}
          consecutiveErrors = 0;
        }

        console.log(`  🔄 Rotando proxy para reintentar la página ${pageNum}...`);
        try {
          await browser.close();
        } catch {}

        if (proxyList.length < 5) {
          proxyList = await getProxyList();
        }

        if (proxyList.length > 0) {
          currentProxy = proxyList[Math.floor(Math.random() * proxyList.length)];
        } else {
          currentProxy = null;
        }

        browser = await launchBrowser(puppeteer, currentProxy);
        await sleep(5000);
      }
    }

  } finally {
    // Enviar batch sobrante
    if (batch.length > 0) {
      try {
        const r = await sendBatch(batch);
        cp.totalInserted += r.inserted || 0;
      } catch (e) {
        console.error('Error enviando batch final:', e.message);
      }
    }

    saveCheckpoint(cp);
    try {
      await browser.close();
    } catch {}
  }

  console.log(`\n✅ Colnect Scraper completado!`);
  console.log(`   Total encontrados:  ${cp.totalFound}`);
  console.log(`   Total insertados:   ${cp.totalInserted}`);
  console.log(`   Total actualizados: ${cp.totalUpdated}`);
  console.log(`   Total errores:      ${cp.totalErrors}`);
}

main().catch(console.error);
