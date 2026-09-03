/**
 * Human label for identity_verifications.verification_provider.
 *
 * This used to be an inline ternary that labelled anything other than 'ai' with a
 * single hard-coded vendor name, so the CMD rows were shown under the wrong brand.
 * The label now derives from the stored value, and an unrecognised provider falls
 * back to the raw value rather than being mislabelled as some other vendor.
 */
const PROVIDER_LABELS: Record<string, string> = {
  ai: "AI Verification",
  cmd: "CheckMyDriver",
};

export function formatVerificationProvider(provider?: string | null): string {
  if (!provider) return "Unknown";
  return PROVIDER_LABELS[provider.trim().toLowerCase()] ?? provider;
}
