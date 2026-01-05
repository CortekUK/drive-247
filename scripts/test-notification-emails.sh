#!/bin/bash

# Test Notification Email Functions
#
# Usage:
#   ./scripts/test-notification-emails.sh [function-name]
#
# Examples:
#   ./scripts/test-notification-emails.sh                    # Show menu
#   ./scripts/test-notification-emails.sh booking-pending    # Test specific function
#   ./scripts/test-notification-emails.sh all                # Test all functions
#
# Environment Variables:
#   SUPABASE_URL - Your Supabase project URL (or set below)
#   SUPABASE_SERVICE_ROLE_KEY - Service role key
#   TEST_TENANT_ID - Optional tenant ID for branding tests

# Configuration
TEST_EMAIL="ilyasghulam35@gmail.com"
TEST_PHONE="+15551234567"
BOOKING_REF="TEST-$(date +%s | tail -c 8)"

# Load from .env.local if available
if [ -f ".env.local" ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

# Check required vars
if [ -z "$SUPABASE_URL" ] && [ -z "$NEXT_PUBLIC_SUPABASE_URL" ]; then
  echo "Error: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL not set"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY not set"
  exit 1
fi

SUPABASE_URL="${SUPABASE_URL:-$NEXT_PUBLIC_SUPABASE_URL}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          NOTIFICATION EMAIL TEST SUITE                       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Test Email: ${GREEN}$TEST_EMAIL${NC}"
echo -e "Supabase URL: $SUPABASE_URL"
echo -e "Tenant ID: ${TEST_TENANT_ID:-"(not set - using default branding)"}"
echo ""

# Function to call an edge function
call_function() {
  local fn_name=$1
  local payload=$2

  echo -e "\n${YELLOW}📧 Testing: $fn_name${NC}"
  echo "   Booking Ref: $BOOKING_REF"

  response=$(curl -s -X POST \
    "$SUPABASE_URL/functions/v1/$fn_name" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -d "$payload")

  # Check if response contains success
  if echo "$response" | grep -q '"success":true'; then
    echo -e "   ${GREEN}✅ Success!${NC}"

    # Check email result
    if echo "$response" | grep -q '"simulated":true'; then
      echo "   📨 Email: Simulated (Resend not configured)"
    elif echo "$response" | grep -q '"customerEmail"'; then
      echo "   📨 Email: Sent"
    fi

    return 0
  else
    echo -e "   ${RED}❌ Failed${NC}"
    echo "   Response: $response"
    return 1
  fi
}

# Test functions
test_booking_pending() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-booking-pending" "{
    \"paymentId\": \"pi_test_$(date +%s)\",
    \"rentalId\": \"rental_test_$(date +%s)\",
    \"customerId\": \"cust_test\",
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Tesla Model 3\",
    \"vehicleReg\": \"TEST-123\",
    \"vehicleMake\": \"Tesla\",
    \"vehicleModel\": \"Model 3\",
    \"pickupDate\": \"January 15, 2025\",
    \"returnDate\": \"January 22, 2025\",
    \"amount\": 1500,
    \"bookingRef\": \"$BOOKING_REF\",
    $tenant_id_field
    \"_test\": true
  }"
}

test_booking_approved() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-booking-approved" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"BMW M4 Competition\",
    \"vehicleReg\": \"BMW-M4-24\",
    \"vehicleMake\": \"BMW\",
    \"vehicleModel\": \"M4 Competition\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"pickupDate\": \"January 15, 2025\",
    \"returnDate\": \"January 22, 2025\",
    \"pickupLocation\": \"123 Test Street, Test City\",
    \"amount\": 2500,
    $tenant_id_field
    \"_test\": true
  }"
}

test_booking_rejected() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-booking-rejected" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Mercedes-Benz C63 AMG\",
    \"vehicleReg\": \"AMG-C63\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"reason\": \"Test rejection - documents could not be verified.\",
    $tenant_id_field
    \"_test\": true
  }"
}

test_booking_cancelled() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-booking-cancelled" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Porsche 911 Carrera\",
    \"vehicleReg\": \"P911-24\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"reason\": \"Test cancellation - customer requested.\",
    \"refundType\": \"full\",
    \"refundAmount\": 1800,
    $tenant_id_field
    \"_test\": true
  }"
}

