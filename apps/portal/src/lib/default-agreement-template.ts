// Default Agreement Template
// A clean, minimal template that tenants can customize

export const DEFAULT_AGREEMENT_TEMPLATE = `# RENTAL AGREEMENT

**Date:** {{agreement_date}} | **Reference:** {{rental_number}}

---

## Parties

**Landlord:** {{company_name}}
{{company_email}} | {{company_phone}}

**Customer:** {{customer_name}}
{{customer_email}} | {{customer_phone}}
{{customer_address}}

---

## Vehicle

**Registration:** {{vehicle_reg}}
**Make & Model:** {{vehicle_make}} {{vehicle_model}} ({{vehicle_year}})

---

## Rental Terms

**Period:** {{rental_period_type}}
**Start Date:** {{rental_start_date}}
**End Date:** {{rental_end_date}}
**Amount:** {{monthly_amount}}

---

## Terms & Conditions

1. The Customer agrees to rent the vehicle described above for the specified period.
2. Payment is due on the agreed schedule. Late payments may incur additional charges.
3. The Customer will maintain the vehicle in good condition and return it as received.
4. The Customer is responsible for all damage during the rental period.
5. The vehicle must not be used for illegal purposes or sub-leased to others.
6. Adequate insurance coverage must be maintained throughout the rental.
7. Either party may terminate with appropriate notice per company policy.

---

## Signatures

**Customer Signature:** _________________________

**Date:** _________________________

**{{company_name}} Signature:** _________________________

**Date:** _________________________
`;

export const DEFAULT_TEMPLATE_NAME = 'Standard Rental Agreement';
