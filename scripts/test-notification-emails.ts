/**
 * Test Script for Notification Edge Functions
 *
 * This script tests all notification email functions to verify they properly use
 * tenant branding instead of hardcoded values.
 *
 * Usage:
 *   npx ts-node scripts/test-notification-emails.ts [function-name]
 *
 * Examples:
 *   npx ts-node scripts/test-notification-emails.ts                    # Run all tests
 *   npx ts-node scripts/test-notification-emails.ts booking-pending    # Run single test
 *
 * Environment Variables Required:
 *   SUPABASE_URL - Your Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for invoking functions
 *   TEST_TENANT_ID - Optional: Tenant ID to test with (tests branding)
 */

const TEST_EMAIL = 'ilyasghulam35@gmail.com';
const TEST_PHONE = '+15551234567';

// Get environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_TENANT_ID = process.env.TEST_TENANT_ID; // Optional - set to test with tenant branding

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables:');
  console.error('  SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// Generate unique booking reference
const generateBookingRef = () => `TEST-${Date.now().toString(36).toUpperCase()}`;

// Generate dates
const today = new Date();
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);
const nextWeek = new Date(today);
nextWeek.setDate(nextWeek.getDate() + 7);

const formatDate = (date: Date) => date.toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

// Test payloads for each notification function
const testPayloads: Record<string, any> = {
  'notify-booking-pending': {
    paymentId: `pi_test_${Date.now()}`,
    rentalId: `rental_test_${Date.now()}`,
    customerId: `cust_test_${Date.now()}`,
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Tesla Model 3',
    vehicleReg: 'TEST-123',
    vehicleMake: 'Tesla',
    vehicleModel: 'Model 3',
    vehicleYear: '2024',
    pickupDate: formatDate(tomorrow),
    returnDate: formatDate(nextWeek),
    amount: 1500,
    bookingRef: generateBookingRef(),
    tenantId: TEST_TENANT_ID,
  },

  'notify-booking-approved': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'BMW M4 Competition',
    vehicleReg: 'BMW-M4-24',
    vehicleMake: 'BMW',
    vehicleModel: 'M4 Competition',
    bookingRef: generateBookingRef(),
    pickupDate: formatDate(tomorrow),
    returnDate: formatDate(nextWeek),
    pickupLocation: '123 Test Street, Test City, TS 12345',
    amount: 2500,
    tenantId: TEST_TENANT_ID,
  },

  'notify-booking-rejected': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Mercedes-Benz C63 AMG',
    vehicleReg: 'AMG-C63',
    vehicleMake: 'Mercedes-Benz',
    vehicleModel: 'C63 AMG',
    bookingRef: generateBookingRef(),
    pickupDate: formatDate(tomorrow),
    returnDate: formatDate(nextWeek),
    reason: 'This is a test rejection - your documents could not be verified.',
    tenantId: TEST_TENANT_ID,
  },

  'notify-booking-cancelled': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Porsche 911 Carrera',
    vehicleReg: 'P911-24',
    vehicleMake: 'Porsche',
    vehicleModel: '911 Carrera',
    bookingRef: generateBookingRef(),
    pickupDate: formatDate(tomorrow),
    returnDate: formatDate(nextWeek),
    reason: 'This is a test cancellation - customer requested cancellation.',
    refundType: 'full' as const,
    refundAmount: 1800,
    tenantId: TEST_TENANT_ID,
  },

  'notify-rental-started': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Audi RS6 Avant',
    vehicleReg: 'RS6-2024',
    vehicleMake: 'Audi',
    vehicleModel: 'RS6 Avant',
    bookingRef: generateBookingRef(),
    startDate: formatDate(today),
    expectedReturnDate: formatDate(nextWeek),
    returnTime: '10:00 AM',
    returnLocation: '456 Return Drive, Test City, TS 12345',
    tenantId: TEST_TENANT_ID,
  },

  'notify-rental-completed': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Range Rover Sport',
    vehicleReg: 'RR-SPORT',
    vehicleMake: 'Range Rover',
    vehicleModel: 'Sport',
    bookingRef: generateBookingRef(),
    startDate: formatDate(today),
    endDate: formatDate(nextWeek),
    totalAmount: 3500,
    tenantId: TEST_TENANT_ID,
  },

  'notify-payment-failed': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    vehicleName: 'Lamborghini Huracan',
    vehicleReg: 'HURACAN',
    vehicleMake: 'Lamborghini',
    vehicleModel: 'Huracan',
    bookingRef: generateBookingRef(),
    amount: 5000,
    failureReason: 'Your card was declined. Please try a different payment method.',
    last4: '4242',
    tenantId: TEST_TENANT_ID,
  },

  'notify-refund-processed': {
    customerName: 'Test Customer',
    customerEmail: TEST_EMAIL,
    customerPhone: TEST_PHONE,
    bookingRef: generateBookingRef(),
    refundAmount: 750,
    refundType: 'partial' as const,
    originalAmount: 1500,
    refundReason: 'Partial refund for early return of vehicle.',
    expectedDays: 5,
    last4: '4242',
    tenantId: TEST_TENANT_ID,
  },
};