test_rental_started() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-rental-started" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Audi RS6 Avant\",
    \"vehicleReg\": \"RS6-2024\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"startDate\": \"January 15, 2025\",
    \"expectedReturnDate\": \"January 22, 2025\",
    \"returnTime\": \"10:00 AM\",
    \"returnLocation\": \"456 Return Drive, Test City\",
    $tenant_id_field
    \"_test\": true
  }"
}

test_rental_completed() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-rental-completed" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Range Rover Sport\",
    \"vehicleReg\": \"RR-SPORT\",
    \"vehicleMake\": \"Range Rover\",
    \"vehicleModel\": \"Sport\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"startDate\": \"January 15, 2025\",
    \"endDate\": \"January 22, 2025\",
    \"totalAmount\": 3500,
    $tenant_id_field
    \"_test\": true
  }"
}

test_payment_failed() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-payment-failed" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"vehicleName\": \"Lamborghini Huracan\",
    \"vehicleReg\": \"HURACAN\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"amount\": 5000,
    \"failureReason\": \"Your card was declined.\",
    \"last4\": \"4242\",
    $tenant_id_field
    \"_test\": true
  }"
}

test_refund_processed() {
  local tenant_id_field=""
  [ -n "$TEST_TENANT_ID" ] && tenant_id_field="\"tenantId\": \"$TEST_TENANT_ID\","

  call_function "notify-refund-processed" "{
    \"customerName\": \"Test Customer\",
    \"customerEmail\": \"$TEST_EMAIL\",
    \"customerPhone\": \"$TEST_PHONE\",
    \"bookingRef\": \"$BOOKING_REF\",
    \"refundAmount\": 750,
    \"refundType\": \"partial\",
    \"originalAmount\": 1500,
    \"refundReason\": \"Partial refund for early return.\",
    \"expectedDays\": 5,
    \"last4\": \"4242\",
    $tenant_id_field
    \"_test\": true
  }"
}

# Show menu
show_menu() {
  echo "Available tests:"
  echo ""
  echo "  1) booking-pending     - New booking received"
  echo "  2) booking-approved    - Booking approved"
  echo "  3) booking-rejected    - Booking rejected"
  echo "  4) booking-cancelled   - Booking cancelled"
  echo "  5) rental-started      - Rental started"
  echo "  6) rental-completed    - Rental completed"
  echo "  7) payment-failed      - Payment failed"
  echo "  8) refund-processed    - Refund processed"
  echo ""
  echo "  a) all                 - Run all tests"
  echo "  q) quit"
  echo ""
  read -p "Select test to run: " choice

  case $choice in
    1|booking-pending) test_booking_pending ;;
    2|booking-approved) test_booking_approved ;;
    3|booking-rejected) test_booking_rejected ;;
    4|booking-cancelled) test_booking_cancelled ;;
    5|rental-started) test_rental_started ;;
    6|rental-completed) test_rental_completed ;;
    7|payment-failed) test_payment_failed ;;
    8|refund-processed) test_refund_processed ;;
    a|all) run_all_tests ;;
    q|quit) exit 0 ;;
    *) echo "Invalid option" ;;
  esac
}

# Run all tests
run_all_tests() {
  passed=0
  failed=0

  for test_fn in test_booking_pending test_booking_approved test_booking_rejected \
                 test_booking_cancelled test_rental_started test_rental_completed \
                 test_payment_failed test_refund_processed; do
    if $test_fn; then
      ((passed++))
    else
      ((failed++))
    fi
    sleep 0.5
  done

  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "                         SUMMARY                                "
  echo "═══════════════════════════════════════════════════════════════"
  echo -e "  ${GREEN}Passed: $passed${NC}"
  echo -e "  ${RED}Failed: $failed${NC}"
  echo ""
  echo -e "📬 Check your inbox at ${GREEN}$TEST_EMAIL${NC} for test emails!"
}

# Main
case "${1:-menu}" in
  booking-pending) test_booking_pending ;;
  booking-approved) test_booking_approved ;;
  booking-rejected) test_booking_rejected ;;
  booking-cancelled) test_booking_cancelled ;;
  rental-started) test_rental_started ;;
  rental-completed) test_rental_completed ;;
  payment-failed) test_payment_failed ;;
  refund-processed) test_refund_processed ;;
  all) run_all_tests ;;
  menu) show_menu ;;
  *)
    echo "Unknown function: $1"
    echo ""
    echo "Available functions:"
    echo "  booking-pending, booking-approved, booking-rejected,"
    echo "  booking-cancelled, rental-started, rental-completed,"
    echo "  payment-failed, refund-processed, all"
    exit 1
    ;;
esac
