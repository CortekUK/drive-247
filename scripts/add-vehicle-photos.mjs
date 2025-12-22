import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Image URLs from Unsplash (free to use)
const vehicleImages = {
  'Toyota': {
    'Corolla': 'https://images.unsplash.com/photo-1623869675781-80aa31012a5a?fm=jpg&q=80&w=800',
  },
  'Honda': {
    'Civic': 'https://images.unsplash.com/photo-1594070319944-7c0cbebb6f58?fm=jpg&q=80&w=800',
  },
  'Ford': {
    'Focus': 'https://images.unsplash.com/photo-1551206820-1a2050e76dd7?fm=jpg&q=80&w=800',
  },
  'BMW': {
    '3 Series': 'https://images.unsplash.com/photo-1523983388277-336a66bf9bcd?fm=jpg&q=80&w=800',
  },
  'Mercedes': {
    'A-Class': 'https://images.unsplash.com/photo-1649566606451-3c0506f0f499?fm=jpg&q=80&w=800',
  },
};

async function main() {
  console.log('Adding vehicle photos to vehicle_photos table...\n');

  // Get all vehicles that we seeded (the ones matching our makes/models)
  const makes = Object.keys(vehicleImages);

  for (const make of makes) {
    const models = Object.keys(vehicleImages[make]);

    for (const model of models) {
      const photoUrl = vehicleImages[make][model];

      console.log(`Processing ${make} ${model}...`);

      // Get all vehicles matching this make/model
      const { data: vehicles, error: fetchError } = await supabase
        .from('vehicles')
        .select('id, reg, tenant_id')
        .eq('make', make)
        .eq('model', model);

      if (fetchError) {
        console.error(`  Error fetching vehicles: ${fetchError.message}`);
        continue;
      }

      if (!vehicles || vehicles.length === 0) {
        console.log(`  No vehicles found`);
        continue;
      }

      console.log(`  Found ${vehicles.length} vehicle(s)`);

      for (const vehicle of vehicles) {
        // Check if photo already exists for this vehicle
        const { data: existingPhotos } = await supabase
          .from('vehicle_photos')
          .select('id')
          .eq('vehicle_id', vehicle.id);

        if (existingPhotos && existingPhotos.length > 0) {
          console.log(`    - ${vehicle.reg}: Photo already exists, skipping`);
          continue;
        }

        // Insert photo
        const { error: insertError } = await supabase
          .from('vehicle_photos')
          .insert({
            vehicle_id: vehicle.id,
            tenant_id: vehicle.tenant_id,
            photo_url: photoUrl,
            display_order: 1,
          });

        if (insertError) {
          console.error(`    - ${vehicle.reg}: Error inserting photo: ${insertError.message}`);
        } else {
          console.log(`    - ${vehicle.reg}: Photo added successfully`);
        }
      }
    }
  }

  console.log('\nVehicle photos added!');
}

main();
