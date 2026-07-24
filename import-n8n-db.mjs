import initSqlJs from 'sql.js';
import { readFileSync, existsSync } from 'fs';
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

console.log('📊 Checking existing workflows...');
const existingWorkflows = db.exec("SELECT name FROM workflow_entity");
const existingNames = existingWorkflows.length > 0
  ? existingWorkflows[0].values.map(v => v[0])
  : [];
console.log('   Existing:', existingNames.length, 'workflows');

let imported = 0;
for (const file of workflowFiles) {
  const filePath = join(WORKFLOWS_DIR, file);
  console.log(`\n📄 Processing: ${file}`);

  if (!existsSync(filePath)) {
    console.log(`   ⚠️  File not found, skipping`);
    continue;
  }

  const workflowData = JSON.parse(readFileSync(filePath, 'utf-8'));

  if (existingNames.includes(workflowData.name)) {
    console.log(`   ⚠️  Workflow "${workflowData.name}" already exists, skipping`);
    continue;
  }

  // Insert workflow into N8N database
  const nodes = JSON.stringify(workflowData.nodes || []);
  const connections = JSON.stringify(workflowData.connections || {});
  const workflowJson = JSON.stringify(workflowData);
  const now = Math.floor(Date.now() / 1000);

  db.run(`
    INSERT INTO workflow_entity
    (name, active, nodes, connections, "createdAt", "updatedAt", "workflowData")
    VALUES (?, ?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), ?)
  `, [workflowData.name, 0, nodes, connections, now, now, workflowJson]);

  console.log(`   ✓ Imported "${workflowData.name}"`);
  imported++;
}

// Save the database back to disk
console.log('\n💾 Saving database...');
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(N8N_DB_PATH, buffer);

db.close();
console.log(`\n✅ Import complete! ${imported} workflows imported.`);
console.log('🌐 Go to http://localhost:5678 to see the workflows');
