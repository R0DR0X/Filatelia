// Install sql.js for pure JavaScript SQLite access
import { execSync } from 'child_process';
try {
  execSync('npm install sql.js', { cwd: 'G:\\rodri\\filatelia', stdio: 'inherit' });
  console.log('✅ sql.js installed');
} catch (e) {
  console.error('❌ Failed to install sql.js:', e.message);
}
