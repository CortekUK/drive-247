/**
 * Customer CSV import — parsing and validation.
 *
 * Written against a real export from Fleet Finesse (106 rows) which carried, in
 * one file: a UTF-8 BOM, commas inside quoted address fields, three misspelt
 * TLDs, a pair of rows differing only in the capitalisation of the email, and an
 * email address sitting in the Address column. Everything here earns its place
 * from that file or from a constraint in the database.
 *
 * Two rules shape the whole module:
 *
 *  1. A blank cell becomes NULL, never "". The operator asked for this
 *     explicitly, and it matters: "" would satisfy a NOT NULL check, defeat
 *     `COALESCE`, and — for email — collide with every other blank row under
 *     `idx_customers_email_tenant_unique`.
 *  2. Nothing is silently corrected. A misspelt address is imported as typed; a
 *     row that cannot be imported is rejected with its line number so the
 *     operator can fix the spreadsheet. We never invent data on their behalf.
 */

/** Hard ceiling on rows per file. Well past any real fleet, stops a runaway paste. */
export const MAX_ROWS = 5000;
/** Bytes. A 5000-row customer export is ~600KB; 5MB is generous. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** Longest value we will accept in any single free-text cell. */
const MAX_CELL = 500;

export interface ParsedCustomer {
  /** 1-based line in the file as the operator sees it, header included. */
  line: number;
  name: string;
  email: string | null;
  phone: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  licenseNumber: string | null;
  dateOfBirth: string | null;
  status: string;
  /** The original value when we could not recognise it and defaulted to Active. */
  statusCoerced: string | null;
  createdAt: string | null;
}

export interface RejectedCustomer {
  line: number;
  /** Whatever we could identify the row by — name, else email, else "". */
  label: string;
  reason: string;
}

export interface CustomerCsvResult {
  rows: ParsedCustomer[];
  rejected: RejectedCustomer[];
  /** Header columns we did not recognise, echoed back so the operator can see what was dropped. */
  ignoredColumns: string[];
  /** True when the file had a header but no data rows at all. */
  empty: boolean;
  /**
   * Data rows found in the file. rows.length + rejected.length must equal this;
   * the dialog shows it so silent loss is impossible to miss.
   */
  totalDataRows: number;
}

/**
 * Header aliases. Lower-cased, punctuation and whitespace stripped, so
 * "ZIP Code", "zip_code" and "Zip-Code" all collapse to "zipcode".
 */
const COLUMN_ALIASES = {
  name: ["name", "fullname", "customername", "customer", "client", "clientname"],
  firstName: ["firstname", "first", "forename", "givenname"],
  lastName: ["lastname", "last", "surname", "familyname"],
  email: ["email", "emailaddress", "mail"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "tel", "contactnumber"],
  addressStreet: ["address", "street", "streetaddress", "addressline1", "address1", "addr"],
  addressCity: ["city", "town"],
  addressState: ["state", "province", "county", "region"],
  addressZip: ["zipcode", "zip", "postcode", "postalcode", "postal"],
  licenseNumber: ["licensenumber", "license", "licence", "licencenumber", "driverslicense", "driverslicence", "dl", "dlnumber"],
  dateOfBirth: ["dateofbirth", "dob", "birthdate", "birthday"],
  status: ["status", "state2", "customerstatus"],
  createdAt: ["datecreated", "created", "createdat", "createddate", "signupdate", "joined", "datejoined"],
} as const;

