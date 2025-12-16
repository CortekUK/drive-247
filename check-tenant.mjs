import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const { data, error } = await supabase
    .from('tenants')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('\n=== RECENT TENANTS ===');
  data.forEach(t => {
    console.log(`\nID: ${t.id}`);
    console.log(`Company: ${t.company_name}`);
    console.log(`Slug: ${t.slug}`);
    console.log(`Email: ${t.contact_email}`);
    console.log(`Status: ${t.status}`);
    const hasMasterPwd = t.master_password_hash ? 'Yes' : 'No';
    console.log(`Has Master Password: ${hasMasterPwd}`);
  });
}

main();
