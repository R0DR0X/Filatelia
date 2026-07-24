import { readFileSync } from 'fs';
import { join } from 'path';

const N8N_URL = 'http://76.13.224.112:5678';
const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiYzcyYzRmZi1mYjc3LTQyNzAtODg2MC00NWViYTI2MWIyYTgiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiZTBjNDQ4M2ItNjkzOS00ZjYyLWE5ZWItNjQ4NWI4N2Y4MzcwIiwiaWF0IjoxNzc3OTM5MTE0fQ.R7p0_UoZ9jecefKrlKH1AE-FG_UCB-u2dffvBh6ITus';

const workflowFiles = [
  '00-orquestador-principal.json',
  '01-enriquecedor-nocturno.json',
  '02-detector-duplicados.json',
  '03-monitor-precios-raros.json'
];

const WORKFLOWS_DIR = 'G:\\rodri\\filatelia\\n8n-workflows';

console.log('🚀 Importing workflows to VPS n8n...');
console.log(`🌐 URL: ${N8N_URL}\n`);

for (const file of workflowFiles) {
  const filePath = join(WORKFLOWS_DIR, file);
  console.log(`📄 Processing: ${file}`);

  try {
    const workflowData = JSON.parse(readFileSync(filePath, 'utf-8'));

    const response = await fetch(`${N8N_URL}/api/v1/workflows`, {
      method: 'POST',
      headers: {
        'X-N8N-API-KEY': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: workflowData.name,
        nodes: workflowData.nodes || [],
        connections: workflowData.connections || {},
        settings: workflowData.settings || {},
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`  ✗ Error importing "${workflowData.name}": ${response.status} ${errorText}`);
    } else {
      const result = await response.json();
      console.log(`  ✓ Imported "${workflowData.name}" (ID: ${result.id})`);
    }
  } catch (err) {
    console.error(`  ✗ Exception processing ${file}:`, err.message);
  }
}

console.log('\n✅ Import complete!');
console.log(`🌐 Go to ${N8N_URL} to see the workflows`);
