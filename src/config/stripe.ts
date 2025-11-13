import { loadStripe } from '@stripe/stripe-js';

// Initialize Stripe with your publishable key
// TODO: Move this to environment variable
export const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ||
  'pk_test_51OpazCHw4aNq4gdLwqocQbL63yx3IiQHUtQAUvR8oKI9zD2wLStLgx64lUOnmZ2y7TCgwayOM2rlr6K1oKman9Ht00Ecl9KJP9'
);
