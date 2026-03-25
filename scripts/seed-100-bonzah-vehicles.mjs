import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// 100 Bonzah-eligible vehicles (no luxury/excluded brands)
// Excluded: Alfa Romeo, Aston Martin, Bentley, BMW, Bugatti, Ferrari, Jaguar,
// Koenigsegg, Lamborghini, Lotus, Maserati, Maybach, McLaren, Porsche, Rolls Royce, TVR, etc.
const vehicles = [
  // Toyota (15)
  { make: 'Toyota', model: 'Corolla', year: 2024, fuel_type: 'Petrol', colour: 'White', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Toyota', model: 'Camry', year: 2024, fuel_type: 'Hybrid', colour: 'Silver', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },
  { make: 'Toyota', model: 'RAV4', year: 2024, fuel_type: 'Hybrid', colour: 'Blue', daily_rent: 60, weekly_rent: 360, monthly_rent: 1250 },
  { make: 'Toyota', model: 'Highlander', year: 2023, fuel_type: 'Petrol', colour: 'Black', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Toyota', model: 'Prius', year: 2024, fuel_type: 'Hybrid', colour: 'Green', daily_rent: 42, weekly_rent: 252, monthly_rent: 880 },
  { make: 'Toyota', model: 'Yaris', year: 2023, fuel_type: 'Petrol', colour: 'Red', daily_rent: 35, weekly_rent: 210, monthly_rent: 730 },
  { make: 'Toyota', model: 'C-HR', year: 2024, fuel_type: 'Hybrid', colour: 'Grey', daily_rent: 50, weekly_rent: 300, monthly_rent: 1050 },
  { make: 'Toyota', model: 'Tacoma', year: 2024, fuel_type: 'Petrol', colour: 'White', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Toyota', model: 'Supra', year: 2024, fuel_type: 'Petrol', colour: 'Yellow', daily_rent: 95, weekly_rent: 570, monthly_rent: 1950 },
  { make: 'Toyota', model: '4Runner', year: 2024, fuel_type: 'Petrol', colour: 'Army Green', daily_rent: 75, weekly_rent: 450, monthly_rent: 1550 },
  { make: 'Toyota', model: 'Avalon', year: 2023, fuel_type: 'Hybrid', colour: 'Pearl White', daily_rent: 60, weekly_rent: 360, monthly_rent: 1250 },
  { make: 'Toyota', model: 'GR86', year: 2024, fuel_type: 'Petrol', colour: 'Neptune Blue', daily_rent: 80, weekly_rent: 480, monthly_rent: 1650 },
  { make: 'Toyota', model: 'Corolla Cross', year: 2024, fuel_type: 'Hybrid', colour: 'Celestite Grey', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Toyota', model: 'Tundra', year: 2024, fuel_type: 'Hybrid', colour: 'Midnight Black', daily_rent: 85, weekly_rent: 510, monthly_rent: 1750 },
  { make: 'Toyota', model: 'Venza', year: 2023, fuel_type: 'Hybrid', colour: 'Ruby Red', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },

  // Honda (12)
  { make: 'Honda', model: 'Civic', year: 2024, fuel_type: 'Petrol', colour: 'Black', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Honda', model: 'Accord', year: 2024, fuel_type: 'Hybrid', colour: 'Silver', daily_rent: 58, weekly_rent: 348, monthly_rent: 1200 },
  { make: 'Honda', model: 'CR-V', year: 2024, fuel_type: 'Hybrid', colour: 'White', daily_rent: 62, weekly_rent: 372, monthly_rent: 1300 },
  { make: 'Honda', model: 'HR-V', year: 2024, fuel_type: 'Petrol', colour: 'Blue', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Honda', model: 'Pilot', year: 2024, fuel_type: 'Petrol', colour: 'Grey', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Honda', model: 'Passport', year: 2023, fuel_type: 'Petrol', colour: 'Red', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Honda', model: 'Civic Type R', year: 2024, fuel_type: 'Petrol', colour: 'Championship White', daily_rent: 90, weekly_rent: 540, monthly_rent: 1850 },
  { make: 'Honda', model: 'Ridgeline', year: 2024, fuel_type: 'Petrol', colour: 'Sonic Grey', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Honda', model: 'Fit', year: 2023, fuel_type: 'Petrol', colour: 'Orange', daily_rent: 32, weekly_rent: 192, monthly_rent: 670 },
  { make: 'Honda', model: 'Insight', year: 2023, fuel_type: 'Hybrid', colour: 'Platinum White', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Honda', model: 'Odyssey', year: 2024, fuel_type: 'Petrol', colour: 'Obsidian Blue', daily_rent: 68, weekly_rent: 408, monthly_rent: 1400 },
  { make: 'Honda', model: 'ZR-V', year: 2024, fuel_type: 'Hybrid', colour: 'Nordic Forest', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },

  // Ford (10)
  { make: 'Ford', model: 'Focus', year: 2023, fuel_type: 'Diesel', colour: 'Blue', daily_rent: 40, weekly_rent: 240, monthly_rent: 850 },
  { make: 'Ford', model: 'Mustang', year: 2024, fuel_type: 'Petrol', colour: 'Race Red', daily_rent: 90, weekly_rent: 540, monthly_rent: 1850 },
  { make: 'Ford', model: 'Explorer', year: 2024, fuel_type: 'Petrol', colour: 'Black', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Ford', model: 'Escape', year: 2024, fuel_type: 'Hybrid', colour: 'Iconic Silver', daily_rent: 52, weekly_rent: 312, monthly_rent: 1100 },
  { make: 'Ford', model: 'Bronco', year: 2024, fuel_type: 'Petrol', colour: 'Cactus Grey', daily_rent: 80, weekly_rent: 480, monthly_rent: 1650 },
  { make: 'Ford', model: 'Maverick', year: 2024, fuel_type: 'Hybrid', colour: 'Area 51 Blue', daily_rent: 50, weekly_rent: 300, monthly_rent: 1050 },
  { make: 'Ford', model: 'F-150', year: 2024, fuel_type: 'Petrol', colour: 'Oxford White', daily_rent: 85, weekly_rent: 510, monthly_rent: 1750 },
  { make: 'Ford', model: 'Edge', year: 2023, fuel_type: 'Petrol', colour: 'Agate Black', daily_rent: 58, weekly_rent: 348, monthly_rent: 1200 },
  { make: 'Ford', model: 'Ranger', year: 2024, fuel_type: 'Diesel', colour: 'Carbonized Grey', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Ford', model: 'Puma', year: 2024, fuel_type: 'Hybrid', colour: 'Vivid Ruby', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },

  // Hyundai (10)
  { make: 'Hyundai', model: 'Elantra', year: 2024, fuel_type: 'Petrol', colour: 'White', daily_rent: 42, weekly_rent: 252, monthly_rent: 880 },
  { make: 'Hyundai', model: 'Tucson', year: 2024, fuel_type: 'Hybrid', colour: 'Grey', daily_rent: 58, weekly_rent: 348, monthly_rent: 1200 },
  { make: 'Hyundai', model: 'Santa Fe', year: 2024, fuel_type: 'Hybrid', colour: 'Black', daily_rent: 68, weekly_rent: 408, monthly_rent: 1400 },
  { make: 'Hyundai', model: 'Kona', year: 2024, fuel_type: 'Electric', colour: 'Cyber Grey', daily_rent: 50, weekly_rent: 300, monthly_rent: 1050 },
  { make: 'Hyundai', model: 'Sonata', year: 2024, fuel_type: 'Hybrid', colour: 'Shimmering Silver', daily_rent: 52, weekly_rent: 312, monthly_rent: 1100 },
  { make: 'Hyundai', model: 'Ioniq 5', year: 2024, fuel_type: 'Electric', colour: 'Lucid Blue', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Hyundai', model: 'Ioniq 6', year: 2024, fuel_type: 'Electric', colour: 'Biophilic Blue', daily_rent: 75, weekly_rent: 450, monthly_rent: 1550 },
  { make: 'Hyundai', model: 'Palisade', year: 2024, fuel_type: 'Petrol', colour: 'Moonlight Cloud', daily_rent: 78, weekly_rent: 468, monthly_rent: 1600 },
  { make: 'Hyundai', model: 'Venue', year: 2024, fuel_type: 'Petrol', colour: 'Intense Blue', daily_rent: 35, weekly_rent: 210, monthly_rent: 730 },
  { make: 'Hyundai', model: 'i20', year: 2023, fuel_type: 'Petrol', colour: 'Dragon Red', daily_rent: 30, weekly_rent: 180, monthly_rent: 630 },

  // Kia (8)
  { make: 'Kia', model: 'Sportage', year: 2024, fuel_type: 'Hybrid', colour: 'Snow White', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },
  { make: 'Kia', model: 'Seltos', year: 2024, fuel_type: 'Petrol', colour: 'Gravity Grey', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Kia', model: 'EV6', year: 2024, fuel_type: 'Electric', colour: 'Yacht Blue', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Kia', model: 'Sorento', year: 2024, fuel_type: 'Hybrid', colour: 'Ebony Black', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Kia', model: 'Forte', year: 2024, fuel_type: 'Petrol', colour: 'Currant Red', daily_rent: 40, weekly_rent: 240, monthly_rent: 850 },
  { make: 'Kia', model: 'Telluride', year: 2024, fuel_type: 'Petrol', colour: 'Glacial White', daily_rent: 78, weekly_rent: 468, monthly_rent: 1600 },
  { make: 'Kia', model: 'Niro', year: 2024, fuel_type: 'Hybrid', colour: 'Snow White', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Kia', model: 'Carnival', year: 2024, fuel_type: 'Petrol', colour: 'Astra Blue', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },

  // Volkswagen (8)
  { make: 'Volkswagen', model: 'Golf', year: 2024, fuel_type: 'Petrol', colour: 'Atlantic Blue', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Volkswagen', model: 'Tiguan', year: 2024, fuel_type: 'Diesel', colour: 'Pure White', daily_rent: 58, weekly_rent: 348, monthly_rent: 1200 },
  { make: 'Volkswagen', model: 'Passat', year: 2024, fuel_type: 'Diesel', colour: 'Moonstone Grey', daily_rent: 52, weekly_rent: 312, monthly_rent: 1100 },
  { make: 'Volkswagen', model: 'ID.4', year: 2024, fuel_type: 'Electric', colour: 'Dusk Blue', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Volkswagen', model: 'Jetta', year: 2024, fuel_type: 'Petrol', colour: 'Oryx White', daily_rent: 42, weekly_rent: 252, monthly_rent: 880 },
  { make: 'Volkswagen', model: 'Taos', year: 2024, fuel_type: 'Petrol', colour: 'Cornflower Blue', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Volkswagen', model: 'Atlas', year: 2024, fuel_type: 'Petrol', colour: 'Deep Black', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Volkswagen', model: 'Polo', year: 2023, fuel_type: 'Petrol', colour: 'Reef Blue', daily_rent: 35, weekly_rent: 210, monthly_rent: 730 },

  // Nissan (8)
  { make: 'Nissan', model: 'Altima', year: 2024, fuel_type: 'Petrol', colour: 'Gun Metallic', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Nissan', model: 'Rogue', year: 2024, fuel_type: 'Petrol', colour: 'Super Black', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },
  { make: 'Nissan', model: 'Sentra', year: 2024, fuel_type: 'Petrol', colour: 'Brilliant Silver', daily_rent: 38, weekly_rent: 228, monthly_rent: 800 },
  { make: 'Nissan', model: 'Pathfinder', year: 2024, fuel_type: 'Petrol', colour: 'Pearl White', daily_rent: 68, weekly_rent: 408, monthly_rent: 1400 },
  { make: 'Nissan', model: 'Leaf', year: 2024, fuel_type: 'Electric', colour: 'Jade Frost', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Nissan', model: 'Ariya', year: 2024, fuel_type: 'Electric', colour: 'Aurora Green', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Nissan', model: 'Frontier', year: 2024, fuel_type: 'Petrol', colour: 'Tactical Green', daily_rent: 62, weekly_rent: 372, monthly_rent: 1300 },
  { make: 'Nissan', model: 'Kicks', year: 2024, fuel_type: 'Petrol', colour: 'Electric Blue', daily_rent: 38, weekly_rent: 228, monthly_rent: 800 },

  // Mazda (6)
  { make: 'Mazda', model: 'CX-5', year: 2024, fuel_type: 'Petrol', colour: 'Soul Red', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },
  { make: 'Mazda', model: 'Mazda3', year: 2024, fuel_type: 'Petrol', colour: 'Machine Grey', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Mazda', model: 'CX-30', year: 2024, fuel_type: 'Petrol', colour: 'Zircon Sand', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Mazda', model: 'CX-50', year: 2024, fuel_type: 'Petrol', colour: 'Ingot Blue', daily_rent: 60, weekly_rent: 360, monthly_rent: 1250 },
  { make: 'Mazda', model: 'CX-90', year: 2024, fuel_type: 'Hybrid', colour: 'Rhodium White', daily_rent: 78, weekly_rent: 468, monthly_rent: 1600 },
  { make: 'Mazda', model: 'MX-5 Miata', year: 2024, fuel_type: 'Petrol', colour: 'Snowflake White', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },

  // Subaru (5)
  { make: 'Subaru', model: 'Outback', year: 2024, fuel_type: 'Petrol', colour: 'Autumn Green', daily_rent: 55, weekly_rent: 330, monthly_rent: 1150 },
  { make: 'Subaru', model: 'Forester', year: 2024, fuel_type: 'Petrol', colour: 'Cascade Green', daily_rent: 52, weekly_rent: 312, monthly_rent: 1100 },
  { make: 'Subaru', model: 'Crosstrek', year: 2024, fuel_type: 'Hybrid', colour: 'Offshore Blue', daily_rent: 48, weekly_rent: 288, monthly_rent: 1000 },
  { make: 'Subaru', model: 'WRX', year: 2024, fuel_type: 'Petrol', colour: 'WR Blue', daily_rent: 75, weekly_rent: 450, monthly_rent: 1550 },
  { make: 'Subaru', model: 'Impreza', year: 2024, fuel_type: 'Petrol', colour: 'Ocean Blue', daily_rent: 42, weekly_rent: 252, monthly_rent: 880 },

  // Chevrolet (5) — note: Corvette excluded by Bonzah, but other models fine
  { make: 'Chevrolet', model: 'Equinox', year: 2024, fuel_type: 'Petrol', colour: 'Summit White', daily_rent: 50, weekly_rent: 300, monthly_rent: 1050 },
  { make: 'Chevrolet', model: 'Malibu', year: 2024, fuel_type: 'Petrol', colour: 'Mosaic Black', daily_rent: 45, weekly_rent: 270, monthly_rent: 950 },
  { make: 'Chevrolet', model: 'Traverse', year: 2024, fuel_type: 'Petrol', colour: 'Sterling Grey', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Chevrolet', model: 'Blazer', year: 2024, fuel_type: 'Electric', colour: 'Radiant Red', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Chevrolet', model: 'Trax', year: 2024, fuel_type: 'Petrol', colour: 'Cayenne Orange', daily_rent: 35, weekly_rent: 210, monthly_rent: 730 },

  // Mercedes (non-excluded models only: C-Class, E-Class, GLC, GLE, A-Class)
  { make: 'Mercedes', model: 'A-Class', year: 2024, fuel_type: 'Petrol', colour: 'Polar White', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },
  { make: 'Mercedes', model: 'C-Class', year: 2024, fuel_type: 'Diesel', colour: 'Selenite Grey', daily_rent: 75, weekly_rent: 450, monthly_rent: 1550 },
  { make: 'Mercedes', model: 'E-Class', year: 2024, fuel_type: 'Hybrid', colour: 'Obsidian Black', daily_rent: 85, weekly_rent: 510, monthly_rent: 1750 },
  { make: 'Mercedes', model: 'GLC', year: 2024, fuel_type: 'Diesel', colour: 'Brilliant Blue', daily_rent: 80, weekly_rent: 480, monthly_rent: 1650 },
  { make: 'Mercedes', model: 'GLE', year: 2024, fuel_type: 'Diesel', colour: 'Diamond Silver', daily_rent: 90, weekly_rent: 540, monthly_rent: 1850 },
  { make: 'Mercedes', model: 'CLA', year: 2024, fuel_type: 'Petrol', colour: 'Sun Yellow', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Mercedes', model: 'GLA', year: 2024, fuel_type: 'Petrol', colour: 'Mountain Grey', daily_rent: 62, weekly_rent: 372, monthly_rent: 1300 },
  { make: 'Mercedes', model: 'GLB', year: 2024, fuel_type: 'Petrol', colour: 'Cosmos Black', daily_rent: 65, weekly_rent: 390, monthly_rent: 1350 },

  // Tesla (non-excluded — Cybertruck excluded, but Model 3/Y/S/X fine)
  { make: 'Tesla', model: 'Model 3', year: 2024, fuel_type: 'Electric', colour: 'Pearl White', daily_rent: 70, weekly_rent: 420, monthly_rent: 1450 },
  { make: 'Tesla', model: 'Model Y', year: 2024, fuel_type: 'Electric', colour: 'Midnight Silver', daily_rent: 75, weekly_rent: 450, monthly_rent: 1550 },
  { make: 'Tesla', model: 'Model S', year: 2024, fuel_type: 'Electric', colour: 'Deep Blue', daily_rent: 95, weekly_rent: 570, monthly_rent: 1950 },

  // Audi (not in Bonzah exclusion list)
  { make: 'Audi', model: 'A3', year: 2024, fuel_type: 'Petrol', colour: 'Glacier White', daily_rent: 62, weekly_rent: 372, monthly_rent: 1300 },
  { make: 'Audi', model: 'A4', year: 2024, fuel_type: 'Diesel', colour: 'Mythos Black', daily_rent: 72, weekly_rent: 432, monthly_rent: 1500 },
  { make: 'Audi', model: 'Q5', year: 2024, fuel_type: 'Diesel', colour: 'Navarra Blue', daily_rent: 78, weekly_rent: 468, monthly_rent: 1600 },
  { make: 'Audi', model: 'Q3', year: 2024, fuel_type: 'Petrol', colour: 'Chronos Grey', daily_rent: 60, weekly_rent: 360, monthly_rent: 1250 },
];

// Stock car images from picsum.photos (consistent, always available placeholder images)
// Each vehicle gets a unique image based on its index
function getCarImageUrl(index) {
  // Use picsum with a seed so each vehicle always gets the same image
  return `https://picsum.photos/seed/car${index}/800/500`;
}

function generateRegNumber(index) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  // Format: XX00 XXX (UK style)
  const a1 = letters[Math.floor(index / 26) % 26];
  const a2 = letters[index % 26];
  const num = String(24 + Math.floor(index / 100)).padStart(2, '0');
  const b1 = letters[(index * 3) % 26];
  const b2 = letters[(index * 7 + 5) % 26];
  const b3 = letters[(index * 11 + 3) % 26];
  return `${a1}${a2}${num} ${b1}${b2}${b3}`;
}

function generateVIN(index) {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let vin = '';
  for (let i = 0; i < 17; i++) {
    vin += chars[(index * (i + 7) + i * 13) % chars.length];
  }
  return vin;
}

async function main() {
  console.log('🚗 Seeding 100 Bonzah-eligible vehicles...\n');

  // Get tenant to seed for
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, slug, company_name');

  if (tenantsError) {
    console.error('Error fetching tenants:', tenantsError);
    process.exit(1);
  }

  if (!tenants || tenants.length === 0) {
    console.log('No tenants found.');
    process.exit(0);
  }

  console.log('Available tenants:');
  tenants.forEach((t, i) => console.log(`  ${i + 1}. ${t.company_name || t.slug} (${t.id})`));

  // Use first tenant or pass tenant slug as arg
  const targetSlug = process.argv[2];
  const tenant = targetSlug
    ? tenants.find(t => t.slug === targetSlug)
    : tenants[0];

  if (!tenant) {
    console.error(`Tenant "${targetSlug}" not found. Usage: node seed-100-bonzah-vehicles.mjs [tenant-slug]`);
    process.exit(1);
  }

  console.log(`\n🏢 Seeding for tenant: ${tenant.company_name || tenant.slug} (${tenant.id})\n`);

  // Check existing vehicles
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('tenant_id', tenant.id);

  const offset = existing?.length || 0;
  console.log(`📊 Existing vehicles: ${offset}`);

  // Build insert batch
  const batch = vehicles.map((v, i) => ({
    ...v,
    tenant_id: tenant.id,
    reg: generateRegNumber(offset + i),
    vin: generateVIN(offset + i),
    status: 'Available',
    photo_url: getCarImageUrl(offset + i),
    has_logbook: true,
    has_tracker: Math.random() > 0.3,
    has_spare_key: Math.random() > 0.2,
    has_remote_immobiliser: Math.random() > 0.5,
    current_mileage: Math.floor(Math.random() * 30000) + 5000,
    daily_mileage: 100,
    weekly_mileage: 500,
    monthly_mileage: 1500,
    excess_mileage_rate: 0.25,
    security_deposit: Math.floor(v.daily_rent * 3),
    description: `${v.year} ${v.make} ${v.model} — ${v.fuel_type}, ${v.colour}. Available for daily, weekly, and monthly rental.`,
    available_daily: true,
    available_weekly: true,
    available_monthly: true,
    mot_due_date: `2027-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
    tax_due_date: `2027-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`,
  }));

  // Insert in chunks of 25 to avoid payload limits
  const chunkSize = 25;
  let totalInserted = 0;

  for (let i = 0; i < batch.length; i += chunkSize) {
    const chunk = batch.slice(i, i + chunkSize);
    const { data: inserted, error: insertError } = await supabase
      .from('vehicles')
      .insert(chunk)
      .select('id, reg, make, model');

    if (insertError) {
      console.error(`❌ Error inserting chunk ${i / chunkSize + 1}:`, insertError);
    } else {
      totalInserted += inserted.length;
      console.log(`✅ Chunk ${i / chunkSize + 1}: Inserted ${inserted.length} vehicles`);
      inserted.forEach(v => console.log(`   ${v.reg} — ${v.make} ${v.model}`));
    }
  }

  console.log(`\n🎉 Done! Inserted ${totalInserted} Bonzah-eligible vehicles for ${tenant.company_name || tenant.slug}`);
  console.log('\nBrands used: Toyota, Honda, Ford, Hyundai, Kia, Volkswagen, Nissan, Mazda, Subaru, Chevrolet, Mercedes (eligible models), Tesla (eligible models), Audi');
}

main();
