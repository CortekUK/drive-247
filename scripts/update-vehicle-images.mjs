import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Image URLs from Unsplash (free to use)
const vehicleImages = {
  'Toyota Corolla': 'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?fm=jpg&q=80&w=800',
  'Honda Civic': 'https://images.unsplash.com/photo-1594070319944-7c0cbebb6f58?fm=jpg&q=80&w=800',
  'Ford Focus': 'https://images.unsplash.com/photo-1551206820-1a2050e76dd7?fm=jpg&q=80&w=800',
  'BMW 3 Series': 'https://images.unsplash.com/photo-1523983388277-336a66bf9bcd?fm=jpg&q=80&w=800',
  'Mercedes A-Class': 'https://images.unsplash.com/photo-1649566606451-3c0506f0f499?fm=jpg&q=80&w=800',
};

async function main() {
  console.log('Updating vehicle images...\n');

  for (const [vehicleName, imageUrl] of Object.entries(vehicleImages)) {
    const [make, ...modelParts] = vehicleName.split(' ');
    const model = modelParts.join(' ');

    console.log(`Updating ${make} ${model}...`);

    const { data, error } = await supabase
      .from('vehicles')
      .update({ photo_url: imageUrl })
      .eq('make', make)
      .eq('model', model)
      .select('id, reg, make, model');

    if (error) {
      console.error(`  Error: ${error.message}`);
    } else {
      console.log(`  Updated ${data.length} vehicle(s)`);
      data.forEach(v => console.log(`    - ${v.reg}: ${v.make} ${v.model}`));
    }
  }

  console.log('\nImage update complete!');
}

main();
