#!/bin/bash
# Automated Test Script for Stripe Per-Tenant Mode Implementation
# This script verifies the Stripe mode implementation is working correctly

set -e

# Colors for output
GREEN='\033[0.32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SUPABASE_URL="https://hviqoaokxvlancmftwuo.supabase.co"
SUPABASE_SERVICE_KEY="sbp_6b139d9d0f78dd93e75f3683c8cfa4a5fc31f366"
TEST_TENANT_SLUG="drive-247"  # Change to your test tenant

echo "======================================"
echo "Stripe Per-Tenant Mode Test Suite"
echo "======================================"
echo ""

# Test 1: Get Stripe Config for Test Mode
echo "Test 1: Get Stripe Config (Test Mode)"
echo "--------------------------------------"
RESPONSE=$(curl -s -X POST "$SUPABASE_URL/functions/v1/get-stripe-config" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -d "{\"tenantSlug\":\"$TEST_TENANT_SLUG\"}")

if echo "$RESPONSE" | grep -q "publishableKey"; then
  MODE=$(echo "$RESPONSE" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
  PUB_KEY=$(echo "$RESPONSE" | grep -o '"publishableKey":"[^"]*"' | cut -d'"' -f4)
  echo -e "${GREEN}✓ PASSED${NC}"
  echo "  Mode: $MODE"
  echo "  Publishable Key: ${PUB_KEY:0:20}..."
else
  echo -e "${RED}✗ FAILED${NC}"
  echo "  Response: $RESPONSE"
  exit 1
fi
echo ""

# Test 2: Verify Database Schema
echo "Test 2: Verify Database Schema"
echo "--------------------------------------"
# This would require psql or supabase CLI
echo -e "${YELLOW}⚠ MANUAL CHECK REQUIRED${NC}"
echo "  Run: SELECT stripe_mode FROM tenants LIMIT 1;"
echo "  Expected: Column exists and returns 'test' or 'live'"
echo ""

# Test 3: Check Environment Variables
echo "Test 3: Check Environment Variables"
echo "--------------------------------------"
if [ -z "$STRIPE_TEST_SECRET_KEY" ]; then
  echo -e "${YELLOW}⚠ WARNING${NC}: STRIPE_TEST_SECRET_KEY not set in local env"
  echo "  (This is OK - secrets are in Supabase)"
else
  echo -e "${GREEN}✓ PASSED${NC}: Local env vars detected"
fi
echo ""

# Test 4: Verify Webhook Endpoints
echo "Test 4: Verify Webhook Endpoints"
echo "--------------------------------------"
TEST_WEBHOOK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  "$SUPABASE_URL/functions/v1/stripe-webhook-test")
LIVE_WEBHOOK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
  "$SUPABASE_URL/functions/v1/stripe-webhook-live")

if [ "$TEST_WEBHOOK_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ Test webhook endpoint${NC}: $SUPABASE_URL/functions/v1/stripe-webhook-test"
else
  echo -e "${RED}✗ Test webhook endpoint not responding${NC} (HTTP $TEST_WEBHOOK_STATUS)"
fi

if [ "$LIVE_WEBHOOK_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ Live webhook endpoint${NC}: $SUPABASE_URL/functions/v1/stripe-webhook-live"
else
  echo -e "${RED}✗ Live webhook endpoint not responding${NC} (HTTP $LIVE_WEBHOOK_STATUS)"
fi
echo ""

# Test 5: Check Edge Function Deployment
echo "Test 5: Check Edge Function Deployment"
echo "--------------------------------------"
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

for func in "${FUNCTIONS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS \
    "$SUPABASE_URL/functions/v1/$func")
  if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓${NC} $func"
  else
    echo -e "${RED}✗${NC} $func (HTTP $STATUS)"
  fi
done
echo ""

# Summary
echo "======================================"
echo "Test Suite Complete"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Verify Stripe Dashboard webhooks are configured"
echo "2. Run manual payment test with test card (4242 4242 4242 4242)"
echo "3. Check function logs: supabase functions logs <function-name> --tail"
echo "4. Review STRIPE_MODE_TESTING.md for detailed test procedures"
echo ""
