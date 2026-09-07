import { describe, it, expect } from "vitest";
import {
  MAX_ROWS,
  collectWarnings,
  detectDelimiter,
  parseCustomersCsv,
  parseDate,
  parseDelimited,
  suspectTld,
} from "@/lib/customers-csv";

const H = "Name,Email,Phone,Address,City,State,ZIP Code,Date Created,Status";

describe("blank cells become null, never empty string", () => {
  it("leaves every unfilled optional field as null", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,,,,,,,,`);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.name).toBe("Jane Doe");
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.addressStreet).toBeNull();
    expect(r.addressCity).toBeNull();
    expect(r.addressState).toBeNull();
    expect(r.addressZip).toBeNull();
    expect(r.createdAt).toBeNull();
    // Never "" — an empty string would defeat COALESCE and, for email, collide
    // with every other blank row under the unique index.
    expect(Object.values(r).some((v) => v === "")).toBe(false);
  });

  it("treats whitespace-only cells as null", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,"   ",  ,\t,,,,,`);
    expect(rows[0].email).toBeNull();
    expect(rows[0].phone).toBeNull();
  });

  it("still defaults status when the cell is blank", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,,,,,,,,`);
    expect(rows[0].status).toBe("Active");
  });
});

describe("file shape", () => {
  it("strips a UTF-8 BOM so the first header is not corrupted", () => {
    const { rows, rejected } = parseCustomersCsv(`﻿${H}\nJane Doe,j@x.com,,,,,,,`);
    expect(rejected).toHaveLength(0);
    expect(rows[0].name).toBe("Jane Doe");
  });

  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("handles %s line endings", (_label, nl) => {
    const { rows } = parseCustomersCsv(`${H}${nl}A One,a@x.com,,,,,,,${nl}B Two,b@x.com,,,,,,,`);
    expect(rows.map((r) => r.name)).toEqual(["A One", "B Two"]);
  });

  it("keeps commas inside quoted fields", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,"2308, Bingle Rd",Houston,Texas,77055,,`);
    expect(rows[0].addressStreet).toBe("2308, Bingle Rd");
    expect(rows[0].addressCity).toBe("Houston");
  });

  it("keeps a newline inside a quoted field", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,"Flat 2\nThe Mill",Leeds,,,,`);
    expect(rows).toHaveLength(1);
    expect(rows[0].addressStreet).toBe("Flat 2 The Mill");
  });

  it("unescapes doubled quotes", () => {
    const { rows } = parseCustomersCsv(`${H}\n"O""Brien, Sam",s@x.com,,,,,,,`);
    expect(rows[0].name).toBe('O"Brien, Sam');
  });

  it("ignores blank lines and a trailing newline", () => {
    const { rows } = parseCustomersCsv(`${H}\nA One,a@x.com,,,,,,,\n\n\nB Two,b@x.com,,,,,,,\n`);
    expect(rows).toHaveLength(2);
  });

  it("tolerates rows with fewer columns than the header", () => {
    const { rows, rejected } = parseCustomersCsv(`${H}\nJane Doe,j@x.com`);
    expect(rejected).toHaveLength(0);
    expect(rows[0].phone).toBeNull();
  });

  it("reports an empty file rather than throwing", () => {
    expect(parseCustomersCsv("").empty).toBe(true);
    expect(parseCustomersCsv("   \n  ").empty).toBe(true);
  });

  it("reports a header with no data rows as empty", () => {
    expect(parseCustomersCsv(H).empty).toBe(true);
  });
});

describe("delimiters", () => {
  it("detects semicolons (European Excel)", () => {
    expect(detectDelimiter("Name;Email;Phone")).toBe(";");
  });
  it("detects tabs", () => {
    expect(detectDelimiter("Name\tEmail\tPhone")).toBe("\t");
  });
  it("defaults to comma when there is a single column", () => {
    expect(detectDelimiter("Name")).toBe(",");
  });
  it("parses a semicolon-delimited file end to end", () => {
    const { rows } = parseCustomersCsv("Name;Email;Phone\nJane Doe;j@x.com;+1 555");
    expect(rows[0].name).toBe("Jane Doe");
    expect(rows[0].email).toBe("j@x.com");
  });
});

describe("headers", () => {
  it("accepts First Name + Last Name when there is no Name column", () => {
    const { rows } = parseCustomersCsv("First Name,Last Name,Email\nJane,Doe,j@x.com");
    expect(rows[0].name).toBe("Jane Doe");
  });

  it("prefers an explicit Name over the split parts", () => {
    const { rows } = parseCustomersCsv("Name,First Name,Last Name\nJane Q Doe,Jane,Doe");
    expect(rows[0].name).toBe("Jane Q Doe");
  });

  it("normalises punctuation and case in headers", () => {
    const { rows } = parseCustomersCsv("full_name,E-Mail,ZIP Code\nJane Doe,J@X.com,77055");
    expect(rows[0].name).toBe("Jane Doe");
    expect(rows[0].email).toBe("j@x.com");
    expect(rows[0].addressZip).toBe("77055");
  });

  it("rejects the file when no name column exists at all", () => {
    const res = parseCustomersCsv("Email,Phone\nj@x.com,555");
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/No name column/);
  });

  it("reports unrecognised columns instead of silently dropping them", () => {
    const res = parseCustomersCsv("Name,Loyalty Tier\nJane Doe,Gold");
    expect(res.ignoredColumns).toContain("Loyalty Tier");
    expect(res.rows).toHaveLength(1);
  });

  it("does not let a duplicated column override the first", () => {
    const { rows } = parseCustomersCsv("Name,Email,Email\nJane Doe,first@x.com,second@x.com");
    expect(rows[0].email).toBe("first@x.com");
  });
});

describe("email handling", () => {
  it("lower-cases, because the unique index is case-sensitive", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,Jane.DOE@Example.COM,,,,,,,`);
    expect(rows[0].email).toBe("jane.doe@example.com");
  });

  it("rejects a second row whose email differs only by case", () => {
    const res = parseCustomersCsv(`${H}\nA,dup@x.com,,,,,,,\nB,DUP@X.com,,,,,,,`);
    expect(res.rows).toHaveLength(1);
    expect(res.rejected[0].reason).toMatch(/Duplicate email/);
  });

  it("rejects an email already held by the tenant", () => {
    const res = parseCustomersCsv(`${H}\nA,taken@x.com,,,,,,,`, {
      existingEmails: new Set(["taken@x.com"]),
    });
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/already exists/);
  });

  it.each(["no-at-sign", "two@@at.com", "@nolocal.com", "trailing@dot.", "has space@x.com"])(
    "rejects malformed address %s",
    (bad) => {
      const res = parseCustomersCsv(`${H}\nJane Doe,${bad},,,,,,,`);
      expect(res.rows).toHaveLength(0);
      expect(res.rejected[0].reason).toMatch(/not a valid email/);
    },
  );

  it("imports a misspelt TLD unchanged and warns instead of correcting it", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,jane@gmail.con,,,,,,,`);
    expect(rows[0].email).toBe("jane@gmail.con");
    expect(collectWarnings(rows).some((w) => /Email ends in/.test(w.message))).toBe(true);
  });

  it("flags .fom and .con as suspect", () => {
    expect(suspectTld("a@gmail.fom")).toMatch(/com/);
    expect(suspectTld("a@icloud.con")).toMatch(/com/);
    expect(suspectTld("a@gmail.com")).toBeNull();
  });
});

describe("licence numbers are globally unique, not per tenant", () => {
  it("rejects a licence already used anywhere on the platform", () => {
    const res = parseCustomersCsv("Name,Driver's License\nJane Doe,D1234", {
      existingLicenses: new Set(["D1234"]),
    });
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/unique across the platform/);
  });

  it("rejects an exact duplicate licence within the same file", () => {
    const res = parseCustomersCsv("Name,Driver's License\nA,D1\nB,D1");
    expect(res.rows).toHaveLength(1);
    expect(res.rejected).toHaveLength(1);
  });

  it("allows licences differing only by case — the index is case-sensitive", () => {
    // Verified against production: inserting 'zzab123' and 'ZZAB123' both
    // succeed. Deduping case-insensitively would drop a legitimate customer.
    const res = parseCustomersCsv("Name,Driver's License\nA,d1\nB,D1");
    expect(res.rows).toHaveLength(2);
    expect(res.rejected).toHaveLength(0);
  });

  it("allows many rows with no licence at all", () => {
    const res = parseCustomersCsv("Name,Driver's License\nA,\nB,\nC,");
    expect(res.rows).toHaveLength(3);
    expect(res.rows.every((r) => r.licenseNumber === null)).toBe(true);
  });
});

describe("dates", () => {
  it("accepts ISO", () => expect(parseDate("2026-08-15").value).toBe("2026-08-15"));
  it("accepts US M/D/YYYY", () => expect(parseDate("8/15/2026").value).toBe("2026-08-15"));
  it("reads D/M/YYYY when the first part cannot be a month", () =>
    expect(parseDate("15/8/2026").value).toBe("2026-08-15"));
  it("zero-pads single digits", () => expect(parseDate("1/2/2026").value).toBe("2026-01-02"));
  it("rejects 31 February rather than rolling it forward", () =>
    expect(parseDate("2/31/2026").error).toBeTruthy());
  it("rejects an implausible year", () => expect(parseDate("1/1/1200").error).toBeTruthy());
  it("rejects free text", () => expect(parseDate("last tuesday").error).toBeTruthy());
  it("treats blank as absent, not an error", () => {
    expect(parseDate("").value).toBeUndefined();
    expect(parseDate("").error).toBeUndefined();
  });

  it("keeps the customer when Date Created is unreadable, dropping only the date", () => {
    const { rows, rejected } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,,,,,gibberish,`);
    expect(rejected).toHaveLength(0);
    expect(rows[0].createdAt).toBeNull();
  });

  it("rejects the row when Date of Birth is unreadable", () => {
    const res = parseCustomersCsv("Name,DOB\nJane Doe,gibberish");
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/Date of birth/);
  });
});

