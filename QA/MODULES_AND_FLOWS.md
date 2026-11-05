# Modules and Flows

The full list of what gets QA'd. Draft — may change. Details for each one (surfaces,
dependencies, order) are in `MASTER_PLAN.md`; how to test is in `QA_GUIDE.md`.

Every module and flow is tested **end to end across every app**: landing page, super
admin, operator portal, booking site, customer portal, plus backend and outgoing
messages.

## Modules (17)

| ID | Module |
|---|---|
| M1 | Auth & roles |
| M2 | Pricing engine |
| M3 | Uploads & storage |
| M4 | Email notifications (incl. codes / OTP and auth emails) |
| M5 | SMS |
| M6 | Push & in-app notifications (in-app follows push settings) |
| M7 | Platform billing (Drive247 charging operators) |
| M8 | Booking payments (Stripe Connect) |
| M9 | Square payments |
| M10 | BoldSign agreements |
| M11 | Bonzah insurance |
| M12 | ID verification |
| M13 | Accounting (Xero / Zoho) |
| M14 | Turo bridge |
| M15 | Realtime messaging |
| M16 | Promo & referral codes |
| M17 | Tenant provisioning |

## Flows (23)

### A. Platform
| ID | Flow |
|---|---|
| F1 | Onboarding |
| F2 | Subscription lifecycle |
| F3 | Super admin tenant management |

### B. Operator setup
| ID | Flow |
|---|---|
| F4 | Settings & branding |
| F5 | Add vehicle |
| F6 | Add customer + ID check |
| F7 | Staff users & permissions |

### C. Rental lifecycle
| ID | Flow |
|---|---|
| F8 | Create rental (portal) |
| F9 | Customer booking (booking site) |
| F10 | Handover (in person / lockbox) |
| F11 | Extension |
| F12 | Return & close + review |
| F13 | Cancel & refund |
| F14 | Invoices, fines, payments |

### D. Communication
| ID | Flow |
|---|---|
| F15 | Messages |
| F16 | Announcements |
| F17 | Notifications & reminders |

### E. Money & reports
| ID | Flow |
|---|---|
| F18 | Finances, insights, P&L, reports |
| F19 | Expenses |

### F. Customer side
| ID | Flow |
|---|---|
| F20 | Customer portal |

### G. Growth
| ID | Flow |
|---|---|
| F21 | Referrals & promo codes |
| F22 | CMS / booking site editing |
| F23 | Leads, enquiries, quotes |
