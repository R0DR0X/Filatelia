import { Database } from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';

const N8N_DB_PATH = process.env.HOME + '/.n8n/database.sqlite';
const WORKFLOWS_DIR = 'G:/rodri/filatelia/n8n-workflows';

// Read workflow JSON files
const workflowFiles = [
  '00-orquestador-principal.json',
  '01-enriquecedor-nocturno.json',
  '02-detector-duplicados.json',
  '03-monitor-precios-raros.json'
];

console.log('📦 Installing better-sqlite3...');
// This script needs to be run after installing better-sqlite3

console.log('📂 Reading workflow files...');

try {
  const db = new Database(N8N_DB_PATH);
  console.log('✅ Connected to N8N database');

  // Check existing workflows
  const existing = db.prepare('SELECT COUNT(*) as count FROM workflow_entity').get();
  console.log(`📊 Existing workflows: ${existing.count}`);

  for (const file of workflowFiles) {
    const filePath = join(WORKFLOWS_DIR, file);
    console.log(`\n📄 Processing: ${file}`);

    try {
      const workflowData = JSON.parse(readFileSync(filePath, 'utf-8'));

      // Check if workflow with same name exists
      const existingWf = db.prepare('SELECT id FROM workflow_entity WHERE name = ?').get(workflowData.name);

      if (existingWf) {
        console.log(`  ⚠️  Workflow "${workflowData.name}" already exists, skipping...`);
        continue;
      }

      // Insert workflow
      const insert = db.prepare(`
        INSERT INTO workflow_entity (name, active, nodes, connections, "createdAt", "updatedAt", "workflowData")
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)
      `);

      const result = insert.run(
        workflowData.name,
        false, // active = false initially
        JSON.stringify(workflowData.nodes || []),
        JSON.stringify(workflowData.connections || {}),
        JSON.stringify(workflowData)
      );

      console.log(`  ✓ Workflow "${workflowData.name}" imported (ID: ${result.lastInsertRowid})`);
    } catch (err) {
      console.error(`  ✗ Error importing ${file}:`, err.message);
    }
  }

  db.close();
  console.log('\n✅ Import complete!');
  console.log('🌐 Go to http://localhost:5678 to activate workflows');

} catch (err) {
  console.error('❌ Fatal error:', err.message);
  console.error('\n💡 Make sure to install: npm install -g better-sqlite3');
  process.exit(1);
}