describe("required fields and limits", () => {
  it("rejects a row with no name", () => {
    const res = parseCustomersCsv(`${H}\n,j@x.com,,,,,,,`);
    expect(res.rejected[0].reason).toMatch(/No name/);
  });

  it("rejects a row whose name is only whitespace", () => {
    const res = parseCustomersCsv(`${H}\n"   ",j@x.com,,,,,,,`);
    expect(res.rejected[0].reason).toMatch(/No name/);
  });

  it("collapses runs of whitespace in a name", () => {
    const { rows } = parseCustomersCsv(`${H}\n"Corey   Moore ",c@x.com,,,,,,,`);
    expect(rows[0].name).toBe("Corey Moore");
  });

  it("rejects an over-long name instead of letting the database truncate", () => {
    const res = parseCustomersCsv(`${H}\n${"x".repeat(600)},j@x.com,,,,,,,`);
    expect(res.rejected[0].reason).toMatch(/longer than/);
  });

  it("refuses a file over the row cap", () => {
    const many = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `P${i},p${i}@x.com,,,,,,,`).join("\n");
    const res = parseCustomersCsv(`${H}\n${many}`);
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/limit is/);
  });
});

describe("status", () => {
  it.each([
    ["Active", "Active"],
    ["active", "Active"],
    ["INACTIVE", "Inactive"],
    ["Blocked", "Blocked"],
  ])("normalises %s", (given, expected) => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,,,,,,${given}`);
    expect(rows[0].status).toBe(expected);
  });

  it("falls back to Active for an unknown status", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,,,,,,Platinum`);
    expect(rows[0].status).toBe("Active");
  });
});

