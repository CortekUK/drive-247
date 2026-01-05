import { supabase } from "@/integrations/supabase/client";

export interface PromoCodeValidation {
  valid: boolean;
  message: string;
  discount?: {
    type: 'percentage' | 'fixed';
    value: number;
    minimumSpend?: number;
  };
  promoId?: string;
}

export interface AppliedDiscount {
  originalPrice: number;
  discountAmount: number;
  finalPrice: number;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  promoCode: string;
}

export interface BadgeDiscount {
  type: 'percentage' | 'fixed';
  value: number;
  label: string;
  minimumSpend?: number;
}

/**
 * Parses the discount_amount string from the promo badge settings
 * Supports formats like "20%", "$50", "10", etc.
 */
export function parseBadgeDiscount(discountAmount: string | undefined): BadgeDiscount | null {
  if (!discountAmount || discountAmount.trim() === '') {
    return null;
  }

  const cleaned = discountAmount.trim();

  // Check if percentage (ends with % or contains %)
  if (cleaned.includes('%')) {
    const value = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    if (!isNaN(value) && value > 0 && value <= 100) {
      return { type: 'percentage', value, label: cleaned };
    }
  }

  // Check if fixed amount (starts with $ or is a number)
  if (cleaned.startsWith('$') || /^\d/.test(cleaned)) {
    const value = parseFloat(cleaned.replace(/[^0-9.]/g, ''));
    if (!isNaN(value) && value > 0) {
      return { type: 'fixed', value, label: cleaned };
    }
  }

  return null;
}

/**
 * Calculates the combined discount from badge and promo code
 * Badge discount is applied first, then promo code discount
 *
 * For fixed discounts: Only applies if the price meets the admin-set minimum spend
 * For percentage discounts: Also respects minimum spend if set
 */
export function calculateCombinedDiscount(
  originalPrice: number,
  badgeDiscount: BadgeDiscount | null,
  promoDiscount: { type: 'percentage' | 'fixed'; value: number; minimumSpend?: number } | null,
  promoCode: string
): AppliedDiscount {
  let currentPrice = originalPrice;
  let totalDiscountAmount = 0;

  // Apply badge discount first
  if (badgeDiscount) {
    let badgeDiscountAmount: number = 0;
    const badgeMinSpend = badgeDiscount.minimumSpend || 0;

    // Check minimum spend requirement
    if (currentPrice >= badgeMinSpend) {
      if (badgeDiscount.type === 'percentage') {
        badgeDiscountAmount = (currentPrice * badgeDiscount.value) / 100;
      } else {
        // Fixed discount: apply if price meets minimum spend
        badgeDiscountAmount = Math.min(badgeDiscount.value, currentPrice);
      }
    }
    totalDiscountAmount += badgeDiscountAmount;
    currentPrice -= badgeDiscountAmount;
  }

  // Apply promo code discount on the remaining price
  if (promoDiscount) {
    let promoDiscountAmount: number = 0;
    const promoMinSpend = promoDiscount.minimumSpend || 0;

    // Check minimum spend requirement (against original price for promo)
    if (originalPrice >= promoMinSpend) {
      if (promoDiscount.type === 'percentage') {
        promoDiscountAmount = (currentPrice * promoDiscount.value) / 100;
      } else {
        // Fixed discount: apply if original price meets minimum spend
        promoDiscountAmount = Math.min(promoDiscount.value, currentPrice);
      }
    }
    totalDiscountAmount += promoDiscountAmount;
    currentPrice -= promoDiscountAmount;
  }

  // Round to 2 decimal places
  totalDiscountAmount = Math.round(totalDiscountAmount * 100) / 100;
  const finalPrice = Math.round(currentPrice * 100) / 100;

  return {
    originalPrice,
    discountAmount: totalDiscountAmount,
    finalPrice: Math.max(0, finalPrice),
    discountType: promoDiscount?.type || badgeDiscount?.type || 'percentage',
    discountValue: promoDiscount?.value || badgeDiscount?.value || 0,
    promoCode: promoCode || (badgeDiscount ? 'SALE' : ''),
  };
}

/**
 * Validates a promo code against the database
 * Checks if code exists, is active, and is within valid date range
 */
export async function validatePromoCode(
  code: string,
  tenantId: string | null
): Promise<PromoCodeValidation> {
  if (!code || code.trim() === '') {
    return { valid: false, message: 'Please enter a promo code' };
  }

  const normalizedCode = code.trim().toUpperCase();

  try {
    // Build query
    let query = supabase
      .from('promotions')
      .select('*')
      .eq('promo_code', normalizedCode);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data: promo, error } = await query.maybeSingle();

    if (error) {
      console.error('Promo code lookup error:', error);
      return { valid: false, message: 'Unable to validate promo code. Please try again.' };
    }

    if (!promo) {
      return { valid: false, message: 'Invalid promo code' };
    }

    // Check if promo is active
    if (!promo.is_active) {
      return { valid: false, message: 'This promo code is no longer active' };
    }

    // Check date validity
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const startDate = new Date(promo.start_date);
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(promo.end_date);
    endDate.setHours(23, 59, 59, 999);

    if (today < startDate) {
      return { valid: false, message: 'This promo code is not yet active' };
    }

    if (today > endDate) {
      return { valid: false, message: 'This promo code has expired' };
    }

    // Valid promo code
    return {
      valid: true,
      message: `${promo.title} - ${promo.discount_type === 'percentage' ? `${promo.discount_value}% off` : `$${promo.discount_value} off`}`,
      discount: {
        type: promo.discount_type as 'percentage' | 'fixed',
        value: promo.discount_value,
        minimumSpend: promo.minimum_spend || 0,
      },
      promoId: promo.id,
    };
  } catch (err) {
    console.error('Promo code validation error:', err);
    return { valid: false, message: 'Unable to validate promo code. Please try again.' };
  }
}

/**
 * Calculates the discounted price based on the promo code
 *
 * For fixed/percentage discounts: Only applies if the price meets admin-set minimum spend
 */
export function calculateDiscount(
  originalPrice: number,
  discount: { type: 'percentage' | 'fixed'; value: number; minimumSpend?: number },
  promoCode: string
): AppliedDiscount {
  let discountAmount: number = 0;
  const minSpend = discount.minimumSpend || 0;

  // Check minimum spend requirement
  if (originalPrice >= minSpend) {
    if (discount.type === 'percentage') {
      discountAmount = (originalPrice * discount.value) / 100;
    } else {
      // Fixed discount: apply full amount (capped at original price)
      discountAmount = Math.min(discount.value, originalPrice);
    }
  }

  // Round to 2 decimal places
  discountAmount = Math.round(discountAmount * 100) / 100;
  const finalPrice = Math.round((originalPrice - discountAmount) * 100) / 100;

  return {
    originalPrice,
    discountAmount,
    finalPrice,
    discountType: discount.type,
    discountValue: discount.value,
    promoCode,
  };
}
