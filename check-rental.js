#!/usr/bin/env node

// Check if rental exists in database
const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjM2MzY1NywiZXhwIjoyMDc3OTM5NjU3fQ.YXJZhab8SdxNJKmGVDMn_XlzcpFirN7mEYbupA9KJqw';

const rentalId = process.argv[2] || 'c4d5d113-4f2a-4f08-ab8b-e02cd575de43';

console.log('🔍 Checking if rental exists in database...\n');
console.log('Rental ID:', rentalId);
console.log('');

const checkRental = async () => {
    try {
        const response = await fetch(`${supabaseUrl}/rest/v1/rentals?id=eq.${rentalId}&select=*,customers:customer_id(id,name,email),vehicles:vehicle_id(id,reg,make,model)`, {
            headers: {
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`,
            },
        });

        const data = await response.json();

        if (data && data.length > 0) {
            console.log('\u2705 Rental EXISTS in database!');
            console.log('');
            console.log('Rental Data:');
            console.log(JSON.stringify(data[0], null, 2));
        } else {
            console.log('\u274c Rental NOT FOUND in database!');
            console.log('');
            console.log('Possible reasons:');
            console.log('1. Rental was not created');
            console.log('2. Rental ID is incorrect');
            console.log('3. Database connection issue');
        }
    } catch (error) {
        console.error('\u274c Error:', error.message);
    }
};

checkRental();
