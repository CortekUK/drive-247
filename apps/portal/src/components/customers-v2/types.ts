/* ─────────────────────────────────────────────────────────────────────────────
 * Customer record v2 — the shape the screen reads.
 *
 * One assembled view of a customer, built in `use-customer-record.ts` from the
 * hooks the v1 page already uses plus three small queries of its own. The
 * panels never touch Supabase: they read this and call the mutations handed
 * down to them, so what is on screen and what is in the database cannot drift
 * apart through two different query shapes.
 *
 * Every field below maps to a column that exists today. Nothing here needs a
 * migration — including both staleness cases, which are the point of the
 * design:
 *
 *   1. `identity_verifications` stores document_number, document_expiry_date,
 *      first_name, last_name, date_of_birth and address as the provider read
 *      them AT VERIFICATION TIME. Diffing those against the live `customers`
 *      row IS the drift. Nothing has to be snapshotted; it already was.
 *   2. `customer_review_summaries` carries total_reviews / average_rating /
 *      generated_at beside the paragraph, so a summary written before the
 *      newest review can say so itself.
 * ────────────────────────────────────────────────────────────────────────── */

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
  /** `customers.customer_type`. Almost every live row is Individual — but the
   *  Company rows still have to render, and they need two extra fields. */
  customerType: "Individual" | "Company";
  companyName: string;
  companyRegistration: string;
  profilePhotoUrl: string | null;
  nok: { name: string; relationship: string; phone: string; email: string; address: string };
};

export type Licence = {
  number: string;
  /** `license_state` — a US state code, not a country. */
  state: string;
  idNumber: string;
  /**
   * Read-only, and sourced from the verification rather than the customer row.
   *
   * `customers` has no licence issue or expiry column: the only place either
   * date exists is `identity_verifications.document_issuing_date` /
   * `document_expiry_date`, written by the provider off the document itself.
   * That is a better source than a typed field would be — it is what the
   * licence actually says — so the screen shows it and says where it came
   * from rather than inventing an editable copy that could disagree with it.
   */
  issued: string | null;
  expiry: string | null;
  isGigDriver: boolean;
  gigProofs: { id: string; label: string; url: string | null }[];
};

/* ── documents ──────────────────────────────────────────────────────────── */

export type Doc = {
  id: string;
  type: string;
  name: string;
  /** Documents can be scoped to one car — an insurance cert usually is. */
  vehicle: string | null;
  from: string | null;
  until: string | null;
  verified: boolean;
  uploadedAt: string;
  fileUrl: string | null;
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
 * The snapshot the drift banner compares against — and not something we store
 * ourselves, because `identity_verifications` already holds these columns.
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
  /** Provider-owned evidence. NOT customer documents — different table, and the
   *  operator cannot edit or replace these. */
  photos: { face: string | null; selfie: string | null; docFront: string | null; docBack: string | null };
  extracted: Extracted | null;
  declineReason: string | null;
  /**
   * The values a member of staff has already looked at and said "the verdict
   * still stands" about.
   *
   * Accepting drift must NOT rewrite `identity_verifications` — those columns
   * are the provider's evidence of what it read off the document, and a screen
   * that edits them to make its own banner go away has destroyed the only
   * record of what was actually checked. So the acceptance is written to
   * `audit_logs` instead, with the values it accepted, and the drift check
   * subtracts them. Evidence intact, banner gone, and the decision has a name
   * and a timestamp against it.
   */
  acceptedBaseline: Record<string, string> | null;
};

/** CheckMyDriver (Modives). A second provider with its own verdict, its own
 *  status vocabulary, and a magic link the customer has to open themselves. */
export type CmdVerification = {
  present: boolean;
  state: "none" | "awaiting" | "valid" | "invalid" | "expired";
  holder: string;
  number: string;
  expires: string | null;
  place: string;
  lastEventAt: string | null;
  linkExpiresAt: string | null;
  channels: string[];
  documents: string[];
  applicantVerificationId: string | null;
};

/* ── account standing ───────────────────────────────────────────────────── */

/** `blocked_identities` — the list that reaches beyond this record. Blocking an
 *  identity is a different act from blocking the customer with you. */
export type GlobalBlock = {
  id: string;
  kind: "license" | "id_card" | "passport" | "email" | "other";
  value: string;
  reason: string;
  addedAt: string;
};

export type Account = {
  /** `customers.status`. */
  status: "Active" | "Inactive" | "Rejected";
  rejection: { reason: string; at: string | null } | null;
  /** `customers.is_blocked` — this tenant only. */
  blockedHere: { reason: string; at: string | null } | null;
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
  whatsapp: boolean;
};

/* ── history ────────────────────────────────────────────────────────────── */

export type Rental = {
  id: string;
  ref: string;
  vehicle: string;
  reg: string;
  start: string;
  end: string | null;
  total: number;
  outstanding: number;
  status: "Active" | "Completed" | "Cancelled" | "Pending" | "Upcoming";
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
  status: string;
  sentAt: string;
  url: string | null;
};

export type Fine = {
  id: string;
  type: string;
  reference: string;
  vehicle: string;
  amount: number;
  issuedOn: string;
  dueOn: string;
  status: string;
  liability: string;
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

export type CustomerRecord = {
  id: string;
  createdAt: string | null;
  identity: Identity;
  licence: Licence;
  docs: Doc[];
  ai: AiVerification;
  cmd: CmdVerification;
  account: Account;
  consent: Consent;
  rentals: Rental[];
  ledger: LedgerRow[];
  links: PaymentLink[];
  fines: Fine[];
  reviews: Review[];
  summary: ReviewSummary | null;
  events: ActivityEvent[];
  /** `customers.stripe_customer_id` and the methods actually used on payments —
   *  the closest honest answer to "can I charge them without asking?", since no
   *  card details are held in this database. */
  billing: { stripeCustomerId: string | null; methodsUsed: string[] };
};

/* ── what the panels are handed ─────────────────────────────────────────── */

/** The columns on `customers` this screen may write. */
export type EditableColumn =
  | "name"
  | "email"
  | "phone"
  | "date_of_birth"
  | "address_street"
  | "address_city"
  | "address_state"
  | "address_zip"
  | "timezone"
  | "customer_type"
  | "company_name"
  | "company_registration"
  | "nok_full_name"
  | "nok_relationship"
  | "nok_phone"
  | "nok_email"
  | "nok_address"
  | "license_number"
  | "license_state"
  | "id_number"
  | "is_gig_driver"
  | "sms_consent"
  | "sms_consent_at"
  | "whatsapp_opt_in"
  | "status"
  | "rejection_reason"
  | "rejected_at";

export type PanelProps = {
  c: CustomerRecord;
  /** Applies immediately on screen, then persists. There is no Save. */
  set: (patch: Partial<Record<EditableColumn, string | boolean | null>>) => void;
  onJump: (t: TabId) => void;
  /** False for a manager with viewer-only access to Customers. */
  canEdit: boolean;
  currency: string;
};
