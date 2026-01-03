#!/usr/bin/env node

/**
 * Test Script for Veriff API Connection
 * This script tests the Veriff API key to ensure it's valid and can create sessions
 */

const VERIFF_API_KEY = 'e87ea632-3b71-468a-a4b8-a0f2a7598e2f';
const VERIFF_BASE_URL = 'https://stationapi.veriff.com';

async function testVeriffConnection() {
    console.log('🔍 Testing Veriff API Connection...\n');
    console.log(`API Key: ${VERIFF_API_KEY.substring(0, 8)}...${VERIFF_API_KEY.substring(VERIFF_API_KEY.length - 4)}`);
    console.log(`Base URL: ${VERIFF_BASE_URL}\n`);

    const requestBody = {
        verification: {
            person: {
                firstName: 'Test',
                lastName: 'User',
            },
            vendorData: `test_${Date.now()}`,
        }
    };

    try {
        console.log('📤 Sending POST request to /v1/sessions...');
        const response = await fetch(`${VERIFF_BASE_URL}/v1/sessions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-AUTH-CLIENT': VERIFF_API_KEY,
            },
            body: JSON.stringify(requestBody),
        });

        console.log(`\n📥 Response Status: ${response.status} ${response.statusText}`);

        const responseText = await response.text();
        console.log(`Response Body:\n${responseText}\n`);

        if (response.ok) {
            const data = JSON.parse(responseText);
            console.log('✅ SUCCESS! Veriff API key is valid.');
            console.log(`   Session ID: ${data.verification?.id}`);
            console.log(`   Session URL: ${data.verification?.url}`);
            return { success: true, data };
        } else {
            console.error('❌ FAILED! Veriff API returned an error.');
            console.error('   This could mean:');
            console.error('   1. The API key is invalid or expired');
            console.error('   2. The API key doesn\'t have the correct permissions');
            console.error('   3. The Veriff account is not properly configured');
            return { success: false, error: responseText };
        }
    } catch (error) {
        console.error('❌ NETWORK ERROR!');
        console.error(error);
        return { success: false, error };
    }
}

// Run the test
testVeriffConnection().then((result) => {
    console.log('\n' + '='.repeat(60));
    if (result.success) {
        console.log('✅ Veriff integration is configured correctly!');
        console.log('   The issue might be with environment variable setup in Supabase.');
    } else {
        console.log('❌ Veriff API test failed!');
        console.log('   Please check your API key and Veriff account configuration.');
    }
    console.log('='.repeat(60));
    process.exit(result.success ? 0 : 1);
});
