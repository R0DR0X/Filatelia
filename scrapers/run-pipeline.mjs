#!/usr/bin/env node
/**
 * ORQUESTADOR MAESTRO DEL PIPELINE DE SCRAPING
 * ==============================================
 * Gestiona y ejecuta todos los scrapers en el orden correcto.
 *
 * USO RÁPIDO:
 *   node scrapers/run-pipeline.mjs status         → Ver estado actual de la BD
 *   node scrapers/run-pipeline.mjs test           → Test con 50 sellos de Wikidata
 *   node scrapers/run-pipeline.mjs phase1         → Fase 1: Wikidata (gratis, ~80k)
 *   node scrapers/run-pipeline.mjs phase1 --country PE  → Solo Perú
 *   node scrapers/run-pipeline.mjs phase2         → Fase 2: WNS oficial (~122k)
 *   node scrapers/run-pipeline.mjs phase2 --country PE --year 2024
 *   node scrapers/run-pipeline.mjs phase3 --country PE  → Fase 3: Colnect (requiere puppeteer)
 *   node scrapers/run-pipeline.mjs enrich         → Enriquecer con IA
 *   node scrapers/run-pipeline.mjs enrich --country PE --limit 200
 *   node scrapers/run-pipeline.mjs all --country PE  → Todo el pipeline para Perú
 */

import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.FILATELIA_API_URL || 'https://filatelia-api.rodrigopianto2005.workers.dev';

// Parsear comando y args
const [,, command = 'status', ...rest] = process.argv;
const extraArgs = rest.join(' ');

// Colores para la terminal
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function log(msg, color = '') {
  console.log(`${color}${msg}${C.reset}`);
}

async function getStatus() {
  try {
    const res = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `
          SELECT
            (SELECT COUNT(*) FROM Stamp) AS total_stamps,
            (SELECT COUNT(*) FROM Stamp WHERE source = 'wikidata') AS from_wikidata,
            (SELECT COUNT(*) FROM Stamp WHERE source = 'wns') AS from_wns,
            (SELECT COUNT(*) FROM Stamp WHERE source = 'colnect') AS from_colnect,
            (SELECT COUNT(*) FROM Stamp WHERE source = 'scraper') AS from_seed,
            (SELECT COUNT(*) FROM Stamp WHERE descriptionEs IS NOT NULL AND descriptionEs != '') AS with_description,
            (SELECT COUNT(*) FROM Stamp WHERE imageUrl IS NOT NULL) AS with_image,
            (SELECT COUNT(*) FROM Stamp WHERE theme IS NOT NULL) AS with_theme,
            (SELECT COUNT(*) FROM Country) AS total_countries,
            (SELECT COUNT(*) FROM Catalog) AS total_catalogs
        `,
        params: []
      }),
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0] || null;
  } catch {
    return null;
  }
}

