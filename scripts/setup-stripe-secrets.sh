#!/bin/bash
# Setup Stripe Secrets in Supabase
# Run this script to configure all Stripe environment variables

set -e

echo "======================================"
echo "Stripe Secrets Setup"
echo "======================================"
echo ""

# Check if Supabase CLI is available
if ! command -v supabase &> /dev/null; then
    echo "Supabase CLI not found. Installing via npx..."
    alias supabase='npx supabase'
fi

# Link to project if not already linked
if [ ! -d ".supabase" ]; then
    echo "Linking to Supabase project..."
    echo "You'll need your project reference (from Supabase dashboard)"
    npx supabase link --project-ref hviqoaokxvlancmftwuo
fi

echo "Setting Stripe secrets..."
echo ""

# Test Mode Keys
echo "1/8 Setting STRIPE_TEST_SECRET_KEY..."
npx supabase secrets set STRIPE_TEST_SECRET_KEY=sk_test_your_test_secret_key_here

echo "2/8 Setting STRIPE_TEST_PUBLISHABLE_KEY..."
npx supabase secrets set STRIPE_TEST_PUBLISHABLE_KEY=pk_test_your_test_publishable_key_here

echo "3/8 Setting STRIPE_TEST_CONNECT_ACCOUNT_ID..."
npx supabase secrets set STRIPE_TEST_CONNECT_ACCOUNT_ID=acct_your_test_connect_account_id

echo "4/8 Setting STRIPE_TEST_WEBHOOK_SECRET..."
npx supabase secrets set STRIPE_TEST_WEBHOOK_SECRET=whsec_your_test_webhook_secret_here

# Live Mode Keys
echo "5/8 Setting STRIPE_LIVE_SECRET_KEY..."
npx supabase secrets set STRIPE_LIVE_SECRET_KEY=sk_live_your_live_secret_key_here

echo "6/8 Setting STRIPE_LIVE_PUBLISHABLE_KEY..."
npx supabase secrets set STRIPE_LIVE_PUBLISHABLE_KEY=pk_live_your_live_publishable_key_here

echo "7/8 Setting STRIPE_LIVE_WEBHOOK_SECRET..."
npx supabase secrets set STRIPE_LIVE_WEBHOOK_SECRET=whsec_your_live_webhook_secret_here

echo "8/8 Setting STRIPE_CONNECT_WEBHOOK_SECRET..."
npx supabase secrets set STRIPE_CONNECT_WEBHOOK_SECRET=whsec_your_connect_webhook_secret_here

echo ""
echo "✅ All Stripe secrets configured successfully!"
echo ""
echo "Next steps:"
echo "1. Run: npx supabase db push"
echo "2. Deploy functions (see deploy-functions.sh)"
