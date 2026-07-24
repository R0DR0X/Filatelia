import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tshatwvvkworsogjfjyj.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRzaGF0d3Z2a3dvc3NvZ2pmanlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDY1NDAxNzcsImV4cCI6MjA2MjExNjE3N30.o3K1F9yCCQKVZSmXqoGcGxZqyP6vPcGRIdC1G_6yQ'; // Anon key from status

const supabase = createClient(supabaseUrl, supabaseKey);

// Check connection by querying stamps count
const { data, error } = await supabase
  .from('Stamp')
  .select('count', { count: 'exact' });

if (error) {
  console.error('❌ Error de conexión:', error.message);
} else {
  console.log('✅ Conexión exitosa a Supabase (filatelia):');
  console.log('Total sellos (Stamp):', data.count);

  // Check project name via getProject if possible, but using anon key we can't get project details
  console.log('Project ID: tshatwvvkworsogjfjyj');
  console.log('Supabase URL: https://tshatwvvkworsogjfjyj.supabase.co');
}
