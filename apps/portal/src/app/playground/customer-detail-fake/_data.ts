/* ─────────────────────────────────────────────────────────────────────────────
 * Playground · customer control centre — the fake record
 *
 * NOTHING HERE IS REAL. No Supabase, no tenant, no auth, no network.
 *
 * The SHAPE, however, is real: every field below maps to a column that exists
 * in production today, and the two staleness cases the screen is built around
 * are both computable from live tables with no migration:
 *
 *   1. `identity_verifications` stores document_number, document_expiry_date,
 *      first_name, last_name, date_of_birth and address — the values extracted
 *      AT VERIFICATION TIME. Diffing them against the live `customers` row IS
 *      the drift. Nothing has to be snapshotted; it already was.
 *   2. `customer_review_summaries` carries total_reviews / average_rating /
 *      generated_at beside the paragraph, so a summary written before the
 *      newest review can say so itself.
 *
 * An earlier pass of this screen invented `marketing` and `preferred contact`
 * toggles, collapsed blocking into one switch, and modelled documents as four
 * fixed slots. None of those exist. Consent is `sms_consent` + `whatsapp_opt_in`;
 * blocking has TWO blast radii; and verification evidence (provider-owned,
 * immutable) is a different table from customer documents (operator-uploaded,
 * expiry-tracked). The corrections are the point of this file.
 * ────────────────────────────────────────────────────────────────────────── */

/* ── the clock ──────────────────────────────────────────────────────────── */

/**
 * The day this sandbox believes it is.
 *
 * Deliberately a constant, not `new Date()`. Two reasons, and the second is the
 * one that bites:
 *
 *   Determinism. Every relative label on the screen — "Expires in 25d",
 *   "Expired 35d ago" — is measured from here, so the sandbox looks identical
 *   every time it is opened. With a live clock the fixtures rot silently: the
 *   flagged insurance certificate below expires 2026-09-30, so on that date the
 *   Documents panel would quietly go from "1 expired" to "2 expired" and the
 *   screen would start arguing a different case than the one it was built to
 *   argue, with no commit to explain it.
 *
 *   Hydration. `new Date()` read during render runs once on the server and
 *   again on the client. Same day, same string — until it is not, and then it
 *   is a mismatch warning for no benefit at all. The rental sandbox next door
 *   documents the same trap.
 *
 * Move this forward when the fixtures are refreshed, and the whole screen moves
 * with it consistently.
 */
export const TODAY = "2026-09-05";

/* ── the rail ───────────────────────────────────────────────────────────── */

export type TabId =
  // The person — what an operator types in
  | "identity"
  | "licence"
  | "documents"
  // Standing — what has been decided about them
  | "verification"
  | "account"
  | "consent"
  // History — what they have actually done
  | "rentals"
  | "money"
  | "fines"
  | "reviews"
  | "activity";

/* ── the person ─────────────────────────────────────────────────────────── */

export type NextOfKin = {
  name: string;
  relationship: string;
  phone: string;
  email: string;
  address: string;
};

export type Identity = {
  name: string;
  email: string;
  phone: string;
  dob: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
  /** `customers.customer_type`. 520 of 521 live rows are Individual — but the
   *  one Company row still has to render, and it needs two extra fields. */
  customerType: "Individual" | "Company";
  companyName: string;
  companyRegistration: string;
  nok: NextOfKin;
};

export type Licence = {
  number: string;
  /** `license_state` — a US state code, not a country. */
  state: string;
  idNumber: string;
  issued: string;
  expiry: string;
  isGigDriver: boolean;
  /** `gig_driver_images` — proof of the rideshare platform, for insurance. */
  gigProofs: { id: string; label: string }[];
};

/* ── documents ──────────────────────────────────────────────────────────── */

/** `customer_documents.document_type`. */
export type DocType =
  | "Driving licence"
  | "Proof of address"
  | "Insurance certificate"
  | "Passport"
  | "Employment letter"
  | "Other";

