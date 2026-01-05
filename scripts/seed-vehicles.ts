import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TENANT_ID = '765cb66f-a649-425c-8ef2-6cd063f1ff10';

// High-quality car images from Unsplash (free to use)
const CAR_IMAGES = [
  'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800', // Red sports car
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800', // Porsche
  'https://images.unsplash.com/photo-1542362567-b07e54358753?w=800', // BMW
  'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800', // BMW M3
  'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800', // Luxury car
  'https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=800', // Mercedes
  'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800', // BMW front
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800', // Corvette
  'https://images.unsplash.com/photo-1525609004556-c46c7d6cf023?w=800', // Car interior
  'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800', // Ferrari
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800', // Audi
  'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800', // Mercedes AMG
  'https://images.unsplash.com/photo-1504215680853-026ed2a45def?w=800', // Classic car
  'https://images.unsplash.com/photo-1502877338535-766e1452684a?w=800', // Vintage car
  'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800', // Tesla
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800', // SUV
  'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=800', // Range Rover
  'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800', // Jeep
  'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800', // Sports car
  'https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?w=800', // Mercedes G-Wagon
  'https://images.unsplash.com/photo-1571607388263-1044f9ea01dd?w=800', // Lamborghini
  'https://images.unsplash.com/photo-1616422285623-13ff0162193c?w=800', // Toyota
  'https://images.unsplash.com/photo-1590362891991-f776e747a588?w=800', // Honda
  'https://images.unsplash.com/photo-1609521263047-f8f205293f24?w=800', // Volkswagen
  'https://images.unsplash.com/photo-1612825173281-9a193378527e?w=800', // Audi RS
  'https://images.unsplash.com/photo-1603584173870-7f23fdae1b7a?w=800', // Mustang
  'https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800', // Car on road
  'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=800', // Lamborghini front
  'https://images.unsplash.com/photo-1542282088-72c9c27ed0cd?w=800', // White sports car
  'https://images.unsplash.com/photo-1614200179396-2bdb77ebf81b?w=800', // Rolls Royce
];

// Vehicle data - realistic UK car rental fleet
const VEHICLES = [
  { make: 'Toyota', model: 'Corolla', year: 2023, fuel: 'Hybrid', color: 'White', daily: 45, weekly: 270, monthly: 950 },
  { make: 'Toyota', model: 'Yaris', year: 2024, fuel: 'Hybrid', color: 'Red', daily: 35, weekly: 210, monthly: 750 },
  { make: 'Toyota', model: 'RAV4', year: 2023, fuel: 'Hybrid', color: 'Silver', daily: 65, weekly: 390, monthly: 1400 },
  { make: 'Honda', model: 'Civic', year: 2023, fuel: 'Petrol', color: 'Blue', daily: 50, weekly: 300, monthly: 1050 },
  { make: 'Honda', model: 'CR-V', year: 2024, fuel: 'Hybrid', color: 'Black', daily: 70, weekly: 420, monthly: 1500 },
  { make: 'Volkswagen', model: 'Golf', year: 2023, fuel: 'Petrol', color: 'Grey', daily: 55, weekly: 330, monthly: 1150 },
  { make: 'Volkswagen', model: 'Polo', year: 2024, fuel: 'Petrol', color: 'White', daily: 40, weekly: 240, monthly: 850 },
  { make: 'Volkswagen', model: 'Tiguan', year: 2023, fuel: 'Diesel', color: 'Blue', daily: 75, weekly: 450, monthly: 1600 },
  { make: 'BMW', model: '3 Series', year: 2023, fuel: 'Petrol', color: 'Black', daily: 85, weekly: 510, monthly: 1800 },
  { make: 'BMW', model: 'X3', year: 2024, fuel: 'Diesel', color: 'White', daily: 95, weekly: 570, monthly: 2000 },
  { make: 'BMW', model: '1 Series', year: 2023, fuel: 'Petrol', color: 'Red', daily: 70, weekly: 420, monthly: 1500 },
  { make: 'Mercedes', model: 'A-Class', year: 2024, fuel: 'Petrol', color: 'Silver', daily: 75, weekly: 450, monthly: 1600 },
  { make: 'Mercedes', model: 'C-Class', year: 2023, fuel: 'Hybrid', color: 'Black', daily: 90, weekly: 540, monthly: 1900 },
  { make: 'Mercedes', model: 'GLC', year: 2024, fuel: 'Diesel', color: 'Grey', daily: 100, weekly: 600, monthly: 2100 },
  { make: 'Audi', model: 'A3', year: 2023, fuel: 'Petrol', color: 'White', daily: 70, weekly: 420, monthly: 1500 },
  { make: 'Audi', model: 'A4', year: 2024, fuel: 'Diesel', color: 'Black', daily: 85, weekly: 510, monthly: 1800 },
  { make: 'Audi', model: 'Q5', year: 2023, fuel: 'Hybrid', color: 'Blue', daily: 95, weekly: 570, monthly: 2000 },
  { make: 'Ford', model: 'Focus', year: 2023, fuel: 'Petrol', color: 'Red', daily: 45, weekly: 270, monthly: 950 },
  { make: 'Ford', model: 'Puma', year: 2024, fuel: 'Hybrid', color: 'Orange', daily: 55, weekly: 330, monthly: 1150 },
  { make: 'Ford', model: 'Kuga', year: 2023, fuel: 'Hybrid', color: 'Grey', daily: 65, weekly: 390, monthly: 1400 },
  { make: 'Nissan', model: 'Qashqai', year: 2024, fuel: 'Hybrid', color: 'Silver', daily: 60, weekly: 360, monthly: 1300 },
  { make: 'Nissan', model: 'Juke', year: 2023, fuel: 'Petrol', color: 'Yellow', daily: 50, weekly: 300, monthly: 1050 },
  { make: 'Hyundai', model: 'Tucson', year: 2024, fuel: 'Hybrid', color: 'White', daily: 65, weekly: 390, monthly: 1400 },
  { make: 'Hyundai', model: 'i30', year: 2023, fuel: 'Petrol', color: 'Blue', daily: 45, weekly: 270, monthly: 950 },
  { make: 'Kia', model: 'Sportage', year: 2024, fuel: 'Hybrid', color: 'Black', daily: 65, weekly: 390, monthly: 1400 },
  { make: 'Kia', model: 'Ceed', year: 2023, fuel: 'Petrol', color: 'Grey', daily: 45, weekly: 270, monthly: 950 },
  { make: 'Tesla', model: 'Model 3', year: 2024, fuel: 'Electric', color: 'White', daily: 95, weekly: 570, monthly: 2000 },
  { make: 'Tesla', model: 'Model Y', year: 2024, fuel: 'Electric', color: 'Red', daily: 110, weekly: 660, monthly: 2300 },
  { make: 'Range Rover', model: 'Evoque', year: 2023, fuel: 'Diesel', color: 'Black', daily: 120, weekly: 720, monthly: 2500 },
  { make: 'Range Rover', model: 'Sport', year: 2024, fuel: 'Hybrid', color: 'Grey', daily: 150, weekly: 900, monthly: 3200 },
];

