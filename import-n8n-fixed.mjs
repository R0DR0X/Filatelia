import initSqlJs from 'sql.js';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

const N8N_DB_PATH = 'C:\\Users\\rodri\\.n8n\\database.sqlite';
const WORKFLOWS_DIR = 'G:\\rodri\\filatelia\\n8n-workflows';

const workflowFiles = [
  '00-orquestador-principal.json',
  '01-enriquecedor-nocturno.json',
  '02-detector-duplicados.json',
  '03-monitor-precios-raros.json'
];

console.log('📦 Loading sql.js...');
const SQL = await initSqlJs();

if (!existsSync(N8N_DB_PATH)) {
  console.error('❌ N8N database not found at:', N8N_DB_PATH);
  process.exit(1);
}

console.log('📂 Reading N8N database...');
const dbBuffer = readFileSync(N8N_DB_PATH);
const db = new SQL.Database(dbBuffer);

// Check existing workflows
console.log('📊 Checking existing workflows...');
const existingResult = db.exec("SELECT id, name FROM workflow_entity");
const existingWorkflows = existingResult.length > 0
  ? new Map(existingResult[0].values.map(v => [v[1], v[0]]))
  : new Map();
console.log(`   Found ${existingWorkflows.size} existing workflows:`);
for (const [name, id] of existingWorkflows) {
  console.log(`   - ${name} (${id})`);
}

let imported = 0;
let skipped = 0;

for (const file of workflowFiles) {
  const filePath = join(WORKFLOWS_DIR, file);
  console.log(`\n📄 Processing: ${file}`);

  if (!existsSync(filePath)) {
    console.log(`   ⚠️  File not found, skipping`);
    skipped++;
    continue;
  }

  const workflowData = JSON.parse(readFileSync(filePath, 'utf-8'));

  if (existingWorkflows.has(workflowData.name)) {
    console.log(`   ⚠️  Workflow "${workflowData.name}" already exists, skipping`);
    skipped++;
    continue;
  }

  // Generate UUID for workflow
  const workflowId = crypto.randomUUID ? crypto.randomUUID() :
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });

  const now = new Date().toISOString().slice(0, 23);

  // Insert workflow with correct column names
  db.run(`
    INSERT INTO workflow_entity
    (id, name, active, nodes, connections, settings, staticData, pinData, "createdAt", "updatedAt", versionId, triggerCount, meta, parentFolderId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    workflowId,
    workflowData.name,
    0, // active = false
    JSON.stringify(workflowData.nodes || []),
    JSON.stringify(workflowData.connections || {}),
    JSON.stringify(workflowData.settings || {}),
    JSON.stringify(workflowData.staticData || null),
    JSON.stringify(workflowData.pinData || null),
    now,
    now,
    workflowData.versionId || null,
    workflowData.triggerCount || 0,
    JSON.stringify(workflowData.meta || null),
    workflowData.parentFolderId || null
  ]);

  console.log(`   ✓ Imported "${workflowData.name}" (ID: ${workflowId})`);
  imported++;
}

// Save database
console.log('\n💾 Saving database...');
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(N8N_DB_PATH, buffer);

db.close();
console.log(`\n✅ Import complete! ${imported} workflows imported, ${skipped} skipped.`);
console.log('🌐 Go to http://localhost:5678 to see the workflows');