async function getTopCountries() {
  try {
    const res = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sql: `SELECT countryCode, COUNT(*) as cnt FROM Stamp GROUP BY countryCode ORDER BY cnt DESC LIMIT 10`,
        params: []
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

function runScript(scriptPath, args = '') {
  return new Promise((resolve, reject) => {
    const cmd = `node ${scriptPath} ${args}`;
    log(`\n🚀 Ejecutando: ${cmd}`, C.cyan);
    
    const child = spawn('node', [scriptPath, ...args.split(' ').filter(Boolean)], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Script terminó con código ${code}`));
    });

    child.on('error', reject);
  });
}

async function showStatus() {
  log('\n╔══════════════════════════════════════════════════════╗', C.cyan);
  log('║        ESTADO DEL PIPELINE DE SCRAPING FILATELIA     ║', C.bold + C.cyan);
  log('╚══════════════════════════════════════════════════════╝\n', C.cyan);

  log('📡 Verificando conexión con API...', C.dim);
  const stats = await getStatus();

  if (!stats) {
    log('❌ No se puede conectar con el API. Verifica que esté desplegado.', C.red);
    log(`   URL: ${API_URL}`, C.dim);
    return;
  }

  log('✅ Conexión establecida con D1\n', C.green);

  log('📊 ESTADÍSTICAS DE LA BASE DE DATOS:', C.bold);
  log('─────────────────────────────────────');
  log(`   Total sellos:           ${C.bold}${stats.total_stamps.toLocaleString()}${C.reset}`);
  log(`   Con descripción IA:     ${stats.with_description.toLocaleString()} (${Math.round(stats.with_description/Math.max(stats.total_stamps,1)*100)}%)`);
  log(`   Con imagen:             ${stats.with_image.toLocaleString()}`);
  log(`   Con temática:           ${stats.with_theme.toLocaleString()}`);
  log(`   Total países:           ${stats.total_countries}`);
  log(`   Total catálogos:        ${stats.total_catalogs}`);
  log('');
  log('📦 FUENTES DE DATOS:', C.bold);
  log('─────────────────────────────────────');
  log(`   🌐 Wikidata:            ${C.yellow}${stats.from_wikidata.toLocaleString()}${C.reset} sellos`);
  log(`   📮 WNS (Oficial):       ${C.yellow}${stats.from_wns.toLocaleString()}${C.reset} sellos`);
  log(`   🔍 Colnect:             ${C.yellow}${stats.from_colnect.toLocaleString()}${C.reset} sellos`);
  log(`   🌱 Semilla inicial:     ${C.yellow}${stats.from_seed.toLocaleString()}${C.reset} sellos`);

  const countries = await getTopCountries();
  if (countries.length > 0) {
    log('\n🌍 TOP 10 PAÍSES:', C.bold);
    log('─────────────────────────────────────');
    countries.forEach((c, i) => {
      const bar = '█'.repeat(Math.floor(c.cnt / Math.max(countries[0].cnt, 1) * 20));
      log(`   ${String(i + 1).padStart(2)}. ${c.countryCode || '??'}  ${bar} ${c.cnt.toLocaleString()}`);
    });
  }

  log('\n🗺️  PLAN DE SCRAPING:', C.bold);
  log('─────────────────────────────────────');
  
  const phase1Done = stats.from_wikidata > 0;
  const phase2Done = stats.from_wns > 0;
  const phase3Done = stats.from_colnect > 0;
  const enrichDone = stats.with_description > 100;

  log(`   ${phase1Done ? '✅' : '⬜'} FASE 1: Wikidata    → ~80,000 sellos históricos (GRATIS)`);
  log(`   ${phase2Done ? '✅' : '⬜'} FASE 2: WNS         → ~122,000 sellos modernos (GRATIS)`);
  log(`   ${phase3Done ? '✅' : '⬜'} FASE 3: Colnect     → ~1,200,000 sellos (requiere puppeteer)`);
  log(`   ${enrichDone ? '✅' : '⬜'} ENRICH: IA          → Descripciones, tags, rareza`);

  log('\n💡 COMANDOS DISPONIBLES:', C.bold);
  log('─────────────────────────────────────');
  log('   node scrapers/run-pipeline.mjs test                → Prueba rápida (50 sellos)');
  log('   node scrapers/run-pipeline.mjs phase1              → Extraer de Wikidata');
  log('   node scrapers/run-pipeline.mjs phase1 --country PE → Solo sellos de Perú');
  log('   node scrapers/run-pipeline.mjs phase2 --country PE → WNS solo Perú');
  log('   node scrapers/run-pipeline.mjs phase3 --country PE → Colnect Perú (puppeteer)');
  log('   node scrapers/run-pipeline.mjs enrich --limit 100  → Enriquecer 100 sellos');
  log('   node scrapers/run-pipeline.mjs all --country PE    → Todo para Perú');
  log('');
}

async function runPhase1(args) {
  log('\n📚 FASE 1: Extrayendo de Wikidata SPARQL...', C.cyan);
  log('   Fuente: https://query.wikidata.org/sparql', C.dim);
  log('   Cobertura: ~80,000 sellos históricos', C.dim);
  log('   Costo: GRATIS (no requiere nada especial)\n', C.dim);
  await runScript('scrapers/01-wikidata-scraper.mjs', args);
}

async function runPhase2(args) {
  log('\n📮 FASE 2: Extrayendo de WNS (Oficial)...', C.cyan);
  log('   Fuente: https://www.wnsstamps.post', C.dim);
  log('   Cobertura: ~122,000 sellos modernos (2002-presente)', C.dim);
  log('   Costo: GRATIS (respetando rate limits)\n', C.dim);
  await runScript('scrapers/02-wns-scraper.mjs', args);
}

async function runPhase3(args) {
  log('\n🔍 FASE 3: Extrayendo de Colnect...', C.cyan);
  log('   Fuente: https://colnect.com', C.dim);
  log('   Cobertura: ~1,200,000 sellos con números Scott/Michel', C.dim);
  log('   Requiere: npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth\n', C.dim);
  
  // Verificar puppeteer
  try {
    execSync('node -e "require(\'puppeteer-extra\')"', { stdio: 'pipe', cwd: path.join(__dirname, '..') });
  } catch {
    log('⚠️  Puppeteer no instalado. Instalando...', C.yellow);
    execSync('npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  }
  
  await runScript('scrapers/03-colnect-scraper.mjs', args);
}

async function runEnrich(args) {
  log('\n🤖 ENRIQUECIMIENTO IA con OpenRouter...', C.cyan);
  log('   Modelo: google/gemma-3-27b-it:free (GRATIS)', C.dim);
  log('   Genera: Descripciones, tags, rareza, temática\n', C.dim);
  await runScript('scrapers/04-ai-enricher.mjs', args);
}

async function runMirrorImages(args) {
  log('\n📦 ESPEJANDO IMÁGENES → Cloudflare R2...', C.cyan);
  log('   Copia imágenes externas (WNS, Wikimedia) a R2', C.dim);
  log('   Actualiza imageUrl en D1 con URL de R2\n', C.dim);
  await runScript('scrapers/mirror-images.mjs', args);
}

async function runWikimediaImages(args) {
  log('\n🖼️  BUSCANDO IMÁGENES EN WIKIMEDIA COMMONS → R2...', C.cyan);
  log('   Para sellos sin imagen: busca en Wikimedia y sube a R2\n', C.dim);
  await runScript('scrapers/fetch-wikimedia.mjs', args);
}

async function runAll(args) {
  log('\n🚀 PIPELINE COMPLETO DE SCRAPING', C.bold + C.cyan);
  log('═══════════════════════════════════\n');
  
  await runPhase1(args);
  await runPhase2(args);
  // Phase 3 es opcional - skip si no hay puppeteer
  try {
    await runPhase3(args);
  } catch {
    log('\n⚠️  Fase 3 (Colnect) omitida. Continuar con enriquecimiento IA...', C.yellow);
  }
  await runEnrich(args);
  
  log('\n✅ Pipeline completo finalizado!', C.green);
  await showStatus();
}

// Router de comandos
switch (command) {
  case 'status':
    await showStatus();
    break;
  case 'test':
    await runPhase1('--limit 50');
    break;
  case 'phase1':
    await runPhase1(extraArgs);
    break;
  case 'phase2':
    await runPhase2(extraArgs);
    break;
  case 'phase3':
    await runPhase3(extraArgs);
    break;
  case 'enrich':
    await runEnrich(extraArgs);
    break;
  case 'mirror':
    await runMirrorImages(extraArgs);
    break;
  case 'images':
    await runWikimediaImages(extraArgs);
    break;
  case 'all':
    await runAll(extraArgs);
    break;
  default:
    log(`❌ Comando desconocido: ${command}`, C.red);
    log('   Usa: status, test, phase1, phase2, phase3, enrich, mirror, images, all', C.dim);
}
