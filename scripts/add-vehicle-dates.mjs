
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://hviqoaokxvlancmftwuo.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

// Generate a random date between start and end
function randomDate(start, end) {
  const startTime = start.getTime();
  const endTime = end.getTime();
  const randomTime = startTime + Math.random() * (endTime - startTime);
  return new Date(randomTime).toISOString().split('T')[0];
}

async function main() {
  console.log('Adding random inspection and registration dates to vehicles...\n');

  // Get all vehicles
  const { data: vehicles, error: fetchError } = await supabase
    .from('vehicles')
    .select('id, reg, make, model, mot_due_date, tax_due_date');

  if (fetchError) {
    console.error('Error fetching vehicles:', fetchError.message);
    return;
  }

  console.log(`Found ${vehicles.length} vehicle(s)\n`);

  // Date ranges: some in the past (overdue), some upcoming, some far out
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);

  const oneYearFromNow = new Date(today);
  oneYearFromNow.setFullYear(today.getFullYear() + 1);

  let updated = 0;

  for (const vehicle of vehicles) {
    // Generate random dates
    // MOT due date (inspection) - mix of overdue, upcoming, and OK
    const motDueDate = randomDate(threeMonthsAgo, oneYearFromNow);

    // Tax due date (registration) - mix of overdue, upcoming, and OK
    const taxDueDate = randomDate(threeMonthsAgo, oneYearFromNow);

    const { error: updateError } = await supabase
      .from('vehicles')
      .update({
        mot_due_date: motDueDate,
        tax_due_date: taxDueDate,
      })
      .eq('id', vehicle.id);

    if (updateError) {
      console.error(`  ${vehicle.reg}: Error - ${updateError.message}`);
    } else {
      console.log(`  ${vehicle.reg}: MOT=${motDueDate}, Tax=${taxDueDate}`);
      updated++;
    }
  }

  console.log(`\nUpdated ${updated} vehicle(s) with inspection and registration dates!`);
}

main();
