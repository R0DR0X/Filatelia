import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';

const SQL = await initSqlJs();
const dbBuffer = readFileSync('C:\\Users\\rodri\\.n8n\\database.sqlite');
const db = new SQL.Database(dbBuffer);

console.log('📊 N8N Database Schema:\n');

// Get all tables
const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
if (tables.length > 0) {
  for (const table of tables[0].values) {
    const tableName = table[0];
    console.log(`\n📋 Table: ${tableName}`);
    const schema = db.exec(`PRAGMA table_info(${tableName})`);
    if (schema.length > 0) {
      for (const row of schema[0].values) {
        console.log(`   - ${row[1]} (${row[2]})`);
      }
    }
  }
}

// Check existing workflows
console.log('\n\n📊 Existing workflows:');
const workflows = db.exec("SELECT id, name, active FROM workflow_entity LIMIT 10");
if (workflows.length > 0) {
  for (const row of workflows[0].values) {
    console.log(`   ${row[0]}: ${row[1]} (active: ${row[2]})`);
  }
} else {
  console.log('   No workflows found');
}

db.close();