describe("line numbers point at the row the operator sees", () => {
  it("counts the header as line 1", () => {
    const { rejected } = parseCustomersCsv(`${H}\nGood,g@x.com,,,,,,,\n,bad@x.com,,,,,,,`);
    expect(rejected[0].line).toBe(3);
  });

  it("stays correct after a multi-line quoted field", () => {
    const csv = `${H}\nA,a@x.com,,"Line1\nLine2",,,,,\n,bad@x.com,,,,,,,`;
    const { rejected } = parseCustomersCsv(csv);
    expect(rejected[0].line).toBe(4);
  });
});

describe("warnings surface judgement calls without blocking the import", () => {
  it("flags two rows sharing a phone number", () => {
    const { rows } = parseCustomersCsv(
      `${H}\nMarcus Johnson,a@x.com,+1 346 791 5082,,,,,,\nMarcus Johnson,b@x.com,+13467915082,,,,,,`,
    );
    expect(rows).toHaveLength(2);
    expect(collectWarnings(rows).some((w) => /possible duplicate person/.test(w.message))).toBe(true);
  });

  it("flags an email sitting in the address column", () => {
    const { rows } = parseCustomersCsv(`${H}\nSharee,s@x.com,,sharee@gmail.com,Houston,,,,`);
    expect(collectWarnings(rows).some((w) => /looks like an email/.test(w.message))).toBe(true);
  });

  it("flags a missing email", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,,,,,,,,`);
    expect(collectWarnings(rows).some((w) => /No email/.test(w.message))).toBe(true);
  });
});

describe("parseDelimited", () => {
  it("returns the starting line of each record", () => {
    const { records, unterminated } = parseDelimited('a,b\n"x\ny",z\nq,r', ",");
    expect(records.map((r) => r.line)).toEqual([1, 2, 4]);
    expect(unterminated).toBe(false);
  });
});

describe("the real Fleet Finesse export shape", () => {
  const real = [
    "﻿S/N,Name,First Name,Last Name,Email,Phone,Address,City,State,ZIP Code,Date Created,Status",
    "1,vontraveon hockless,vontraveon,hockless,cowardmediabiz@gmail.com,+1 346 868 3877,21101 kingsland blvd,katy,Texas,77450,5/15/2026,Active",
    "49,bryniya Griffin-lloyd,bryniya,Griffin-lloyd,bryniyalloyd@gmail.com,+1 215 966 2488,2700 westridge st,Houston,Texas,77055,2/27/2026,Active",
    "58,Bryniya Griffin-lloyd,Bryniya,Griffin-lloyd,Bryniyalloyd@gmail.com,+1 215 966 2488,,,Texas,77054,2/27/2026,Active",
    '90,Samantha  Jones,Samantha ,Jones,Samalamajj23@gmail.com,+18322728850,"1206 LAMPLIGHT TRAIL DR,",Katy ,Texas,77450,12/12/2025,Active',
  ].join("\n");

  it("imports the good rows, merges the case-only duplicate, keeps the quoted comma", () => {
    const res = parseCustomersCsv(real);
    expect(res.rows).toHaveLength(3);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].reason).toMatch(/Duplicate email/);
    expect(res.ignoredColumns).toContain("S/N");

    const sam = res.rows.find((r) => r.name === "Samantha Jones")!;
    expect(sam.addressStreet).toBe("1206 LAMPLIGHT TRAIL DR,");
    expect(sam.createdAt).toBe("2025-12-12");

    const v = res.rows[0];
    expect(v.email).toBe("cowardmediabiz@gmail.com");
    expect(v.addressZip).toBe("77450");
    expect(v.createdAt).toBe("2026-05-15");
  });
});

describe("regressions found by adversarial review", () => {
  it("does not let an inch mark swallow the rest of the file", () => {
    // `6" hitch bay` is ordinary in vehicle data. Before the fix, a bare quote
    // mid-field opened quote mode and absorbed every remaining delimiter and
    // newline: a 20-row file parsed as 3 rows with ZERO rejections.
    const body = Array.from({ length: 20 }, (_, i) =>
      `P${i + 1},p${i + 1}@x.com,,${i === 2 ? '6" hitch bay' : "addr"},,,,,`,
    ).join("\n");
    const res = parseCustomersCsv(`${H}\n${body}`);
    expect(res.rows).toHaveLength(20);
    expect(res.rejected).toHaveLength(0);
    expect(res.rows[2].addressStreet).toBe('6" hitch bay');
  });

  it("keeps a mid-field quote literal rather than deleting it", () => {
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,12"x4" Trailer,,,,,`);
    expect(rows[0].addressStreet).toBe('12"x4" Trailer');
  });

  it("refuses a file whose quote is never closed instead of importing a fragment", () => {
    const res = parseCustomersCsv(`${H}\nA,a@x.com,,"never closed,,,,\nB,b@x.com,,,,,,,`);
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/never closed/i);
  });

  it("accounts for every data row, so silent loss is impossible", () => {
    const res = parseCustomersCsv(`${H}\nA,a@x.com,,,,,,,\n,bad@x.com,,,,,,,\nC,c@x.com,,,,,,,`);
    expect(res.totalDataRows).toBe(3);
    expect(res.rows.length + res.rejected.length).toBe(res.totalDataRows);
  });

  it("warns when an unrecognised status was coerced to Active", () => {
    // Silently importing a barred customer as Active would let them book.
    const { rows } = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,,,,,,Banned`);
    expect(rows[0].status).toBe("Active");
    expect(rows[0].statusCoerced).toBe("Banned");
    expect(collectWarnings(rows).some((w) => /not recognised/.test(w.message))).toBe(true);
  });

  it("caps every free-text field, not only the name", () => {
    const res = parseCustomersCsv(`${H}\nJane Doe,j@x.com,,${"x".repeat(600)},,,,,`);
    expect(res.rows).toHaveLength(0);
    expect(res.rejected[0].reason).toMatch(/address value is longer/);
  });
});