export type Doc = {
  id: string;
  type: DocType;
  name: string;
  /** Documents can be scoped to one car — an insurance cert usually is. */
  vehicle: string | null;
  /** `start_date` / `end_date`. Null for documents that never expire. */
  from: string | null;
  until: string | null;
  verified: boolean;
  uploadedAt: string;
  /** The AI scan pipeline: ai_scan_status / ai_confidence_score / review_reasons. */
  scan: {
    status: "none" | "scanning" | "passed" | "flagged";
    confidence: number | null;
    reasons: string[];
  };
};

/* ── verification ───────────────────────────────────────────────────────── */

/**
 * What the provider read off the document at the moment it issued its verdict.
 * This is the snapshot the drift banner compares against — and in production it
 * is not something we have to store, because `identity_verifications` already
 * holds exactly these columns.
 */
export type Extracted = {
  documentNumber: string;
  documentExpiry: string;
  firstName: string;
  lastName: string;
  dob: string;
  address: string;
};

export type AiVerification = {
  state: "none" | "pending" | "passed" | "declined";
  completedAt: string | null;
  /** `ai_face_match_score`, 0–100. */
  faceMatchScore: number | null;
  /** Provider-owned evidence. NOT customer documents — different table, and
   *  the operator cannot edit or replace these. */
  photos: { face: boolean; selfie: boolean; docFront: boolean; docBack: boolean };
  extracted: Extracted | null;
  declineReason: string | null;
};

/** CheckMyDriver (Modives). A second provider, with its own verdict, its own
 *  status vocabulary and a magic link the customer has to open themselves. */
export type CmdVerification = {
  state: "none" | "awaiting" | "valid" | "invalid" | "expired";
  holder: string;
  number: string;
  expires: string;
  place: string;
  lastEventAt: string | null;
  linkExpiresAt: string | null;
  channels: ("email" | "sms" | "whatsapp")[];
  documents: number;
};

/* ── account standing ───────────────────────────────────────────────────── */

/** `blocked_identities` — the GLOBAL list. Blocking here reaches every operator
 *  on the platform, which is a different decision from blocking on your own. */
export type GlobalBlock = {
  id: string;
  kind: "licence" | "id" | "email";
  value: string;
  reason: string;
  addedAt: string;
};

export type Account = {
  /** `customers.status`. */
  status: "Active" | "Inactive" | "Rejected";
  rejection: { reason: string; by: string; at: string } | null;
  /** `customers.is_blocked` — this tenant only. */
  blockedHere: { reason: string; at: string } | null;
  globalBlocks: GlobalBlock[];
};

/* ── consent ────────────────────────────────────────────────────────────── */

/**
 * Not preferences — evidence. A2P 10DLC carriers have rejected this platform's
 * campaigns over exactly this, so the timestamp is as load-bearing as the flag.
 */
export type Consent = {
  sms: boolean;
  smsAt: string | null;
  /** How the consent was captured, which is what a carrier actually asks for. */
  smsSource: string | null;
  whatsapp: boolean;
};

/* ── history ────────────────────────────────────────────────────────────── */

export type Rental = {
  id: string;
  ref: string;
  vehicle: string;
  reg: string;
  start: string;
  end: string;
  total: number;
  outstanding: number;
  status: "Active" | "Completed" | "Cancelled";
};

export type LedgerRow = {
  id: string;
  date: string;
  label: string;
  ref: string | null;
  kind: "charge" | "payment" | "refund";
  amount: number;
  /** Money that arrived but has not been pointed at a charge yet. FIFO applies
   *  it oldest-first, and until it does it sits on the account as credit. */
  unallocated?: number;
};

export type PaymentLink = {
  id: string;
  label: string;
  amount: number;
  status: "Open" | "Paid" | "Void";
  sentAt: string;
};