// Generate UK-style registration plates with timestamp for uniqueness
function generateRegPlate(index: number): string {
  const letters1 = ['AB', 'BD', 'CK', 'DL', 'EA', 'FG', 'GH', 'HJ', 'KL', 'LM', 'MN', 'NP', 'PQ', 'RS', 'ST', 'TU', 'UV', 'VW', 'WX', 'XY', 'YZ', 'ZA', 'BC', 'CD', 'DE', 'EF', 'FH', 'HK', 'KM', 'MR'];
  const letters2 = ['XYZ', 'WVU', 'TSR', 'QPO', 'NML', 'KJH', 'GFE', 'DCB', 'ZYX', 'WUT', 'SRQ', 'PON', 'MLK', 'JHG', 'FED', 'CBA', 'YXW', 'VTS', 'RQP', 'ONM', 'LKJ', 'HGF', 'EDC', 'BAZ', 'YWV', 'UTR', 'QPM', 'NLK', 'JGF', 'EDB'];
  const year = ['24', '74'];
  const prefix = letters1[index];
  const suffix = letters2[index];
  const yearCode = year[index % 2];
  return `${prefix}${yearCode} ${suffix}`;
}

async function seedVehicles() {
  console.log('Starting vehicle seed...');
  console.log(`Tenant ID: ${TENANT_ID}`);

  const vehiclesToInsert = VEHICLES.map((v, index) => ({
    tenant_id: TENANT_ID,
    reg: generateRegPlate(index),
    make: v.make,
    model: v.model,
    year: v.year,
    fuel_type: v.fuel,
    color: v.color,
    colour: v.color,
    daily_rent: v.daily,
    weekly_rent: v.weekly,
    monthly_rent: v.monthly,
    status: 'available',
    photo_url: CAR_IMAGES[index % CAR_IMAGES.length],
    description: `${v.year} ${v.make} ${v.model} - ${v.fuel} - ${v.color}`,
    has_logbook: true,
    has_spare_key: Math.random() > 0.3,
    has_tracker: Math.random() > 0.5,
    acquisition_type: ['Purchase', 'Finance', 'Lease'][Math.floor(Math.random() * 3)],
    acquisition_date: new Date(2023, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString().split('T')[0],
  }));

  console.log(`Inserting ${vehiclesToInsert.length} vehicles...`);

  const { data: insertedVehicles, error: vehicleError } = await supabase
    .from('vehicles')
    .insert(vehiclesToInsert)
    .select('id, reg, make, model');

  if (vehicleError) {
    console.error('Error inserting vehicles:', vehicleError);
    return;
  }

  console.log(`Successfully inserted ${insertedVehicles.length} vehicles!`);

  // Now add photos to vehicle_photos table (1-3 photos per vehicle)
  const photosToInsert: { vehicle_id: string; photo_url: string; tenant_id: string; display_order: number }[] = [];

  insertedVehicles.forEach((vehicle, vehicleIndex) => {
    const numPhotos = Math.floor(Math.random() * 3) + 1; // 1-3 photos
    for (let i = 0; i < numPhotos; i++) {
      const imageIndex = (vehicleIndex + i) % CAR_IMAGES.length;
      photosToInsert.push({
        vehicle_id: vehicle.id,
        photo_url: CAR_IMAGES[imageIndex],
        tenant_id: TENANT_ID,
        display_order: i + 1,
      });
    }
  });

  console.log(`Inserting ${photosToInsert.length} vehicle photos...`);

  const { data: insertedPhotos, error: photoError } = await supabase
    .from('vehicle_photos')
    .insert(photosToInsert)
    .select('id');

  if (photoError) {
    console.error('Error inserting photos:', photoError);
    return;
  }

  console.log(`Successfully inserted ${insertedPhotos.length} vehicle photos!`);

  // Print summary
  console.log('\n=== SEED COMPLETE ===');
  console.log('Vehicles created:');
  insertedVehicles.forEach((v) => {
    console.log(`  - ${v.reg}: ${v.make} ${v.model}`);
  });
}

seedVehicles().catch(console.error);