type FieldKey = keyof typeof COLUMN_ALIASES;

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Collapse internal runs of whitespace and trim. Empty becomes null. */
function clean(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const s = raw.replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

/**
 * RFC4180-style parser operating on the whole document, not line by line, so a
 * quoted field may legally contain the delimiter, a newline, or an escaped
 * quote. The Fleet Health importer splits on lines first and therefore cannot
 * read a multi-line address; this one can.
 *
 * Returns rows of raw cells plus the 1-based line each row started on, so a
 * rejection can point at the right row even after multi-line fields shift the
 * count.
 */
export function parseDelimited(
  text: string,
  delimiter: string,
): { records: { cells: string[]; line: number }[]; unterminated: boolean } {
  const out: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let rowHasContent = false;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Drop rows that are entirely empty — trailing newlines are normal.
    if (rowHasContent) out.push({ cells, line: rowStartLine });
    cells = [];
    rowHasContent = false;
    rowStartLine = line;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
        rowHasContent = true;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      // Only a quote in first position opens a quoted field. A bare quote
      // mid-field is an inch mark (6" hitch bay) and must stay literal — before
      // this check it flipped the parser into quote mode and absorbed every
      // remaining delimiter and newline, silently discarding the rest of the file.
      inQuotes = true;
    } else if (ch === delimiter) {
      pushField();
    } else if (ch === "\r") {
      // Swallow; the \n (or its absence, for classic Mac CR) ends the row.
      if (text[i + 1] !== "\n") {
        line++;
        pushRow();
      }
    } else if (ch === "\n") {
      line++;
      pushRow();
    } else {
      field += ch;
      if (ch.trim() !== "") rowHasContent = true;
    }
  }
  // Final row, if the file does not end in a newline.
  if (field !== "" || cells.length > 0 || rowHasContent) pushRow();

  return { records: out, unterminated: inQuotes };
}

/**
 * Pick the delimiter by counting candidates in the header line. Excel writes
 * semicolons in most of continental Europe, and a tab-separated export is
 * common enough to be worth catching rather than reading as one giant column.
 */
export function detectDelimiter(headerLine: string): string {
  const counts = [
    { d: ",", n: (headerLine.match(/,/g) || []).length },
    { d: ";", n: (headerLine.match(/;/g) || []).length },
    { d: "\t", n: (headerLine.match(/\t/g) || []).length },
  ];
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

/**
 * Deliberately permissive: this rejects only what is certainly unusable, so a
 * valid-but-unusual address is never thrown away. It does NOT try to catch
 * typos like ".con" — guessing at intent would silently change a customer's
 * contact details. Those are surfaced as warnings instead.
 */
function isPlausibleEmail(s: string): boolean {
  if (/\s/.test(s)) return false;
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".") && domain.length >= 3;
}

/** TLDs that are almost always a slip for a common one. Warned about, never altered. */
const SUSPECT_TLDS: Record<string, string> = {
  con: "com",
  cpm: "com",
  vom: "com",
  comm: "com",
  co: "com",
  fom: "com",
  xom: "com",
  ocm: "com",
  nte: "net",
};

export function suspectTld(email: string): string | null {
  const tld = email.split(".").pop()?.toLowerCase() ?? "";
  return SUSPECT_TLDS[tld] ? `${tld} (did you mean ${SUSPECT_TLDS[tld]}?)` : null;
}

/**
 * Dates arrive as M/D/YYYY from US exports and YYYY-MM-DD from most others.
 * D/M/YYYY is indistinguishable from M/D/YYYY when both parts are <= 12, so
 * rather than silently picking one we accept the US reading — which is what
 * every export we have seen uses — and reject only genuinely impossible dates.
 */
export function parseDate(raw: string): { value?: string; error?: string } {
  const s = raw.trim();
  if (s === "") return {};

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return buildDate(Number(y), Number(m), Number(d), raw);
  }

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    // If the first part cannot be a month, it must be the day (D/M/YYYY).
    if (a > 12 && b <= 12) return buildDate(y, b, a, raw);
    return buildDate(y, a, b, raw);
  }

  return { error: `"${raw}" is not a recognised date — use YYYY-MM-DD` };
}

