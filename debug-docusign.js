#!/usr/bin/env node

// DocuSign Edge Function Monitor & Debugger
const supabaseUrl = 'https://hviqoaokxvlancmftwuo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2aXFvYW9reHZsYW5jbWZ0d3VvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIzNjM2NTcsImV4cCI6MjA3NzkzOTY1N30.jwpdtizfTxl3MeCNDu-mrLI7GNK4PYWYg5gsIZy0T_Q';

// Use the actual rental ID from your last booking
const rentalId = process.argv[2] || 'c4d5d113-4f2a-4f08-ab8b-e02cd575de43';

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║       DocuSign Edge Function Debug Monitor                ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

const testDocuSign = async () => {
    try {
        console.log('📋 Testing with Rental ID:', rentalId);
        console.log('🌐 Calling edge function...\n');

        const startTime = Date.now();
        const response = await fetch(`${supabaseUrl}/functions/v1/create-docusign-envelope`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseAnonKey}`,
            },
            body: JSON.stringify({ rentalId }),
        });

        const duration = Date.now() - startTime;

        console.log('⏱️  Response Time:', duration + 'ms');
        console.log('📊 Status Code:', response.status, response.statusText);
        console.log('');

        const data = await response.json();

        if (!response.ok) {
            console.log('❌ ERROR RESPONSE:');
            console.log('═'.repeat(60));
            console.log(JSON.stringify(data, null, 2));
            console.log('═'.repeat(60));
            console.log('');

            // Analyze the error
            if (data.detail) {
                console.log('🔍 ERROR DETAILS:');
                console.log('  Error:', data.error);
                console.log('  Detail:', data.detail);
                console.log('');

                // Provide suggestions
                if (data.detail.includes('JWT')) {
                    console.log('💡 SOLUTION: JWT consent not granted!');
                    console.log('   Visit this URL and click "Allow Access":');
                    console.log('   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=bf5bc694-96c6-4756-ae4c-cc23ba95374c&redirect_uri=https://developers.docusign.com/platform/auth/consent');
                } else if (data.detail.includes('environment')) {
                    console.log('💡 SOLUTION: Missing environment variables in Supabase');
                } else if (data.detail.includes('uuid')) {
                    console.log('💡 SOLUTION: Invalid rental ID format');
                } else if (data.detail.includes('not found')) {
                    console.log('💡 SOLUTION: Rental record does not exist');
                }
            }
        } else {
            console.log('✅ SUCCESS!');
            console.log('═'.repeat(60));
            console.log(JSON.stringify(data, null, 2));
            console.log('═'.repeat(60));
            console.log('');

            if (data.embeddedSigningUrl) {
                console.log('🔗 Signing URL:', data.embeddedSigningUrl);
            }
        }

    } catch (error) {
        console.error('\n💥 EXCEPTION:', error.message);
        console.error('Stack:', error.stack);
    }
};

console.log('Starting test...\n');
testDocuSign();
