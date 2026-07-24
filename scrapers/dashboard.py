#!/usr/bin/env python3
import asyncio
import json
import os
import subprocess
import requests
from flask import Flask, jsonify, render_template_string, request

app = Flask(__name__)

VM_IP = "34.31.70.3"
VM_USER = "rodrigo"
API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev/query"

# Helper to run SSH command on VM
def run_ssh(cmd):
    ssh_cmd = ["ssh", "-o", "StrictHostKeyChecking=no", f"{VM_USER}@{VM_IP}", cmd]
    try:
        res = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=15)
        return {
            "success": res.returncode == 0,
            "stdout": res.stdout,
            "stderr": res.stderr
        }
    except Exception as e:
        return {"success": False, "stdout": "", "stderr": str(e)}

# Helper to query D1
def run_d1_query(sql, params=[]):
    try:
        res = requests.post(API_URL, json={"sql": sql, "params": params}, timeout=15)
        if res.status_code == 200:
            return res.json().get("results", [])
    except Exception as e:
        print(f"D1 Query Error: {e}")
    return []

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Filatelia - VM & Scraper Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-dark: #0f172a;
            --panel-bg: rgba(30, 41, 59, 0.7);
            --border-color: rgba(255, 255, 255, 0.08);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent-primary: #38bdf8;
            --accent-success: #4ade80;
            --accent-danger: #f87171;
            --accent-warning: #fbbf24;
            --card-glow: rgba(56, 189, 248, 0.03);
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Plus Jakarta Sans', sans-serif;
        }

        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            padding: 2rem;
            background-image: radial-gradient(circle at 10% 20%, rgba(56, 189, 248, 0.05) 0%, transparent 40%),
                              radial-gradient(circle at 90% 80%, rgba(74, 222, 128, 0.03) 0%, transparent 40%);
            background-attachment: fixed;
        }

        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2.5rem;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1.5rem;
        }

        .logo-section h1 {
            font-size: 1.75rem;
            font-weight: 700;
            letter-spacing: -0.5px;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .logo-section p {
            color: var(--text-muted);
            font-size: 0.875rem;
            margin-top: 0.25rem;
        }

        .vm-status-badge {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 99px;
            padding: 0.5rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.875rem;
            font-weight: 500;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background-color: var(--accent-success);
            box-shadow: 0 0 10px var(--accent-success);
        }

        .status-dot.offline {
            background-color: var(--accent-danger);
            box-shadow: 0 0 10px var(--accent-danger);
        }

        .grid-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2.5rem;
        }

        .card {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 16px;
            padding: 1.5rem;
            backdrop-filter: blur(12px);
            transition: all 0.3s ease;
            box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            min-height: 140px;
        }

        .card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: radial-gradient(circle at top right, var(--card-glow), transparent 60%);
            pointer-events: none;
        }

        .card:hover {
            transform: translateY(-2px);
            border-color: rgba(56, 189, 248, 0.2);
        }

        .card-title {
            color: var(--text-muted);
            font-size: 0.875rem;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 0.5rem;
        }

        .card-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-main);
        }

        .card-sub {
            font-size: 0.75rem;
            color: var(--text-muted);
            margin-top: 0.5rem;
        }

        .progress-container {
            width: 100%;
            height: 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 99px;
            margin-top: 0.75rem;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            border-radius: 99px;
            width: 0%;
            transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
        }

        #fill-metadata {
            background: linear-gradient(to right, #38bdf8, #818cf8);
        }

        #fill-images {
            background: linear-gradient(to right, #4ade80, #22c55e);
        }

        .main-layout {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            flex-grow: 1;
        }

        @media (max-width: 1024px) {
            .main-layout {
                grid-template-columns: 1fr;
            }
        }

        .panel {
            background: var(--panel-bg);
            border: 1px solid var(--border-color);
            border-radius: 20px;
            padding: 2rem;
            backdrop-filter: blur(12px);
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        }

        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border-color);
            padding-bottom: 1rem;
        }

        .panel-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-main);
        }

        .service-list {
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }

        .service-row {
            background: rgba(15, 23, 42, 0.5);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1.25rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: all 0.2s ease;
        }

        .service-row:hover {
            border-color: rgba(255, 255, 255, 0.15);
        }

        .service-info h3 {
            font-size: 1rem;
            font-weight: 600;
            color: var(--text-main);
        }

        .service-info p {
            font-size: 0.8125rem;
            color: var(--text-muted);
            margin-top: 0.25rem;
        }

        .service-controls {
            display: flex;
            gap: 0.75rem;
            align-items: center;
        }

        .btn {
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
            outline: none;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .btn-primary {
            background-color: var(--accent-primary);
            color: #000;
        }

        .btn-primary:hover {
            background-color: #7dd3fc;
            transform: translateY(-1px);
        }

        .btn-danger {
            background-color: rgba(248, 113, 113, 0.15);
            color: var(--accent-danger);
            border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .btn-danger:hover {
            background-color: rgba(248, 113, 113, 0.25);
            transform: translateY(-1px);
        }

        .btn-success {
            background-color: rgba(74, 222, 128, 0.15);
            color: var(--accent-success);
            border: 1px solid rgba(74, 222, 128, 0.3);
        }

        .btn-success:hover {
            background-color: rgba(74, 222, 128, 0.25);
            transform: translateY(-1px);
        }

        .btn-secondary {
            background-color: rgba(255, 255, 255, 0.05);
            color: var(--text-main);
            border: 1px solid var(--border-color);
        }

        .btn-secondary:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }

        .badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.625rem;
            border-radius: 99px;
            font-weight: 600;
            text-transform: uppercase;
        }

        .badge-running {
            background: rgba(74, 222, 128, 0.15);
            color: var(--accent-success);
            border: 1px solid rgba(74, 222, 128, 0.3);
        }

        .badge-stopped {
            background: rgba(248, 113, 113, 0.15);
            color: var(--accent-danger);
            border: 1px solid rgba(248, 113, 113, 0.3);
        }

        .log-section {
            display: flex;
            flex-direction: column;
            flex-grow: 1;
            min-height: 350px;
        }

        .log-selector {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
        }

        .log-tab {
            padding: 0.5rem 1rem;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-muted);
            cursor: pointer;
            background: transparent;
            border: 1px solid transparent;
            transition: all 0.2s ease;
        }

        .log-tab.active {
            color: var(--text-main);
            background: rgba(255, 255, 255, 0.05);
            border-color: var(--border-color);
        }

        .log-viewer {
            flex-grow: 1;
            background: #090d16;
            border: 1px solid var(--border-color);
            border-radius: 12px;
            padding: 1rem;
            font-family: 'Courier New', Courier, monospace;
            font-size: 0.8125rem;
            line-height: 1.5;
            color: #38bdf8;
            overflow-y: auto;
            max-height: 400px;
            white-space: pre-wrap;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.8);
        }
    </style>
