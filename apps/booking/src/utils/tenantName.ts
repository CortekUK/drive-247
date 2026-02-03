/**
 * Utility for replacing default/generic company names with the tenant's actual name.
 * This ensures CMS content that contains "Drive247" or "Drive 247" is dynamically
 * replaced with the current tenant's app_name.
 */

// Default company names that should be replaced with the tenant's actual name
const DEFAULT_COMPANY_NAMES = [
  'Drive247',
  'Drive 247',
  'drive247',
  'drive 917',
];

/**
 * Replaces default company names (Drive247, Drive 247) with the tenant's actual app_name.
 * This is used when displaying CMS content to ensure tenant branding is correct.
 *
 * @param text - The text to process (can be undefined/null)
 * @param tenantAppName - The tenant's app_name to use as replacement
 * @returns The processed text with company names replaced, or empty string if text is falsy
 */
export const replaceCompanyName = (
  text: string | undefined | null,
  tenantAppName: string
): string => {
  if (!text) return '';

  // Replace various forms of the default company name with tenant's app_name
  // Using case-insensitive regex to catch all variations
  return text
    .replace(/Drive\s*917/gi, tenantAppName)
    .replace(/Drive247/gi, tenantAppName);
};

/**
 * Creates a bound version of replaceCompanyName for a specific tenant.
 * Useful in components where you need to call it multiple times.
 *
 * @param tenantAppName - The tenant's app_name
 * @returns A function that takes text and returns it with company names replaced
 */
export const createCompanyNameReplacer = (tenantAppName: string) => {
  return (text: string | undefined | null): string => {
    return replaceCompanyName(text, tenantAppName);
  };
};