function buildDate(y: number, m: number, d: number, raw: string): { value?: string; error?: string } {
  if (m < 1 || m > 12 || d < 1 || d > 31) return { error: `"${raw}" is not a valid date` };
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Catches 31 February and friends, which Date would roll forward silently.
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return { error: `"${raw}" is not a real date` };
  }
  if (y < 1900 || y > 2200) return { error: `"${raw}" has an implausible year` };
  return { value: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

export interface ParseOptions {
  /** Emails already held by this tenant, lower-cased. Used to reject in-file collisions early. */
  existingEmails?: Set<string>;
  /** Licence numbers already held ANYWHERE — that index is global, not per-tenant. */
  existingLicenses?: Set<string>;
}

export function parseCustomersCsv(text: string, opts: ParseOptions = {}): CustomerCsvResult {
  const rows: ParsedCustomer[] = [];
  const rejected: RejectedCustomer[] = [];
  const ignoredColumns: string[] = [];

  // Excel prefixes a UTF-8 BOM, which otherwise corrupts the first header name.
  const clean0 = text.replace(/^﻿/, "");
  if (clean0.trim() === "") {
    return { rows, rejected, ignoredColumns, empty: true, totalDataRows: 0 };
  }

  const firstLine = clean0.split(/\r\n|\n|\r/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const { records, unterminated } = parseDelimited(clean0, delimiter);

  if (unterminated) {
    // Everything after the stray quote was read as one cell. Refusing the file
    // is the only honest option: silently importing the fragment looks like
    // success while most of the file is gone.
    return {
      rows,
      rejected: [{
        line: 1,
        label: "",
        reason:
          'A quotation mark is never closed, so the rest of the file was read as one cell. ' +
          'Look for a stray " (often an inch mark, like 6" bay) and re-save the file.',
      }],
      ignoredColumns,
      empty: false,
      totalDataRows: 0,
    };
  }

  if (records.length === 0) {
    return { rows, rejected, ignoredColumns, empty: true, totalDataRows: 0 };
  }

  const header = records[0];
  const columnFor: Partial<Record<FieldKey, number>> = {};

  header.cells.forEach((raw, i) => {
    const h = normaliseHeader(raw);
    if (h === "") return;
    const field = (Object.keys(COLUMN_ALIASES) as FieldKey[]).find((key) =>
      (COLUMN_ALIASES[key] as readonly string[]).includes(h),
    );
    // First match wins — a duplicated column must not silently override the first.
    if (field && columnFor[field] === undefined) {
      columnFor[field] = i;
    } else if (!field) {
      ignoredColumns.push(raw.trim());
    }
  });

  const hasName = columnFor.name !== undefined;
  const hasParts = columnFor.firstName !== undefined || columnFor.lastName !== undefined;
  if (!hasName && !hasParts) {
    return {
      rows,
      rejected: [
        {
          line: header.line,
          label: "",
          reason: "No name column found — expected a 'Name' column, or 'First Name' and 'Last Name'",
        },
      ],
      ignoredColumns,
      empty: false,
      totalDataRows: 0,
    };
  }

  const dataRecords = records.slice(1);
  if (dataRecords.length === 0) {
    return { rows, rejected, ignoredColumns, empty: true, totalDataRows: 0 };
  }
  if (dataRecords.length > MAX_ROWS) {
    return {
      rows,
      rejected: [
        {
          line: header.line,
          label: "",
          reason: `File has ${dataRecords.length} rows — the limit is ${MAX_ROWS}. Split it and import in parts.`,
        },
      ],
      ignoredColumns,
      empty: false,
      totalDataRows: dataRecords.length,
    };
  }

  const at = (cells: string[], key: FieldKey): string | null => {
    const idx = columnFor[key];
    if (idx === undefined) return null;
    return clean(cells[idx]);
  };

  // Collision tracking is case-insensitive because the DB index is NOT: two rows
  // differing only in capitalisation would both insert and produce a duplicate
  // person. That is exactly what the Fleet Finesse export contained.
  const seenEmails = new Set(opts.existingEmails ?? []);
  const seenLicenses = new Set(opts.existingLicenses ?? []);

  for (const rec of dataRecords) {
    const { cells, line } = rec;

    let name = at(cells, "name");
    if (!name) {
      const first = at(cells, "firstName");
      const last = at(cells, "lastName");
      name = [first, last].filter(Boolean).join(" ") || null;
    }

    const emailRaw = at(cells, "email");
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    const label = name ?? emailRaw ?? "";

    if (!name) {
      rejected.push({ line, label, reason: "No name — a customer must have a name" });
      continue;
    }
    if (name.length > MAX_CELL) {
      rejected.push({ line, label: name.slice(0, 40), reason: `Name is longer than ${MAX_CELL} characters` });
      continue;
    }

    if (email !== null) {
      if (!isPlausibleEmail(email)) {
        rejected.push({ line, label, reason: `"${emailRaw}" is not a valid email address` });
        continue;
      }
      if (seenEmails.has(email)) {
        rejected.push({ line, label, reason: `Duplicate email — ${email} already exists` });
        continue;
      }
      seenEmails.add(email);
    }

    const over = ([
      ["email", emailRaw], ["phone", at(cells, "phone")],
      ["address", at(cells, "addressStreet")], ["city", at(cells, "addressCity")],
      ["state", at(cells, "addressState")], ["zip", at(cells, "addressZip")],
    ] as [string, string | null][]).find(([, v]) => v !== null && v.length > MAX_CELL);
    if (over) {
      rejected.push({ line, label, reason: `The ${over[0]} value is longer than ${MAX_CELL} characters` });
      continue;
    }

    const licenseNumber = at(cells, "licenseNumber");
    if (licenseNumber) {
      // idx_customers_license_number_unique has NO tenant predicate, so a clash
      // with another operator's customer would fail the whole insert.
      if (seenLicenses.has(licenseNumber)) {
        rejected.push({
          line,
          label,
          reason: `Licence ${licenseNumber} is already recorded — licence numbers must be unique across the platform`,
        });
        continue;
      }
      seenLicenses.add(licenseNumber);
    }

    const dobRaw = at(cells, "dateOfBirth");
    const dob = dobRaw ? parseDate(dobRaw) : {};
    if (dob.error) {
      rejected.push({ line, label, reason: `Date of birth: ${dob.error}` });
      continue;
    }

    const createdRaw = at(cells, "createdAt");
    const created = createdRaw ? parseDate(createdRaw) : {};
    // A bad created-date is not worth losing a customer over — drop the date,
    // keep the person, and let the row default to now().
    const createdAt = created.error ? null : created.value ?? null;

    const statusRaw = at(cells, "status");
    const known = statusRaw !== null && /^(active|inactive|blocked|pending)$/i.test(statusRaw);
    const status = known
      ? statusRaw![0].toUpperCase() + statusRaw!.slice(1).toLowerCase()
      : "Active";
    // Falling back to Active is safe, but doing it silently is not: an operator
    // migrating a blocklist would import barred customers as bookable.
    const statusCoerced = statusRaw !== null && !known ? statusRaw : null;

    rows.push({
      line,
      name,
      email,
      phone: at(cells, "phone"),
      addressStreet: at(cells, "addressStreet"),
      addressCity: at(cells, "addressCity"),
      addressState: at(cells, "addressState"),
      addressZip: at(cells, "addressZip"),
      licenseNumber,
      dateOfBirth: dob.value ?? null,
      status,
      statusCoerced,
      createdAt,
    });
  }

  return { rows, rejected, ignoredColumns, empty: false, totalDataRows: dataRecords.length };
}

/** Non-fatal observations shown to the operator before they commit the import. */
export interface ImportWarning {
  line: number;
  label: string;
  message: string;
}

export function collectWarnings(rows: ParsedCustomer[]): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const byPhone = new Map<string, ParsedCustomer[]>();

  for (const r of rows) {
    if (r.email) {
      const bad = suspectTld(r.email);
      if (bad) {
        warnings.push({ line: r.line, label: r.name, message: `Email ends in .${bad}` });
      }
    }
    if (!r.email) {
      warnings.push({ line: r.line, label: r.name, message: "No email address" });
    }
    if (r.statusCoerced) {
      warnings.push({
        line: r.line,
        label: r.name,
        message: `Status "${r.statusCoerced}" was not recognised — imported as Active`,
      });
    }
    if (r.addressStreet && r.addressStreet.includes("@")) {
      warnings.push({ line: r.line, label: r.name, message: "Address column looks like an email address" });
    }
    const digits = (r.phone ?? "").replace(/\D/g, "");
    if (digits) {
      const list = byPhone.get(digits) ?? [];
      list.push(r);
      byPhone.set(digits, list);
    }
  }

  for (const [digits, list] of byPhone) {
    if (list.length > 1) {
      const names = list.map((r) => `${r.name} (line ${r.line})`).join(", ");
      warnings.push({
        line: list[0].line,
        label: list[0].name,
        message: `Same phone +${digits} on ${list.length} rows: ${names} — possible duplicate person`,
      });
    }
  }

  return warnings;
}