// Function to invoke an Edge Function
async function invokeFunction(functionName: string, payload: any): Promise<{ success: boolean; data?: any; error?: string }> {
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.error || `HTTP ${response.status}` };
    }

    return { success: true, data };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// Test a single notification function
async function testFunction(functionName: string): Promise<boolean> {
  const payload = testPayloads[functionName];

  if (!payload) {
    console.error(`  ❌ Unknown function: ${functionName}`);
    return false;
  }

  console.log(`\n📧 Testing: ${functionName}`);
  console.log(`   Booking Ref: ${payload.bookingRef}`);
  console.log(`   Email: ${TEST_EMAIL}`);
  if (TEST_TENANT_ID) {
    console.log(`   Tenant ID: ${TEST_TENANT_ID}`);
  } else {
    console.log(`   Tenant ID: (none - using default branding)`);
  }

  const result = await invokeFunction(functionName, payload);

  if (result.success) {
    console.log(`   ✅ Success!`);
    if (result.data?.results?.customerEmail) {
      const emailResult = result.data.results.customerEmail;
      if (emailResult.simulated) {
        console.log(`   📨 Email: Simulated (Resend not configured)`);
      } else if (emailResult.success) {
        console.log(`   📨 Email: Sent successfully`);
      } else {
        console.log(`   📨 Email: Failed - ${emailResult.error || 'Unknown error'}`);
      }
    }
    if (result.data?.results?.customerSMS) {
      const smsResult = result.data.results.customerSMS;
      if (smsResult.simulated) {
        console.log(`   📱 SMS: Simulated (AWS not configured)`);
      } else if (smsResult.success) {
        console.log(`   📱 SMS: Sent successfully`);
      }
    }
    return true;
  } else {
    console.log(`   ❌ Failed: ${result.error}`);
    return false;
  }
}

// Main test runner
async function runTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          NOTIFICATION EMAIL TEST SUITE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Test Email: ${TEST_EMAIL}`);
  console.log(`Supabase URL: ${SUPABASE_URL}`);
  console.log(`Tenant ID: ${TEST_TENANT_ID || '(not set - using default branding)'}`);
  console.log('');

  const functionArg = process.argv[2];
  let functionsToTest: string[];

  if (functionArg) {
    // Test specific function
    if (!testPayloads[functionArg]) {
      console.error(`Unknown function: ${functionArg}`);
      console.log('\nAvailable functions:');
      Object.keys(testPayloads).forEach(name => console.log(`  - ${name}`));
      process.exit(1);
    }
    functionsToTest = [functionArg];
  } else {
    // Test all functions
    functionsToTest = Object.keys(testPayloads);
  }

  console.log(`Running ${functionsToTest.length} test(s)...`);

  const results: Record<string, boolean> = {};

  for (const functionName of functionsToTest) {
    results[functionName] = await testFunction(functionName);
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Summary
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY                                ');
  console.log('═══════════════════════════════════════════════════════════════');

  const passed = Object.values(results).filter(Boolean).length;
  const failed = Object.values(results).filter(v => !v).length;

  Object.entries(results).forEach(([name, success]) => {
    console.log(`  ${success ? '✅' : '❌'} ${name}`);
  });

  console.log('');
  console.log(`Passed: ${passed}/${functionsToTest.length}`);
  console.log(`Failed: ${failed}/${functionsToTest.length}`);

  if (failed > 0) {
    process.exit(1);
  }

  console.log('\n📬 Check your inbox at ilyasghulam35@gmail.com for test emails!');
}

// Run tests
runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