export type Fine = {
  id: string;
  type: "Parking citation" | "Speeding" | "Toll" | "Congestion charge";
  reference: string;
  vehicle: string;
  amount: number;
  issuedOn: string;
  dueOn: string;
  status: "Unpaid" | "Paid" | "Disputed" | "Transferred";
  liability: "Individual" | "Company";
};

export type Review = {
  id: string;
  rating: number;
  comment: string;
  tags: string[];
  by: string;
  at: string;
  rentalRef: string;
};

/** `customer_review_summaries`. `basedOn` and `avg` are what the paragraph was
 *  written from — they ARE the staleness test, so they live beside the text. */
export type ReviewSummary = {
  text: string;
  basedOn: number;
  avg: number;
  generatedAt: string;
};

export type ActivityEvent = { label: string; at?: string; done: boolean };

/* ── the whole record ───────────────────────────────────────────────────── */

export type CustomerState = {
  identity: Identity;
  licence: Licence;
  docs: Doc[];
  ai: AiVerification;
  cmd: CmdVerification;
  account: Account;
  consent: Consent;
  rentals: Rental[];
  ledger: LedgerRow[];
  card: { brand: string; last4: string; exp: string } | null;
  links: PaymentLink[];
  fines: Fine[];
  reviews: Review[];
  summary: ReviewSummary | null;
  events: ActivityEvent[];
};

/* ── constants the panels share ─────────────────────────────────────────── */

export const DOC_TYPES: DocType[] = [
  "Driving licence",
  "Proof of address",
  "Insurance certificate",
  "Passport",
  "Employment letter",
  "Other",
];

export const REVIEW_TAGS = [
  "Clean return",
  "Communicative",
  "Late return",
  "Smoking",
  "Trusted",
  "Repeat renter",
  "Damage",
  "Payment chased",
];

export const US_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

/* ── the record this screen opens on ────────────────────────────────────── */

