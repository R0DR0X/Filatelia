import http from 'http';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { URL } from 'url';

const PORT = 3000;
const CHECKPOINTS_DIR = './scrapers/checkpoints';

const COLNECT_COUNTRIES = [
  { code: 'PE', name: 'Peru' },
  { code: 'AR', name: 'Argentina' },
  { code: 'CL', name: 'Chile' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
  { code: 'CO', name: 'Colombia' },
  { code: 'US', name: 'United States' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'CN', name: 'China' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
  { code: 'IL', name: 'Israel' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'PY', name: 'Paraguay' },
];

// Helper para ejecutar comandos del sistema
function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      resolve(stdout ? stdout.trim() : '');
    });
  });
}

// Verificar si un proceso de scraper de país específico está activo
async function isScraperRunning(countryCode) {
  const output = await runCmd(`ps aux | grep -F "03-colnect-scraper.mjs --country=${countryCode}" | grep -v grep`);
  return output.length > 0;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Servir el HTML del Dashboard
  if (req.method === 'GET' && pathname === '/') {
    try {
      const html = fs.readFileSync('./scrapers/dashboard.html', 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Internal Server Error: ${e.message}`);
    }
    return;
  }

  // GET /api/status - Retorna el listado de scrapers y sus checkpoints
  if (req.method === 'GET' && pathname === '/api/status') {
    const list = [];
    for (const country of COLNECT_COUNTRIES) {
      const isRunning = await isScraperRunning(country.code);
      const checkpointPath = path.join(CHECKPOINTS_DIR, `colnect_${country.code}.json`);
      
      let checkpoint = { page: 1, totalFound: 0, totalInserted: 0, totalErrors: 0 };
      if (fs.existsSync(checkpointPath)) {
        try {
          checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
        } catch (e) {}
      }

      list.push({
        code: country.code,
        name: country.name,
        status: isRunning ? 'running' : 'stopped',
        page: checkpoint.page || 1,
        totalFound: checkpoint.totalFound || 0,
        totalInserted: checkpoint.totalInserted || 0,
        totalErrors: checkpoint.totalErrors || 0,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ scrapers: list }));
    return;
  }

  // POST /api/start - Lanza el scraper para un país en segundo plano
  if (req.method === 'POST' && pathname === '/api/start') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { country } = JSON.parse(body);
        if (!country || !COLNECT_COUNTRIES.some(c => c.code === country)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Código de país inválido' }));
          return;
        }

        const isRunning = await isScraperRunning(country);
        if (isRunning) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El scraper ya está corriendo' }));
          return;
        }

        // Crear carpeta de checkpoints si no existe
        if (!fs.existsSync(CHECKPOINTS_DIR)) {
          fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
        }

        // Lanzar scraper Node en segundo plano desviando salida al log
        const logFile = path.join(CHECKPOINTS_DIR, `colnect_${country}.log`);
        const cmd = `nohup node scrapers/03-colnect-scraper.mjs --country=${country} > ${logFile} 2>&1 &`;
        
        exec(cmd, (err) => {
          if (err) console.error(`Error iniciando scraper para ${country}:`, err);
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /api/stop - Detiene el scraper de un país específico
  if (req.method === 'POST' && pathname === '/api/stop') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { country } = JSON.parse(body);
        if (!country) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Código de país requerido' }));
          return;
        }

        // Matar el proceso de forma selectiva
        const cmd = `pkill -f "03-colnect-scraper.mjs --country=${country}" || true`;
        await runCmd(cmd);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /api/logs - Retorna los logs recientes de un país
  if (req.method === 'GET' && pathname === '/api/logs') {
    const country = parsedUrl.searchParams.get('country');
    if (!country) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falta código de país' }));
      return;
    }

    const logFile = path.join(CHECKPOINTS_DIR, `colnect_${country}.log`);
    let logContent = 'Sin registros. Presioná iniciar para lanzar el scraper.';

    if (fs.existsSync(logFile)) {
      try {
        const stats = fs.statSync(logFile);
        const bufferSize = Math.min(stats.size, 15000); // Leer últimos 15KB
        if (bufferSize > 0) {
          const fd = fs.openSync(logFile, 'r');
          const buffer = Buffer.alloc(bufferSize);
          fs.readSync(fd, buffer, 0, bufferSize, stats.size - bufferSize);
          fs.closeSync(fd);
          logContent = buffer.toString('utf-8');
        }
      } catch (e) {
        logContent = `Error leyendo logs: ${e.message}`;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logContent }));
    return;
  }

  // 404 No encontrado
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`🚀 Dashboard de Control de Scrapers corriendo en http://localhost:${PORT}`);
});
