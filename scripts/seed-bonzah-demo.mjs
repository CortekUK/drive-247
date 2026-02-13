#!/usr/bin/env node

/**
 * Seed script for Bonzah demo tenant
 * Populates the Bonzah tenant with realistic demo data and branding.
 * Safe to re-run — cleans existing demo data before inserting.
 *
 * Run with: node scripts/seed-bonzah-demo.mjs
 */

import { createClient } from '@supabase/supabase-js';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TENANT_ID = 'c8027047-6fc3-4661-97f3-5bf3e3b5d0ab';

// ─── Bonzah Branding ─────────────────────────────────────────────────────────

const BONZAH_LOGO = 'https://bonzah.com/images/tild3433-3032-4665-b235-643337386531__logo-footerc1ca88f88.svg';

const BRANDING = {
  light_primary_color: '#e20082',
  light_secondary_color: '#a01e69',
  light_accent_color: '#f243a7',
  light_background_color: '#ffffff',
  light_header_footer_color: '#1d1e29',
  dark_primary_color: '#f243a7',
  dark_secondary_color: '#a01e69',
  dark_accent_color: '#e20082',
  dark_background_color: '#1d1e29',
  dark_header_footer_color: '#2d2e39',
  primary_color: '#e20082',
  secondary_color: '#a01e69',
  accent_color: '#f243a7',
  logo_url: BONZAH_LOGO,
  favicon_url: BONZAH_LOGO,
  app_name: 'Bonzah',
  meta_title: 'Bonzah | That Covered Feeling\u2122',
  meta_description: 'Premium car rental protection and rental services in Miami, FL',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function daysFromNow(n) {
  const d = new Date(); d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function vin(i) {
  const c = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
  let v = '1HD'; for (let j = 0; j < 14; j++) v += c[((i * 7 + j * 13) % c.length)];
  return v;
}

const CAR_IMAGES = [
  'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800',
  'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800',
  'https://images.unsplash.com/photo-1542362567-b07e54358753?w=800',
  'https://images.unsplash.com/photo-1555215695-3004980ad54e?w=800',
  'https://images.unsplash.com/photo-1544636331-e26879cd4d9b?w=800',
  'https://images.unsplash.com/photo-1553440569-bcc63803a83d?w=800',
  'https://images.unsplash.com/photo-1580273916550-e323be2ae537?w=800',
  'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=800',
  'https://images.unsplash.com/photo-1583121274602-3e2820c69888?w=800',
  'https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800',
  'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?w=800',
  'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=800',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800',
  'https://images.unsplash.com/photo-1619767886558-efdc259cde1a?w=800',
  'https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800',
];

// ─── Cleanup ─────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('Cleaning existing demo data...');

  // Get existing vehicle IDs for this tenant (needed for trigger-created pnl_entries with null tenant_id)
  const { data: existingVehicles } = await supabase.from('vehicles').select('id').eq('tenant_id', TENANT_ID);
  const vehicleIds = (existingVehicles || []).map(v => v.id);

  // Delete pnl_entries by vehicle_id (trigger-created ones may have null tenant_id)
  if (vehicleIds.length > 0) {
    await supabase.from('pnl_entries').delete().in('vehicle_id', vehicleIds);
  }
  // Also delete any with tenant_id
  await supabase.from('pnl_entries').delete().eq('tenant_id', TENANT_ID);

  // Order matters: child tables first, then parent tables
  const tables = [
    'payment_applications', 'ledger_entries',
    'fine_files', 'fines',
    'payments', 'rentals',
    'vehicle_files', 'vehicle_events', 'vehicle_photos',
    'service_records', 'vehicle_expenses', 'plates',
    'vehicles', 'customers', 'pickup_locations',
  ];
  for (const t of tables) {
    const { error } = await supabase.from(t).delete().eq('tenant_id', TENANT_ID);
    if (error) console.warn(`  Cleanup ${t}: ${error.message}`);
  }
  console.log('  Cleanup done.');
}

// ─── Seed Functions ──────────────────────────────────────────────────────────

async function updateTenantBranding() {
  console.log('Updating tenant branding...');
  const { error } = await supabase.from('tenants').update({
    ...BRANDING,
    currency_code: 'USD',
    timezone: 'America/New_York',
    distance_unit: 'miles',
    date_format: 'MM/DD/YYYY',
    min_rental_days: 1,
    max_rental_days: 365,
    booking_lead_time_hours: 4,
    minimum_rental_age: 21,
    payment_mode: 'stripe',
    pickup_location_mode: 'multiple',
    return_location_mode: 'multiple',
    multiple_locations_enabled: true,
    pickup_multiple_locations_enabled: true,
    return_multiple_locations_enabled: true,
    contact_email: 'info@bonzah.com',
    contact_phone: '+1 (305) 555-0100',
    address: '1200 Brickell Avenue, Suite 400, Miami, FL 33131',
    monday_enabled: true, monday_open: '08:00', monday_close: '20:00',
    tuesday_enabled: true, tuesday_open: '08:00', tuesday_close: '20:00',
    wednesday_enabled: true, wednesday_open: '08:00', wednesday_close: '20:00',
    thursday_enabled: true, thursday_open: '08:00', thursday_close: '20:00',
    friday_enabled: true, friday_open: '08:00', friday_close: '20:00',
    saturday_enabled: true, saturday_open: '08:00', saturday_close: '20:00',
    sunday_enabled: true, sunday_open: '09:00', sunday_close: '17:00',
    working_hours_enabled: true,
  }).eq('id', TENANT_ID);
  if (error) throw new Error(`Tenant branding: ${error.message}`);
  console.log('  Done.');
}

async function seedOrgSettings() {
  console.log('Seeding org_settings...');
  const { data: existing } = await supabase.from('org_settings').select('id').eq('tenant_id', TENANT_ID).maybeSingle();
  const payload = {
    ...BRANDING,
    company_name: 'Bonzah',
    currency_code: 'USD',
    timezone: 'America/New_York',
    date_format: 'MM/DD/YYYY',
    distance_unit: 'miles',
    payment_mode: 'automated',
  };
  if (existing) {
    const { error } = await supabase.from('org_settings').update(payload).eq('id', existing.id);
    if (error) throw new Error(`Org settings: ${error.message}`);
  } else {
    const { error } = await supabase.from('org_settings').insert({ tenant_id: TENANT_ID, org_id: TENANT_ID, ...payload });
    if (error) throw new Error(`Org settings: ${error.message}`);
  }
  console.log('  Done.');
}

async function seedLocations() {
  console.log('Seeding pickup locations...');
  const locs = [
    { name: 'Miami International Airport (MIA)', address: '2100 NW 42nd Ave, Miami, FL 33142', delivery_fee: 25, sort_order: 1 },
    { name: 'Downtown Miami Office', address: '1200 Brickell Avenue, Suite 400, Miami, FL 33131', delivery_fee: 0, sort_order: 2 },
    { name: 'Fort Lauderdale Airport (FLL)', address: '100 Terminal Dr, Fort Lauderdale, FL 33315', delivery_fee: 35, sort_order: 3 },
  ];
  const { data, error } = await supabase.from('pickup_locations')
    .insert(locs.map(l => ({ ...l, tenant_id: TENANT_ID, is_active: true, is_pickup_enabled: true, is_return_enabled: true })))
    .select('id, name');
  if (error) throw new Error(`Locations: ${error.message}`);
  console.log(`  ${data.length} locations.`);
  return data;
}

async function seedVehicles() {
  console.log('Seeding vehicles...');
  const V = [
    { make: 'Toyota', model: 'Corolla', year: 2024, fuel: 'Petrol', color: 'White', d: 45, w: 270, m: 950, pp: 24000, mi: 12400, st: 'rented' },
    { make: 'Honda', model: 'Civic', year: 2024, fuel: 'Petrol', color: 'Silver', d: 48, w: 288, m: 990, pp: 25500, mi: 8900, st: 'rented' },
    { make: 'Nissan', model: 'Sentra', year: 2023, fuel: 'Petrol', color: 'Blue', d: 42, w: 252, m: 880, pp: 22000, mi: 18700, st: 'available' },
    { make: 'Toyota', model: 'Camry', year: 2024, fuel: 'Hybrid', color: 'Black', d: 65, w: 390, m: 1350, pp: 32000, mi: 6200, st: 'rented' },
    { make: 'Honda', model: 'Accord', year: 2023, fuel: 'Hybrid', color: 'Grey', d: 68, w: 408, m: 1400, pp: 33500, mi: 15300, st: 'rented' },
    { make: 'Hyundai', model: 'Sonata', year: 2024, fuel: 'Petrol', color: 'White', d: 58, w: 348, m: 1200, pp: 29000, mi: 9800, st: 'available' },
    { make: 'Toyota', model: 'RAV4', year: 2024, fuel: 'Hybrid', color: 'Red', d: 75, w: 450, m: 1550, pp: 36000, mi: 7500, st: 'rented' },
    { make: 'Honda', model: 'CR-V', year: 2023, fuel: 'Hybrid', color: 'Black', d: 72, w: 432, m: 1500, pp: 35000, mi: 14200, st: 'available' },
    { make: 'Ford', model: 'Explorer', year: 2024, fuel: 'Petrol', color: 'White', d: 85, w: 510, m: 1750, pp: 42000, mi: 5800, st: 'rented' },
    { make: 'Jeep', model: 'Grand Cherokee', year: 2023, fuel: 'Petrol', color: 'Green', d: 90, w: 540, m: 1850, pp: 45000, mi: 11600, st: 'available' },
    { make: 'BMW', model: '5 Series', year: 2024, fuel: 'Petrol', color: 'Black', d: 135, w: 810, m: 2800, pp: 58000, mi: 4100, st: 'rented' },
    { make: 'Mercedes', model: 'C-Class', year: 2024, fuel: 'Petrol', color: 'Silver', d: 125, w: 750, m: 2600, pp: 52000, mi: 6700, st: 'available' },
    { make: 'Audi', model: 'A4', year: 2023, fuel: 'Petrol', color: 'White', d: 120, w: 720, m: 2500, pp: 48000, mi: 13400, st: 'rented' },
    { make: 'BMW', model: 'X5', year: 2024, fuel: 'Hybrid', color: 'Black', d: 175, w: 1050, m: 3600, pp: 65000, mi: 3200, st: 'available' },
    { make: 'Mercedes', model: 'GLE', year: 2023, fuel: 'Diesel', color: 'Grey', d: 200, w: 1200, m: 4100, pp: 62000, mi: 10900, st: 'available' },
  ];
  const plates = ['BNZ 1A01','BNZ 2B02','BNZ 3C03','BNZ 4D04','BNZ 5E05','BNZ 6F06','BNZ 7G07','BNZ 8H08','BNZ 9J09','BNZ 0K10','BNZ 1L11','BNZ 2M12','BNZ 3N13','BNZ 4P14','BNZ 5Q15'];

  const rows = V.map((v, i) => ({
    tenant_id: TENANT_ID, reg: plates[i], make: v.make, model: v.model, year: v.year,
    fuel_type: v.fuel, color: v.color, colour: v.color,
    daily_rent: v.d, weekly_rent: v.w, monthly_rent: v.m,
    purchase_price: v.pp, current_mileage: v.mi, status: v.st,
    vin: vin(i), photo_url: CAR_IMAGES[i],
    description: `${v.year} ${v.make} ${v.model} - ${v.fuel} - ${v.color}`,
    has_logbook: true, has_spare_key: i % 3 !== 0, has_tracker: true,
    acquisition_type: i < 5 ? 'Purchase' : i < 10 ? 'Finance' : 'Lease',
    acquisition_date: daysAgo(rand(60, 365)),
    mot_due_date: daysFromNow(rand(60, 300)),
    tax_due_date: daysFromNow(rand(30, 365)),
    allowed_mileage: v.d >= 100 ? 200 : 150,
  }));

  const { data, error } = await supabase.from('vehicles').insert(rows).select('id, reg, make, model, status, daily_rent');
  if (error) throw new Error(`Vehicles: ${error.message}`);
  console.log(`  ${data.length} vehicles.`);

  // Photos
  const photos = [];
  data.forEach((v, i) => {
    for (let p = 0; p < (i % 3 === 0 ? 2 : 1); p++)
      photos.push({ vehicle_id: v.id, photo_url: CAR_IMAGES[(i + p) % CAR_IMAGES.length], tenant_id: TENANT_ID, display_order: p + 1 });
  });
  const { error: pe } = await supabase.from('vehicle_photos').insert(photos);
  if (pe) console.warn(`  Photos warning: ${pe.message}`);
  else console.log(`  ${photos.length} photos.`);
  return data;
}

async function seedCustomers() {
  console.log('Seeding customers...');
  const indiv = [
    { n: 'James Rodriguez', e: 'james.rodriguez@email.com', p: '+1 (305) 555-0101', d: '1988-03-15' },
    { n: 'Maria Santos', e: 'maria.santos@email.com', p: '+1 (305) 555-0102', d: '1992-07-22' },
    { n: 'David Chen', e: 'david.chen@email.com', p: '+1 (786) 555-0103', d: '1985-11-08' },
    { n: 'Sofia Martinez', e: 'sofia.martinez@email.com', p: '+1 (305) 555-0104', d: '1990-01-30' },
    { n: 'Michael Thompson', e: 'michael.t@email.com', p: '+1 (786) 555-0105', d: '1978-06-14' },
    { n: 'Ana Perez', e: 'ana.perez@email.com', p: '+1 (305) 555-0106', d: '1995-09-03' },
    { n: 'Robert Williams', e: 'robert.w@email.com', p: '+1 (786) 555-0107', d: '1982-12-19' },
    { n: 'Isabella Garcia', e: 'isabella.g@email.com', p: '+1 (305) 555-0108', d: '1993-04-25' },
    { n: 'William Johnson', e: 'william.j@email.com', p: '+1 (786) 555-0109', d: '1975-08-11' },
    { n: 'Carmen Lopez', e: 'carmen.lopez@email.com', p: '+1 (305) 555-0110', d: '1987-02-28' },
    { n: 'Daniel Brown', e: 'daniel.b@email.com', p: '+1 (786) 555-0111', d: '1991-10-07' },
    { n: 'Valentina Cruz', e: 'valentina.c@email.com', p: '+1 (305) 555-0112', d: '1989-05-16' },
    { n: 'Christopher Davis', e: 'chris.davis@email.com', p: '+1 (786) 555-0113', d: '1984-01-23' },
    { n: 'Lucia Fernandez', e: 'lucia.f@email.com', p: '+1 (305) 555-0114', d: '1996-11-12' },
    { n: 'Andrew Miller', e: 'andrew.m@email.com', p: '+1 (786) 555-0115', d: '1980-07-05' },
    { n: 'Patricia Alvarez', e: 'patricia.a@email.com', p: '+1 (305) 555-0116', d: '1977-03-29' },
    { n: 'Ryan Wilson', e: 'ryan.wilson@email.com', p: '+1 (786) 555-0117', d: '1994-08-18' },
    { n: 'Diana Morales', e: 'diana.m@email.com', p: '+1 (305) 555-0118', d: '1986-12-01' },
    { n: 'Kevin Anderson', e: 'kevin.a@email.com', p: '+1 (786) 555-0119', d: '1983-06-24' },
    { n: 'Camila Reyes', e: 'camila.r@email.com', p: '+1 (305) 555-0120', d: '1997-09-30' },
  ];
  const corps = [
    { n: 'Sunshine Events LLC', e: 'fleet@sunshineevents.com', p: '+1 (305) 555-0201' },
    { n: 'Bay Harbor Consulting', e: 'admin@bayharbor.com', p: '+1 (786) 555-0202' },
    { n: 'Coral Gables Properties', e: 'transport@coralgables.com', p: '+1 (305) 555-0203' },
    { n: 'Ocean Drive Media', e: 'ops@oceandrivemedia.com', p: '+1 (786) 555-0204' },
    { n: 'South Beach Hospitality Group', e: 'logistics@sbhg.com', p: '+1 (305) 555-0205' },
  ];

  const rows = [
    ...indiv.map((c, i) => ({
      tenant_id: TENANT_ID, name: c.n, email: c.e, phone: c.p, date_of_birth: c.d,
      type: 'Individual', customer_type: 'Individual', status: 'active',
      identity_verification_status: i < 14 ? 'verified' : 'pending',
      license_number: `FL${rand(100000, 999999)}${rand(100, 999)}`,
      ...(i < 3 ? {
        nok_full_name: `${['Sarah', 'Carlos', 'Linda'][i]} ${c.n.split(' ')[1]}`,
        nok_phone: `+1 (305) 555-${String(300 + i).padStart(4, '0')}`,
        nok_email: `nok.${c.n.split(' ')[1].toLowerCase()}@email.com`,
        nok_relationship: ['Spouse', 'Parent', 'Sibling'][i],
        nok_address: `${rand(100, 9999)} ${['Brickell Ave', 'Collins Ave', 'Ocean Dr'][i]}, Miami, FL`,
      } : {}),
    })),
    ...corps.map(c => ({
      tenant_id: TENANT_ID, name: c.n, email: c.e, phone: c.p,
      type: 'Company', customer_type: 'Company', status: 'active',
      identity_verification_status: 'verified',
    })),
  ];

  const { data, error } = await supabase.from('customers').insert(rows).select('id, name, type');
  if (error) throw new Error(`Customers: ${error.message}`);
  console.log(`  ${data.length} customers.`);
  return data;
}

async function seedRentals(vehicles, customers, locations) {
  console.log('Seeding rentals...');
  const rented = vehicles.filter(v => v.status === 'rented');
  const records = [];
  let ci = 0;

  // 8 active (rented vehicles) — status: Active, payment_status: fulfilled
  for (const v of rented) {
    const c = customers[ci++ % customers.length];
    const sa = rand(5, 45), ef = rand(10, 60);
    const pt = sa + ef > 35 ? 'Monthly' : sa + ef > 14 ? 'Weekly' : 'Daily';
    const amt = pt === 'Monthly' ? v.daily_rent * 30 : pt === 'Weekly' ? v.daily_rent * 7 : v.daily_rent;
    records.push({
      tenant_id: TENANT_ID, customer_id: c.id, vehicle_id: v.id,
      start_date: daysAgo(sa), end_date: daysFromNow(ef),
      monthly_amount: amt, status: 'Active', payment_status: 'fulfilled',
      approval_status: 'approved', rental_period_type: pt,
      pickup_location: locations[ci % locations.length].name,
      pickup_location_id: locations[ci % locations.length].id,
      delivery_fee: ci % 3 === 0 ? 25 : 0, source: 'portal',
    });
  }

  // 15 completed (Closed)
  const avail = vehicles.filter(v => v.status === 'available');
  for (let i = 0; i < 15; i++) {
    const c = customers[ci++ % customers.length];
    const v = avail.length > 0 ? avail[i % avail.length] : vehicles[i % vehicles.length];
    const sa = rand(30, 90), dur = rand(5, 30), ea = sa - dur;
    const pt = dur > 25 ? 'Monthly' : dur > 10 ? 'Weekly' : 'Daily';
    const amt = pt === 'Monthly' ? v.daily_rent * 30 : pt === 'Weekly' ? v.daily_rent * 7 : v.daily_rent;
    records.push({
      tenant_id: TENANT_ID, customer_id: c.id, vehicle_id: v.id,
      start_date: daysAgo(sa), end_date: daysAgo(Math.max(1, ea)),
      monthly_amount: amt, status: 'Closed',
      payment_status: i < 12 ? 'fulfilled' : 'pending',
      approval_status: 'approved', rental_period_type: pt,
      pickup_location: locations[i % locations.length].name,
      pickup_location_id: locations[i % locations.length].id,
      source: i % 3 === 0 ? 'booking' : 'portal',
    });
  }

  // 4 cancelled
  for (let i = 0; i < 4; i++) {
    const c = customers[ci++ % customers.length];
    const v = vehicles[rand(0, vehicles.length - 1)];
    const sa = rand(20, 60);
    records.push({
      tenant_id: TENANT_ID, customer_id: c.id, vehicle_id: v.id,
      start_date: daysAgo(sa), end_date: daysAgo(sa - rand(5, 15)),
      monthly_amount: v.daily_rent * 7, status: 'Cancelled',
      payment_status: i < 2 ? 'refunded' : 'failed',
      approval_status: 'approved', rental_period_type: 'Weekly',
      cancellation_reason: ['Customer request', 'Vehicle unavailable', 'Payment issue', 'Schedule conflict'][i],
      source: 'portal',
    });
  }

  // 3 with pending payment
  for (let i = 0; i < 3; i++) {
    const c = customers[ci++ % customers.length];
    const v = vehicles[rand(0, vehicles.length - 1)];
    records.push({
      tenant_id: TENANT_ID, customer_id: c.id, vehicle_id: v.id,
      start_date: daysAgo(rand(3, 20)), end_date: daysFromNow(rand(10, 40)),
      monthly_amount: v.daily_rent * 30, status: 'Active', payment_status: 'pending',
      approval_status: 'approved', rental_period_type: 'Monthly',
      pickup_location: locations[i % locations.length].name,
      pickup_location_id: locations[i % locations.length].id,
      source: 'booking',
    });
  }

  const { data, error } = await supabase.from('rentals').insert(records)
    .select('id, customer_id, vehicle_id, status, monthly_amount, start_date, end_date, payment_status');
  if (error) throw new Error(`Rentals: ${error.message}`);
  console.log(`  ${data.length} rentals.`);
  return data;
}

// DB constraints: payment_type = 'InitialFee' | 'Payment'
// status = 'Applied' | 'Credit' | 'Partial'
// verification_status = 'pending' | 'approved' | 'rejected' | 'auto_approved'
async function seedPayments(rentals) {
  console.log('Seeding payments...');
  const payments = [];
  const now = new Date();

  for (const r of rentals) {
    if (r.status === 'Cancelled' && r.payment_status === 'failed') continue;
    const isFulfilled = r.payment_status === 'fulfilled';

    // Initial fee
    payments.push({
      tenant_id: TENANT_ID, customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
      amount: r.monthly_amount, payment_date: r.start_date,
      payment_type: 'InitialFee',
      status: isFulfilled ? 'Applied' : 'Credit',
      method: pick(['card', 'card', 'card', 'bank_transfer']),
      verification_status: isFulfilled ? 'approved' : 'pending',
      is_early: false, remaining_amount: isFulfilled ? 0 : r.monthly_amount,
      created_at: r.start_date + 'T10:00:00Z',
    });

    // Monthly recurring for non-cancelled
    if (r.status !== 'Cancelled') {
      const start = new Date(r.start_date);
      const end = new Date(r.end_date);
      let pd = new Date(start); pd.setMonth(pd.getMonth() + 1);
      let mc = 0;
      while (pd < now && pd < end && mc < 3) {
        const paid = isFulfilled || mc === 0;
        payments.push({
          tenant_id: TENANT_ID, customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
          amount: r.monthly_amount, payment_date: pd.toISOString().split('T')[0],
          payment_type: 'Payment',
          status: paid ? 'Applied' : (mc > 1 ? 'Partial' : 'Credit'),
          method: pick(['card', 'card', 'bank_transfer', 'cash']),
          verification_status: paid ? 'approved' : 'pending',
          is_early: false, remaining_amount: paid ? 0 : r.monthly_amount,
          created_at: pd.toISOString(),
        });
        pd.setMonth(pd.getMonth() + 1);
        mc++;
      }
    }
  }

  // Refunds on a few
  const applied = payments.filter(p => p.status === 'Applied');
  for (let i = 0; i < Math.min(3, applied.length); i++) {
    const t = applied[applied.length - 1 - i];
    t.refund_amount = Math.round(t.amount * 0.5);
    t.refund_status = 'completed';
    t.refund_reason = pick(['Early return', 'Service issue', 'Vehicle swap']);
    t.refund_processed_at = daysAgo(rand(1, 10)) + 'T14:00:00Z';
  }

  const all = [];
  for (let i = 0; i < payments.length; i += 25) {
    const { data, error } = await supabase.from('payments').insert(payments.slice(i, i + 25))
      .select('id, rental_id, customer_id, vehicle_id, amount, status, payment_type, payment_date');
    if (error) throw new Error(`Payments batch ${i}: ${error.message}`);
    all.push(...data);
  }
  console.log(`  ${all.length} payments.`);
  return all;
}

// DB constraints: type = 'Charge' | 'Payment' | 'Refund'
// category = 'Rental' | 'InitialFee' | 'Initial Fees' | 'Fine' | 'Adjustment'
async function seedLedgerEntries(rentals, payments) {
  console.log('Seeding ledger entries...');
  const entries = [];

  for (const r of rentals) {
    if (r.status === 'Cancelled' && r.payment_status === 'failed') continue;
    const rp = payments.filter(p => p.rental_id === r.id);

    for (const p of rp) {
      // Charge
      entries.push({
        tenant_id: TENANT_ID, customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
        type: 'Charge',
        category: p.payment_type === 'InitialFee' ? 'InitialFee' : 'Rental',
        amount: p.amount, entry_date: p.payment_date, due_date: p.payment_date,
        remaining_amount: p.status === 'Applied' ? 0 : p.amount,
      });
    }

    // Payment entries for applied payments
    for (const p of rp.filter(pp => pp.status === 'Applied')) {
      entries.push({
        tenant_id: TENANT_ID, customer_id: r.customer_id, rental_id: r.id, vehicle_id: r.vehicle_id,
        payment_id: p.id, type: 'Payment', category: 'Rental',
        amount: p.amount, entry_date: p.payment_date, remaining_amount: 0,
      });
    }
  }

  const all = [];
  for (let i = 0; i < entries.length; i += 30) {
    const { data, error } = await supabase.from('ledger_entries').insert(entries.slice(i, i + 30)).select('id');
    if (error) throw new Error(`Ledger batch ${i}: ${error.message}`);
    all.push(...data);
  }
  console.log(`  ${all.length} ledger entries.`);
  return all;
}

// DB constraints: status = 'Open' | 'Appealed' | 'Waived' | 'Charged' | 'Paid' | 'Appeal Successful' | 'Appeal Rejected' | 'Appeal Submitted' | 'Partially Paid'
// type = 'PCN' | 'Speeding' | 'Other'
// liability = 'Customer' | 'Business'
async function seedFines(vehicles, customers) {
  console.log('Seeding fines...');
  const fines = [
    { type: 'Speeding', status: 'Open', amt: 150 },
    { type: 'PCN', status: 'Open', amt: 85 },
    { type: 'Other', status: 'Open', amt: 50 },
    { type: 'Speeding', status: 'Paid', amt: 250 },
    { type: 'PCN', status: 'Paid', amt: 65 },
    { type: 'Other', status: 'Appealed', amt: 200 },
    { type: 'Speeding', status: 'Appeal Submitted', amt: 35 },
    { type: 'PCN', status: 'Waived', amt: 175 },
  ].map((f, i) => {
    const da = rand(5, 60);
    return {
      tenant_id: TENANT_ID,
      vehicle_id: vehicles[i % vehicles.length].id,
      customer_id: customers[i % customers.length].id,
      type: f.type, amount: f.amt, status: f.status,
      issue_date: daysAgo(da), due_date: daysFromNow(rand(1, 28)),
      reference_no: `FL-26${rand(10000, 99999)}`,
      liability: pick(['Customer', 'Business']),
      notes: f.status === 'Appealed' || f.status === 'Appeal Submitted' ? 'Customer disputes - evidence submitted' : null,
      ...(f.status === 'Paid' ? { charged_at: daysAgo(da - 10) + 'T12:00:00Z' } : {}),
      ...(f.status === 'Waived' ? { waived_at: daysAgo(5) + 'T09:00:00Z' } : {}),
      ...(f.status === 'Appealed' || f.status === 'Appeal Submitted' ? { appealed_at: daysAgo(da - 5) + 'T15:00:00Z' } : {}),
    };
  });

  const { data, error } = await supabase.from('fines').insert(fines).select('id');
  if (error) throw new Error(`Fines: ${error.message}`);
  console.log(`  ${data.length} fines.`);
}

async function seedVehicleExpenses(vehicles) {
  console.log('Seeding vehicle expenses...');
  // Only use 'Service' category — other categories trigger a PnL insert with
  // invalid category 'Expenses' due to a DB trigger bug (handle_vehicle_expense_pnl).
  const descs = [
    'Full service', 'Interim service', 'Major service', 'Inspection', 'Emissions test',
    'Oil change', 'Brake pad replacement', 'Tire rotation', 'AC recharge', 'Battery replacement',
    'Windshield repair', 'Transmission flush', 'Coolant flush', 'Alignment', 'Wheel balance',
    'Cabin filter replacement', 'Spark plug replacement', 'Belt tensioning', 'Wiper blades',
    'Exhaust repair', 'Suspension check', 'Power steering fluid', 'Fuel filter', 'Air filter',
    'Headlight bulb replacement',
  ];
  const amounts = [280,150,420,95,75,85,350,60,180,250,180,250,95,100,60,55,200,80,35,450,120,65,45,30,25];

  const rows = [];
  for (let i = 0; i < 25; i++) {
    rows.push({
      tenant_id: TENANT_ID, vehicle_id: vehicles[i % vehicles.length].id,
      category: 'Service', amount: amounts[i],
      expense_date: daysAgo(rand(1, 90)), notes: descs[i],
      reference: `EXP-${rand(10000, 99999)}`,
    });
  }

  const { data, error } = await supabase.from('vehicle_expenses').insert(rows).select('id');
  if (error) throw new Error(`Expenses: ${error.message}`);
  console.log(`  ${data.length} expenses.`);
}

async function seedServiceRecords(vehicles) {
  console.log('Seeding service records...');
  const svcs = [
    { t: 'Oil Change', d: 'Synthetic oil change with filter', c: 85 },
    { t: 'Tire Rotation', d: 'Four tire rotation and balance', c: 60 },
    { t: 'Brake Inspection', d: 'Full brake system inspection', c: 120 },
    { t: 'AC Service', d: 'AC refrigerant recharge', c: 180 },
    { t: 'Full Service', d: 'Comprehensive vehicle service', c: 350 },
    { t: 'Transmission', d: 'Transmission fluid change', c: 250 },
    { t: 'Battery Check', d: 'Battery test and terminal cleaning', c: 45 },
    { t: 'Alignment', d: 'Four-wheel alignment', c: 100 },
    { t: 'Coolant Flush', d: 'Engine coolant flush and fill', c: 95 },
    { t: 'Cabin Filter', d: 'Cabin air filter replacement', c: 55 },
    { t: 'Spark Plugs', d: 'Spark plug replacement', c: 200 },
    { t: 'Belt Inspection', d: 'Drive belt inspection', c: 80 },
  ];

  const rows = svcs.map((s, i) => ({
    tenant_id: TENANT_ID, vehicle_id: vehicles[i % vehicles.length].id,
    service_type: s.t, description: s.d, cost: s.c,
    service_date: daysAgo(rand(5, 90)),
    mileage: rand(3000, 20000),
  }));

  const { data, error } = await supabase.from('service_records').insert(rows).select('id');
  if (error) throw new Error(`Service records: ${error.message}`);
  console.log(`  ${data.length} service records.`);
}

// DB constraints: side = 'Revenue' | 'Cost'
// category = 'Initial Fees' | 'Rental' | 'Acquisition' | 'Finance' | 'Service' | 'Fines' | 'Other' | 'Disposal' | 'Plates'
// unique(reference), unique(payment_id, category), unique(vehicle_id, category, source_ref)
async function seedPnlEntries(vehicles, payments) {
  console.log('Seeding P&L entries...');
  const entries = [];
  let refCounter = 0;

  // Income from paid payments
  for (const p of payments.filter(pp => pp.status === 'Applied')) {
    entries.push({
      tenant_id: TENANT_ID, vehicle_id: p.vehicle_id,
      customer_id: p.customer_id, rental_id: p.rental_id, payment_id: p.id,
      side: 'Revenue',
      category: p.payment_type === 'InitialFee' ? 'Initial Fees' : 'Rental',
      amount: p.amount, entry_date: p.payment_date,
      reference: `PNL-R-${++refCounter}`,
    });
  }

  // Expense entries per vehicle per month
  const expCats = ['Service', 'Fines', 'Other'];
  for (const v of vehicles) {
    for (let month = 0; month < 3; month++) {
      const dt = daysAgo(month * 30 + rand(1, 25));
      for (const cat of expCats) {
        if (Math.random() > 0.5) continue;
        entries.push({
          tenant_id: TENANT_ID, vehicle_id: v.id,
          side: 'Cost', category: cat,
          amount: rand(50, 400), entry_date: dt,
          reference: `PNL-C-${++refCounter}`,
          source_ref: `exp-${v.id.substring(0, 8)}-${cat}-${month}`,
        });
      }
    }
  }

  const all = [];
  for (let i = 0; i < entries.length; i += 30) {
    const { data, error } = await supabase.from('pnl_entries').insert(entries.slice(i, i + 30)).select('id');
    if (error) throw new Error(`PnL batch ${i}: ${error.message}`);
    all.push(...data);
  }
  console.log(`  ${all.length} P&L entries.`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('============================================================');
  console.log('  BONZAH DEMO DATA SEED');
  console.log('  Tenant: ' + TENANT_ID);
  console.log('============================================================\n');

  try {
    await cleanup();
    await updateTenantBranding();
    await seedOrgSettings();

    const locations = await seedLocations();
    const vehicles = await seedVehicles();
    const customers = await seedCustomers();
    const rentals = await seedRentals(vehicles, customers, locations);
    const payments = await seedPayments(rentals);
    // Skip ledger entries — auto-generated by triggers or not critical for demo
    await seedFines(vehicles, customers);
    await seedVehicleExpenses(vehicles);
    await seedServiceRecords(vehicles);
    await seedPnlEntries(vehicles, payments);

    console.log('\n============================================================');
    console.log('  SEED COMPLETE');
    console.log('  Portal: bonzah.portal.localhost:3001');
    console.log('  Booking: bonzah.localhost:3000');
    console.log('  Login: admin@bonzah.com');
    console.log('============================================================');
  } catch (err) {
    console.error('\nSEED FAILED:', err.message);
    process.exit(1);
  }
}

main();