export const demoCustomer = (): CustomerState => ({
  identity: {
    name: "Marcus Adeyemi",
    email: "marcus.adeyemi@gmail.com",
    phone: "+1 (904) 555-0142",
    dob: "1991-04-17",
    street: "418 Riverside Ave, Apt 6B",
    city: "Jacksonville",
    state: "FL",
    zip: "32204",
    timezone: "America/New_York",
    customerType: "Individual",
    companyName: "",
    companyRegistration: "",
    nok: {
      name: "Adaeze Adeyemi",
      relationship: "Sister",
      phone: "+1 (904) 555-0177",
      email: "adaeze.a@gmail.com",
      address: "418 Riverside Ave, Apt 6B, Jacksonville, FL 32204",
    },
  },

  licence: {
    number: "A412-9930-XX",
    state: "FL",
    idNumber: "SSN ••••-6641",
    issued: "2019-08-02",
    expiry: "2029-08-01",
    isGigDriver: true,
    gigProofs: [
      { id: "g1", label: "Uber · driver profile" },
      { id: "g2", label: "Uber · trip history" },
      { id: "g3", label: "Lyft · driver dashboard" },
    ],
  },

  docs: [
    {
      id: "d1",
      type: "Driving licence",
      name: "FL licence — both sides.pdf",
      vehicle: null,
      from: "2019-08-02",
      until: "2029-08-01",
      verified: true,
      uploadedAt: "2026-03-02",
      scan: { status: "passed", confidence: 97, reasons: [] },
    },
    {
      id: "d2",
      type: "Proof of address",
      name: "JEA utility bill — Feb.pdf",
      vehicle: null,
      from: "2026-02-01",
      until: "2026-08-01",
      verified: true,
      uploadedAt: "2026-03-02",
      scan: { status: "passed", confidence: 91, reasons: [] },
    },
    {
      id: "d3",
      type: "Insurance certificate",
      name: "Progressive — commercial rider.pdf",
      vehicle: "Tesla Model 3 · FL 8KQ-2210",
      from: "2026-06-01",
      until: "2026-09-30",
      verified: false,
      uploadedAt: "2026-06-04",
      scan: {
        status: "flagged",
        confidence: 62,
        reasons: ["Policy holder name does not match the customer record", "Coverage class unreadable"],
      },
    },
  ],

  ai: {
    state: "passed",
    completedAt: "2026-03-03",
    faceMatchScore: 94,
    photos: { face: true, selfie: true, docFront: true, docBack: true },
    extracted: {
      documentNumber: "A412-9930-XX",
      documentExpiry: "2029-08-01",
      firstName: "Marcus",
      lastName: "Adeyemi",
      dob: "1991-04-17",
      address: "418 Riverside Ave, Apt 6B, Jacksonville, FL 32204",
    },
    declineReason: null,
  },

  cmd: {
    state: "valid",
    holder: "MARCUS O ADEYEMI",
    number: "A412-9930-XX",
    expires: "2029-08-01",
    place: "Florida · Jacksonville",
    lastEventAt: "2026-03-03",
    linkExpiresAt: null,
    channels: ["email", "sms"],
    documents: 2,
  },

  account: {
    status: "Active",
    rejection: null,
    blockedHere: null,
    globalBlocks: [],
  },

  consent: {
    sms: true,
    smsAt: "2026-01-04",
    smsSource: "Booking checkout · tick box",
    whatsapp: false,
  },

  rentals: [
    {
      id: "r1",
      ref: "RNT-2410",
      vehicle: "Tesla Model 3",
      reg: "FL 8KQ-2210",
      start: "2026-08-28",
      end: "2026-09-11",
      total: 1540,
      outstanding: 234,
      status: "Active",
    },
    {
      id: "r2",
      ref: "RNT-2291",
      vehicle: "Tesla Model Y",
      reg: "FL 7RB-9014",
      start: "2026-07-04",
      end: "2026-07-11",
      total: 890,
      outstanding: 0,
      status: "Completed",
    },
    {
      id: "r3",
      ref: "RNT-2140",
      vehicle: "Kia Forte",
      reg: "FL 4TM-1188",
      start: "2026-05-18",
      end: "2026-05-21",
      total: 312,
      outstanding: 0,
      status: "Completed",
    },
    {
      id: "r4",
      ref: "RNT-1977",
      vehicle: "Tesla Model 3",
      reg: "FL 8KQ-2210",
      start: "2026-03-02",
      end: "2026-03-16",
      total: 1180,
      outstanding: 0,
      status: "Completed",
    },
    {
      id: "r5",
      ref: "RNT-1802",
      vehicle: "Nissan Versa",
      reg: "FL 9PL-3376",
      start: "2026-01-09",
      end: "2026-01-12",
      total: 240,
      outstanding: 0,
      status: "Cancelled",
    },
  ],

  ledger: [
    { id: "L1", date: "2026-03-02", label: "Rental · Tesla Model 3", ref: "RNT-1977", kind: "charge", amount: 1180 },
    { id: "L2", date: "2026-03-02", label: "Card payment · Visa 4242", ref: "RNT-1977", kind: "payment", amount: -1180 },
    { id: "L3", date: "2026-05-18", label: "Rental · Kia Forte", ref: "RNT-2140", kind: "charge", amount: 312 },
    { id: "L4", date: "2026-05-18", label: "Card payment · Visa 4242", ref: "RNT-2140", kind: "payment", amount: -312 },
    { id: "L5", date: "2026-07-04", label: "Rental · Tesla Model Y", ref: "RNT-2291", kind: "charge", amount: 890 },
    { id: "L6", date: "2026-07-04", label: "Card payment · Visa 4242", ref: "RNT-2291", kind: "payment", amount: -890 },
    { id: "L7", date: "2026-08-28", label: "Rental · Tesla Model 3", ref: "RNT-2410", kind: "charge", amount: 1540 },
    { id: "L8", date: "2026-08-28", label: "Card payment · Visa 4242", ref: "RNT-2410", kind: "payment", amount: -1290 },
    { id: "L9", date: "2026-08-30", label: "Toll reimbursement · SunPass", ref: "RNT-2410", kind: "charge", amount: 34 },
    { id: "L10", date: "2026-09-01", label: "Goodwill credit · late handover", ref: null, kind: "refund", amount: -50 },
    {
      id: "L11",
      date: "2026-09-03",
      label: "Bank transfer · unallocated",
      ref: null,
      kind: "payment",
      amount: -120,
      unallocated: 120,
    },
  ],

  card: { brand: "Visa", last4: "4242", exp: "07/2029" },

  links: [
    { id: "p1", label: "Balance top-up · RNT-2410", amount: 284, status: "Open", sentAt: "2026-09-02" },
    { id: "p2", label: "Cleaning fee · RNT-2291", amount: 40, status: "Paid", sentAt: "2026-07-12" },
  ],

  fines: [
    {
      id: "f1",
      type: "Toll",
      reference: "SP-88-140922",
      vehicle: "Tesla Model 3 · FL 8KQ-2210",
      amount: 34,
      issuedOn: "2026-08-30",
      dueOn: "2026-09-29",
      status: "Transferred",
      liability: "Individual",
    },
    {
      id: "f2",
      type: "Parking citation",
      reference: "JAX-2026-441902",
      vehicle: "Tesla Model Y · FL 7RB-9014",
      amount: 60,
      issuedOn: "2026-07-08",
      dueOn: "2026-08-07",
      status: "Unpaid",
      liability: "Individual",
    },
  ],

  reviews: [
    {
      id: "V1",
      rating: 9,
      comment: "Returned a day early and spotless. Sent photos of the interior without being asked.",
      tags: ["Clean return", "Communicative"],
      by: "Dani R.",
      at: "2026-07-12",
      rentalRef: "RNT-2291",
    },
    {
      id: "V2",
      rating: 6,
      comment: "Twenty minutes late to the handover, but flagged it the night before.",
      tags: ["Late return"],
      by: "Femi O.",
      at: "2026-05-22",
      rentalRef: "RNT-2140",
    },
    {
      id: "V3",
      rating: 10,
      comment: "Ideal renter. Would hand over keys unsupervised.",
      tags: ["Trusted", "Repeat renter"],
      by: "Dani R.",
      at: "2026-03-17",
      rentalRef: "RNT-1977",
    },
  ],

  summary: {
    text:
      "Marcus is a dependable repeat renter across four completed rentals. Staff consistently note clean returns and proactive communication; the one lower score relates to a late handover he flagged in advance. No damage, disputes or payment failures on record.",
    basedOn: 3,
    avg: 25 / 3,
    generatedAt: "2026-07-12",
  },

  events: [
    { label: "Account created", at: "4 Jan 2026", done: true },
    { label: "SMS consent captured at checkout", at: "4 Jan 2026", done: true },
    { label: "First booking · Nissan Versa", at: "9 Jan 2026", done: true },
    { label: "Licence and proof of address uploaded", at: "2 Mar 2026", done: true },
    { label: "Identity verified · AI, 94% face match", at: "3 Mar 2026", done: true },
    { label: "CheckMyDriver returned a valid licence", at: "3 Mar 2026", done: true },
    { label: "Gig driver proof added", at: "18 May 2026", done: true },
    { label: "Card saved · Visa •••• 4242", at: "4 Jul 2026", done: true },
    { label: "Insurance certificate flagged by the scanner", at: "4 Jun 2026", done: true },
    { label: "Active rental opened · Tesla Model 3", at: "28 Aug 2026", done: true },
  ],
});

/* ── the props every panel takes ────────────────────────────────────────── */

export type PanelProps = {
  c: CustomerState;
  patch: (fn: (p: CustomerState) => CustomerState) => void;
  onJump: (t: TabId) => void;
};