</head>
<body>
    <header>
        <div class="logo-section">
            <h1>Filatelia Control Hub</h1>
            <p>Monitoreo y Control de Scrapers en VM</p>
        </div>
        <div class="vm-status-badge">
            <div class="status-dot" id="vm-dot"></div>
            <span id="vm-status-text">VM Conectada ({{ vm_ip }})</span>
        </div>
    </header>

    <div class="grid-stats">
        <div class="card">
            <div>
                <div class="card-title">Descubrimiento Global (Meta 1.6M)</div>
                <div class="card-value" id="stat-discovery-pct">0%</div>
            </div>
            <div>
                <div class="progress-container">
                    <div class="progress-fill" id="fill-discovery" style="background: linear-gradient(to right, #a855f7, #6366f1);"></div>
                </div>
                <div class="card-sub" id="stat-discovery-sub">0 / 1,600,000 importados</div>
            </div>
        </div>
        <div class="card">
            <div>
                <div class="card-title">Progreso Metadata (D1)</div>
                <div class="card-value" id="stat-meta-pct">0%</div>
            </div>
            <div>
                <div class="progress-container">
                    <div class="progress-fill" id="fill-metadata"></div>
                </div>
                <div class="card-sub" id="stat-meta-sub">0 / 0 enriquecidos</div>
            </div>
        </div>
        <div class="card">
            <div>
                <div class="card-title">Progreso Imágenes (D1)</div>
                <div class="card-value" id="stat-img-pct">0%</div>
            </div>
            <div>
                <div class="progress-container">
                    <div class="progress-fill" id="fill-images"></div>
                </div>
                <div class="card-sub" id="stat-img-sub">0 / 0 con imágenes</div>
            </div>
        </div>
        <div class="card">
            <div>
                <div class="card-title">Última Sincronización</div>
                <div class="card-value" style="font-size: 1.5rem; line-height: 2.75rem;" id="stat-updated">Cargando...</div>
            </div>
            <div class="card-sub">Consulta en tiempo real a base D1</div>
        </div>
    </div>

    <div class="main-layout">
        <div class="panel">
            <div class="panel-header">
                <h2 class="panel-title">Procesos del Sistema</h2>
                <button class="btn btn-secondary" onclick="refreshStatus()">🔄 Refrescar</button>
            </div>
            
            <div class="service-list">
                <div class="service-row">
                    <div class="service-info">
                        <h3>Metadata Crawler</h3>
                        <p>Swarm Scraper de detalles físicos. Conexión directa D1.</p>
                        <p id="crawler-pid-label" style="font-size: 0.75rem; color: var(--accent-primary); margin-top: 0.25rem;">PID: -</p>
                    </div>
                    <div class="service-controls">
                        <span class="badge" id="crawler-badge">Cargando...</span>
                        <button class="btn btn-success" id="crawler-start-btn" onclick="controlService('crawler', 'start')">▶</button>
                        <button class="btn btn-danger" id="crawler-stop-btn" onclick="controlService('crawler', 'stop')">■</button>
                    </div>
                </div>

                <div class="service-row">
                    <div class="service-info">
                        <h3>Image Resolver</h3>
                        <p>Resolución y enriquecimiento de imágenes por serie y scraping.</p>
                        <p id="images-pid-label" style="font-size: 0.75rem; color: var(--accent-primary); margin-top: 0.25rem;">PID: -</p>
                    </div>
                    <div class="service-controls">
                        <span class="badge" id="images-badge">Cargando...</span>
                        <button class="btn btn-success" id="images-start-btn" onclick="controlService('images', 'start')">▶</button>
                        <button class="btn btn-danger" id="images-stop-btn" onclick="controlService('images', 'stop')">■</button>
                    </div>
                </div>

                <div class="service-row" style="border-color: rgba(251, 191, 36, 0.2);">
                    <div class="service-info">
                        <h3>Resolución de Anubis Challenge</h3>
                        <p>Ejecuta browser headless vía proxy para actualizar la cookie de sesión.</p>
                    </div>
                    <div class="service-controls">
                        <button class="btn btn-primary" onclick="runSolver()">Ejecutar Solver</button>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel log-section">
            <div class="panel-header">
                <h2 class="panel-title">Salida de Logs</h2>
            </div>
            <div class="log-selector">
                <button class="log-tab active" id="tab-crawler" onclick="switchLog('crawler')">Metadata Crawler</button>
                <button class="log-tab" id="tab-images" onclick="switchLog('images')">Image Resolver</button>
                <button class="log-tab" id="tab-solver" onclick="switchLog('solver')">Anubis Solver</button>
            </div>
            <div class="log-viewer" id="log-console">Cargando logs...</div>
        </div>
    </div>

    <script>
        let currentTab = 'crawler';
        let autoRefreshInterval = null;

        async function fetchStats() {
            try {
                const r = await fetch('/api/stats');
                const data = await r.json();
                if (data.success) {
                    // Global discovery progress
                    document.getElementById('stat-discovery-pct').innerText = `${data.discovery_percentage.toFixed(2)}%`;
                    document.getElementById('fill-discovery').style.width = `${data.discovery_percentage}%`;
                    document.getElementById('stat-discovery-sub').innerText = `${data.total.toLocaleString()} / 1,600,000 importados`;
                    
                    // Meta progress
                    document.getElementById('stat-meta-pct').innerText = `${data.meta_percentage.toFixed(1)}%`;
                    document.getElementById('fill-metadata').style.width = `${data.meta_percentage}%`;
                    document.getElementById('stat-meta-sub').innerText = `${data.meta_enriched.toLocaleString()} / ${data.total.toLocaleString()} enriquecidos`;

                    // Images progress
                    document.getElementById('stat-img-pct').innerText = `${data.img_percentage.toFixed(1)}%`;
                    document.getElementById('fill-images').style.width = `${data.img_percentage}%`;
                    document.getElementById('stat-img-sub').innerText = `${data.img_resolved.toLocaleString()} / ${data.total.toLocaleString()} con imágenes`;

                    document.getElementById('stat-updated').innerText = new Date().toLocaleTimeString();
                }
            } catch (e) {
                console.error("Error fetching stats:", e);
            }
        }

        async function refreshStatus() {
            fetchStats();
            try {
                const r = await fetch('/api/vm/status');
                const data = await r.json();
                
                const vmDot = document.getElementById('vm-dot');
                const vmText = document.getElementById('vm-status-text');
                if (data.vm_online) {
                    vmDot.className = 'status-dot';
                    vmText.innerText = `VM Conectada (${data.vm_ip})`;
                } else {
                    vmDot.className = 'status-dot offline';
                    vmText.innerText = `VM Desconectada`;
                }

                // Update crawler badge & controls
                const cBadge = document.getElementById('crawler-badge');
                const cPidLabel = document.getElementById('crawler-pid-label');
                if (data.crawler.running) {
                    cBadge.className = 'badge badge-running';
                    cBadge.innerText = 'Corriendo';
                    cPidLabel.innerText = `PID: ${data.crawler.pid}`;
                    document.getElementById('crawler-start-btn').disabled = true;
                    document.getElementById('crawler-stop-btn').disabled = false;
                } else {
                    cBadge.className = 'badge badge-stopped';
                    cBadge.innerText = 'Detenido';
                    cPidLabel.innerText = `PID: -`;
                    document.getElementById('crawler-start-btn').disabled = false;
                    document.getElementById('crawler-stop-btn').disabled = true;
                }

                // Update images badge & controls
                const iBadge = document.getElementById('images-badge');
                const iPidLabel = document.getElementById('images-pid-label');
                if (data.images.running) {
                    iBadge.className = 'badge badge-running';
                    iBadge.innerText = 'Corriendo';
                    iPidLabel.innerText = `PID: ${data.images.pid}`;
                    document.getElementById('images-start-btn').disabled = true;
                    document.getElementById('images-stop-btn').disabled = false;
                } else {
                    iBadge.className = 'badge badge-stopped';
                    iBadge.innerText = 'Detenido';
                    iPidLabel.innerText = `PID: -`;
                    document.getElementById('images-start-btn').disabled = false;
                    document.getElementById('images-stop-btn').disabled = true;
                }
            } catch (e) {
                console.error("Error refreshing status:", e);
            }
            fetchLogs();
        }

        async function controlService(service, action) {
            try {
                const r = await fetch('/api/vm/control', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ service, action })
                });
                const res = await r.json();
                alert(res.message);
                setTimeout(refreshStatus, 1000);
            } catch (e) {
                alert("Error al enviar comando: " + e);
            }
        }

        async function runSolver() {
            if (!confirm("¿Deseas ejecutar el Anubis Solver en la VM para renovar la cookie?")) return;
            document.getElementById('log-console').innerText = "Iniciando ejecución del Anubis Solver... Por favor espera.";
            switchLog('solver');
            try {
                const r = await fetch('/api/vm/control', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ service: 'solver', action: 'run' })
                });
                const res = await r.json();
                alert(res.message);
                setTimeout(refreshStatus, 1000);
            } catch (e) {
                alert("Error al ejecutar solver: " + e);
            }
        }

        async function fetchLogs() {
            try {
                const r = await fetch(`/api/vm/logs/${currentTab}`);
                const data = await r.json();
                const consoleEl = document.getElementById('log-console');
                const wasAtBottom = consoleEl.scrollHeight - consoleEl.clientHeight <= consoleEl.scrollTop + 40;
                
                consoleEl.innerText = data.logs || "Sin salida de registros.";
                
                if (wasAtBottom) {
                    consoleEl.scrollTop = consoleEl.scrollHeight;
                }
            } catch (e) {
                console.error("Error fetching logs:", e);
            }
        }

        function switchLog(tab) {
            currentTab = tab;
            document.querySelectorAll('.log-tab').forEach(t => t.classList.remove('active'));
            document.getElementById(`tab-${tab}`).classList.add('active');
            fetchLogs();
        }

        // Init
        refreshStatus();
        // Poll every 3 seconds for real-time updates
        autoRefreshInterval = setInterval(refreshStatus, 3000);
    </script>
