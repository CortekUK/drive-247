// feat-003: the consent words shown on the renter's page (spec 06.8 to 06.11). The version saved on the
// session says which words the renter saw. Change the words, change the version.
// The driving and criminal record words are placeholders until a lawyer approves them (PRD rules);
// those two checks are switched off until then.

export const CONSENT_VERSION = "2026-11-28.v1";

export function standardConsent(company: string): string {
  return `${company} uses Drive247 and our identity partner Didit to check your driving licence. ` +
    `You will photograph the front and back of your licence and take a short selfie. We compare the selfie ` +
    `with the photo on your licence to confirm it is you, and check the licence is genuine and in date. ` +
    `${company} keeps the result and the photos for as long as you are their customer.`;
}

export function licenceStatusConsentLine(company: string): string {
  return `${company} will also ask your state whether your licence is valid.`;
}

export const PREMIUM_CONSENT: Record<string, (company: string) => string> = {
  driving_record: (company) =>
    `I agree that ${company} may obtain my driving record (motor vehicle report) from the state through ` +
    `Drive247 and its provider, for deciding whether to rent me a vehicle.`,
  criminal_record: (company) =>
    `I agree that ${company} may obtain a criminal background check on me through Drive247 and its ` +
    `provider, for deciding whether to rent me a vehicle.`,
};
