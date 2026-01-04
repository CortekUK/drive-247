// Test script to debug DocuSign edge function
const testDocuSign = async () => {
    const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
    const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

    // Use a test rental ID - replace with actual one from your DB
    const testRentalId = 'test-rental-id-123';

    try {
        console.log('Calling DocuSign edge function...');
        console.log('Rental ID:', testRentalId);

        const response = await fetch(`${supabaseUrl}/functions/v1/create-docusign-envelope`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({
                rentalId: testRentalId,
            }),
        });

        console.log('\nResponse status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        const data = await response.json();
        console.log('\nResponse body:', JSON.stringify(data, null, 2));

        if (!response.ok) {
            console.error('\n❌ Error:', data);
        } else {
            console.log('\n✅ Success!', data);
        }

    } catch (error) {
        console.error('\n❌ Exception:', error);
    }
};

testDocuSign();
