# Stripe Payment Integration Setup Guide

## Overview
This application integrates Stripe for secure payment processing using Supabase Edge Functions.

---

## Step 1: Get Stripe API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Create an account or log in
3. Navigate to **Developers** → **API keys**
4. Copy your keys:
   - **Publishable key** (starts with `pk_test_` or `pk_live_`)
   - **Secret key** (starts with `sk_test_` or `sk_live_`)

---

## Step 2: Configure Environment Variables

### Frontend (.env file)

Create or update your `.env` file in the project root:

```bash
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

### Backend (Supabase Edge Function)

Set the Stripe secret key as a Supabase secret:

```bash
# Install Supabase CLI if you haven't
npm install -g supabase

# Login to Supabase
supabase login

# Link your project
supabase link --project-ref your-project-ref

# Set the Stripe secret key as a secret
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_secret_key_here
```

---

## Step 3: Deploy Supabase Edge Function

Deploy the `create-checkout-session` function:

```bash
supabase functions deploy create-checkout-session
```

---

## Step 4: Update Database Schema

Add a `payment_status` column to the `bookings` table if it doesn't exist:

```sql
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';

-- Add an index for better query performance
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status
ON bookings(payment_status);
```

---

## Step 5: Test the Integration

### Test Mode (Recommended for Development)

Use Stripe test cards:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`

Use any future expiry date, any 3-digit CVC, and any billing ZIP code.

### Test the Flow

1. Navigate to the booking form
2. Fill in all required details
3. Click "Confirm Booking"
4. You'll be redirected to Stripe Checkout
5. Use test card `4242 4242 4242 4242`
6. Complete payment
7. You'll be redirected to `/booking-success`

---

## Payment Flow

```
User fills booking form
  ↓
Clicks "Confirm Booking"
  ↓
Booking saved to database (status: pending)
  ↓
Edge Function creates Stripe Checkout Session
  ↓
User redirected to Stripe Checkout page
  ↓
User enters payment details
  ↓
Payment processed by Stripe
  ↓
Success → /booking-success
Cancel → /booking-cancelled
```

---

## Webhook Setup (Optional but Recommended)

To automatically update booking status after payment:

1. Go to Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL to: `https://your-project.supabase.co/functions/v1/stripe-webhook`
4. Select events to listen to:
   - `checkout.session.completed`
   - `checkout.session.expired`
5. Copy the webhook signing secret
6. Set it as a Supabase secret:

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

7. Create a new edge function `stripe-webhook` to handle events

---

## Going to Production

When ready to accept real payments:

1. **Complete Stripe account verification**
2. **Replace test keys with live keys**:
   - Update `VITE_STRIPE_PUBLISHABLE_KEY` with `pk_live_...`
   - Update `STRIPE_SECRET_KEY` with `sk_live_...`
3. **Test thoroughly** in production environment
4. **Set up webhooks** for production

---

## Security Checklist

- ✅ Never expose secret keys in frontend code
- ✅ Always use HTTPS in production
- ✅ Validate payment amounts on the backend
- ✅ Set up webhook signature verification
- ✅ Store sensitive keys in environment variables
- ✅ Add `.env` to `.gitignore`

---

## Troubleshooting

### "Failed to create checkout session"

- Check if Supabase Edge Function is deployed
- Verify `STRIPE_SECRET_KEY` is set correctly
- Check Supabase function logs: `supabase functions logs create-checkout-session`

### Payment successful but booking not updated

- Set up Stripe webhooks to handle payment confirmation
- Check database permissions

### CORS errors

- The Edge Function includes CORS headers
- Make sure your frontend origin is allowed

---

## Support

For issues related to:
- **Stripe Integration**: [Stripe Docs](https://stripe.com/docs)
- **Supabase Functions**: [Supabase Docs](https://supabase.com/docs/guides/functions)
- **This Implementation**: Check the codebase or contact support

---

## Files Modified

- `src/config/stripe.ts` - Stripe initialization
- `src/components/MultiStepBookingWidget.tsx` - Payment integration
- `src/pages/BookingSuccess.tsx` - Success page
- `src/pages/BookingCancelled.tsx` - Cancellation page
- `supabase/functions/create-checkout-session/index.ts` - Edge function
- `src/App.tsx` - Routes added

---

## Cost Estimation

Stripe fees (as of 2024):
- 2.9% + $0.30 per successful card charge (US)
- Fees vary by country and payment method

Check [Stripe Pricing](https://stripe.com/pricing) for accurate, up-to-date information.
