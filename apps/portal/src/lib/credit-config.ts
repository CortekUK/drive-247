export const CREDIT_CONFIG = {
  CREDIT_PRICE_USD: 0.20,
  DEFAULT_TEST_CREDITS: 1000,
  SERVICES: {
    esign: [
      { name: 'e-sign', cost: 7, trigger: 'send_esign' },
    ],
    twilio: [
      { name: 'twilio-message', cost: 2, trigger: 'send_twilio_message' },
    ],
    verification: [
      { name: 'license-verification', cost: 31, trigger: 'verify_license' },
    ],
  },
} as const;

export function getServiceCost(category: string, trigger?: string) {
  const services = CREDIT_CONFIG.SERVICES[category as keyof typeof CREDIT_CONFIG.SERVICES];
  if (!services) return null;
  if (trigger) return services.find(s => s.trigger === trigger) ?? services[0];
  return services[0];
}
