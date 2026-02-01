#!/bin/bash
# Deploy all Stripe-related Edge Functions
# Run this after setting secrets and running migrations

set -e

echo "======================================"
echo "Deploying Stripe Edge Functions"
echo "======================================"
echo ""

FUNCTIONS=(
  "create-checkout-session"
  "create-preauth-checkout"
  "capture-booking-payment"
  "cancel-booking-preauth"
  "process-scheduled-refund"
  "stripe-webhook-test"
  "stripe-webhook-live"
  "get-stripe-config"
)

TOTAL=${#FUNCTIONS[@]}
CURRENT=0

for func in "${FUNCTIONS[@]}"; do
  CURRENT=$((CURRENT + 1))
  echo "[$CURRENT/$TOTAL] Deploying $func..."
  npx supabase functions deploy "$func" --no-verify-jwt
  echo "✅ $func deployed"
  echo ""
done

echo "======================================"
echo "All functions deployed successfully!"
echo "======================================"
echo ""
echo "Function URLs:"
for func in "${FUNCTIONS[@]}"; do
  echo "  https://hviqoaokxvlancmftwuo.supabase.co/functions/v1/$func"
done
echo ""
echo "Next step: Run ./scripts/test-stripe-mode.sh to verify"