</body>
</html>
"""

@app.route('/')
def home():
    return render_template_string(HTML_TEMPLATE, vm_ip=VM_IP)

@app.route('/api/stats')
def stats():
    total_sql = "SELECT COUNT(*) as n FROM Stamp WHERE source = 'colnect'"
    pending_sql = "SELECT COUNT(*) as n FROM Stamp WHERE source = 'colnect' AND perforation IS NULL"
    missing_img_sql = "SELECT COUNT(*) as n FROM Stamp WHERE source = 'colnect' AND (imageUrl LIKE '%none_logged_image%' OR imageUrl IS NULL)"

    res_total = run_d1_query(total_sql)
    res_pending = run_d1_query(pending_sql)
    res_missing = run_d1_query(missing_img_sql)

    total = res_total[0].get("n", 0) if res_total else 0
    pending = res_pending[0].get("n", 0) if res_pending else 0
    missing = res_missing[0].get("n", 0) if res_missing else 0

    meta_enriched = max(0, total - pending)
    img_resolved = max(0, total - missing)

    meta_pct = (meta_enriched / total * 100) if total > 0 else 0
    img_pct = (img_resolved / total * 100) if total > 0 else 0
    
    # Global discovery meta is 1,600,000 stamps
    global_meta = 1600000
    discovery_pct = (total / global_meta * 100) if global_meta > 0 else 0

    return jsonify({
        "success": True,
        "total": total,
        "meta_enriched": meta_enriched,
        "meta_percentage": meta_pct,
        "img_resolved": img_resolved,
        "img_percentage": img_pct,
        "discovery_percentage": discovery_pct
    })


@app.route('/api/vm/status')
def vm_status():
    check_crawler = run_ssh("ps aux | grep colnect_swarm_crawler.py | grep -v grep")
    check_images = run_ssh("ps aux | grep image_resolver.py | grep -v grep")

    crawler_running = False
    crawler_pid = None
    if check_crawler["success"] and check_crawler["stdout"].strip():
        parts = check_crawler["stdout"].split()
        if len(parts) > 1:
            crawler_running = True
            crawler_pid = parts[1]

    images_running = False
    images_pid = None
    if check_images["success"] and check_images["stdout"].strip():
        parts = check_images["stdout"].split()
        if len(parts) > 1:
            images_running = True
            images_pid = parts[1]

    vm_online = run_ssh("echo 1")["success"]

    return jsonify({
        "vm_online": vm_online,
        "vm_ip": VM_IP,
        "crawler": {
            "running": crawler_running,
            "pid": crawler_pid
        },
        "images": {
            "running": images_running,
            "pid": images_pid
        }
    })

@app.route('/api/vm/control', methods=['POST'])
def vm_control():
    data = request.json
    service = data.get("service")
    action = data.get("action")

    if service == "crawler":
        if action == "start":
            cmd = "cd /home/rodrigo/filatelia && PYTHONUNBUFFERED=1 nohup .venv/bin/python -u scrapers/colnect_swarm_crawler.py > logs/crawler.log 2>&1 & echo \$! > logs/crawler.pid"
            res = run_ssh(cmd)
            return jsonify({"success": res["success"], "message": "Metadata Crawler iniciado."})
        elif action == "stop":
            cmd = "kill $(cat /home/rodrigo/filatelia/logs/crawler.pid 2>/dev/null) 2>/dev/null; rm /home/rodrigo/filatelia/logs/crawler.pid 2>/dev/null"
            res = run_ssh(cmd)
            return jsonify({"success": True, "message": "Metadata Crawler detenido."})

    elif service == "images":
        if action == "start":
            cmd = "cd /home/rodrigo/filatelia && PYTHONUNBUFFERED=1 nohup .venv/bin/python -u scrapers/image_resolver.py > logs/images.log 2>&1 & echo \$! > logs/images.pid"
            res = run_ssh(cmd)
            return jsonify({"success": res["success"], "message": "Image Resolver iniciado."})
        elif action == "stop":
            cmd = "kill $(cat /home/rodrigo/filatelia/logs/images.pid 2>/dev/null) 2>/dev/null; rm /home/rodrigo/filatelia/logs/images.pid 2>/dev/null"
            res = run_ssh(cmd)
            return jsonify({"success": True, "message": "Image Resolver detenido."})

    elif service == "solver" and action == "run":
        cmd = "cd /home/rodrigo/filatelia && .venv/bin/python scrapers/vm_solve_anubis.py > logs/solver.log 2>&1"
        res = run_ssh(cmd)
        if res["success"]:
            return jsonify({"success": True, "message": "Anubis Solver ejecutado exitosamente. Cookie de sesión renovada."})
        else:
            return jsonify({"success": False, "message": f"Error al ejecutar Anubis Solver: {res['stderr']}"})

    return jsonify({"success": False, "message": "Acción no reconocida."})

@app.route('/api/vm/logs/<service>')
def vm_logs(service):
    log_file = {
        "crawler": "logs/crawler.log",
        "images": "logs/images.log",
        "solver": "logs/solver.log"
    }.get(service)

    if not log_file:
        return jsonify({"logs": "Log no encontrado."})

    cmd = f"tail -n 150 /home/rodrigo/filatelia/{log_file} 2>/dev/null"
    res = run_ssh(cmd)
    if res["success"]:
        return jsonify({"logs": res["stdout"]})
    else:
        return jsonify({"logs": "El archivo de log aún no contiene datos."})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
