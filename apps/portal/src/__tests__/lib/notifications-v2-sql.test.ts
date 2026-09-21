/**
 * ops/notifications_v2.sql: static checks, because nothing runs this file in CI
 * and it is applied to production by hand (Management API).
 *
 * What is pinned, and why each matters (V2_PLAN §4–§6):
 *   - it is marked NOT APPLIED, and all of its SQL sits inside one BEGIN/COMMIT
 *     (the pre-flight and verify blocks are comments, so running the file
 *     cannot run them by accident);
 *   - it is additive only: it creates exactly its three tables, alters and
 *     triggers only those, drops nothing but its own policies/triggers, and
 *     never touches `tenants` or any other existing table;
 *   - RLS is on for all three, anon gets nothing, authenticated cannot write the
 *     test-send log, functions revoke EXECUTE from PUBLIC and anon;
 *   - the staff predicate reads app_users (active) and not get_user_tenant_id();
 *     writes exclude viewers;
 *   - it ends by reloading the PostgREST schema cache;
 *   - its limits and patterns agree with the TypeScript that writes the rows,
 *     and every catalog key fits the key rule.
 *
 * The file was also exercised for real (applied twice as a non-superuser owner
 * over a Supabase-shaped stub in PGlite, 94 isolation/CHECK/trigger cases);
 * that suite is not in the repo, and the SQL file's header says where it is.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import { NOTIFICATION_KEY_PATTERN, NOTIFICATION_SETTINGS_V2_TABLE } from "@/hooks/use-notification-settings-v2";
import { EMAIL_SENDER_V2_TABLE } from "@/hooks/use-email-sender-v2";
import { NOTIFICATION_CATALOG } from "@/lib/notifications-v2/catalog";
import { NOTIFICATION_CHANNELS } from "@/lib/notifications-v2/types";
import {
  EMAIL_SUBJECT_MAX,
  IN_APP_BODY_MAX,
  IN_APP_TITLE_MAX,
  LOCAL_PART_PATTERN,
  PUSH_BODY_MAX,
  isValidLocalPart,
  PUSH_OPTION_KEYS,
  PUSH_TITLE_MAX,
} from "@/lib/notifications-v2/settings-model";

const repo = join(__dirname, "..", "..", "..", "..", "..");
const raw = readFileSync(join(repo, "ops", "notifications_v2.sql"), "utf8");

const NEW_TABLES = ["tenant_notification_settings", "tenant_email_sender", "notification_test_sends_v2"] as const;
const NEW_FUNCTIONS = ["notifications_v2_stamp", "tenant_email_sender_guard"] as const;

/** The SQL with `--` comments removed, respecting '...' strings, E'...' and $$ bodies. */
function stripComments(sql: string): string {
  let out = "";
  let i = 0;
  let quote: "'" | "$$" | null = null;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (quote === "'") {
      if (two === "''") {
        out += two;
        i += 2;
        continue;
      }
      if (sql[i] === "'") quote = null;
      out += sql[i++];
      continue;
    }
    if (quote === "$$") {
      if (two === "$$") {
        quote = null;
        out += two;
        i += 2;
        continue;
      }
      out += sql[i++];
      continue;
    }
    if (two === "--") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (two === "$$") {
      quote = "$$";
      out += two;
      i += 2;
      continue;
    }
    if (sql[i] === "'") quote = "'";
    out += sql[i++];
  }
  return out;
}

const code = stripComments(raw);
/** Statements, whitespace squeezed. `$$` bodies stay inside their statement. */
const statements = (() => {
  const list: string[] = [];
  let cur = "";
  let inBody = false;
  for (let i = 0; i < code.length; i++) {
    if (code.slice(i, i + 2) === "$$") {
      inBody = !inBody;
      cur += "$$";
      i++;
      continue;
    }
    if (code[i] === ";" && !inBody) {
      if (cur.trim()) list.push(cur.replace(/\s+/g, " ").trim());
      cur = "";
      continue;
    }
    cur += code[i];
  }
  if (cur.trim()) list.push(cur.replace(/\s+/g, " ").trim());
  return list;
})();
const matching = (re: RegExp) => statements.filter((s) => re.test(s));
const tableName = (qualified: string) => qualified.replace(/^public\./i, "").replace(/"/g, "");

describe("ops/notifications_v2.sql: shape of the file", () => {
  it("says it is NOT APPLIED and how to apply it", () => {
    const header = raw.slice(0, raw.indexOf("\nBEGIN;"));
    expect(header).toMatch(/NOT APPLIED/);
    expect(header).toMatch(/Management API/);
  });

  it("runs as one transaction: every statement sits between BEGIN and COMMIT", () => {
    expect(statements[0]).toBe("BEGIN");
    expect(statements[statements.length - 1]).toBe("COMMIT");
    expect(statements.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s))).toEqual(["BEGIN", "COMMIT"]);
  });

  it("keeps the pre-flight and verify blocks read-only (comments only)", () => {
    const before = raw.slice(0, raw.indexOf("\nBEGIN;"));
    const after = raw.slice(raw.lastIndexOf("\nCOMMIT;") + "\nCOMMIT;".length);
    expect(before).toMatch(/PRE-FLIGHT/);
    expect(after).toMatch(/VERIFY/);
    expect(stripComments(before).trim()).toBe("");
    expect(stripComments(after).trim()).toBe("");
  });

  it("reloads the PostgREST schema cache before COMMIT", () => {
    const notify = statements.findIndex((s) => /^NOTIFY pgrst, 'reload schema'$/.test(s));
    expect(notify).toBeGreaterThan(0);
    expect(notify).toBe(statements.length - 2);
  });
});

describe("ops/notifications_v2.sql: additive only", () => {
  it("creates exactly the three new tables, re-runnably", () => {
    const creates = matching(/^CREATE TABLE/i);
    expect(creates.every((s) => /^CREATE TABLE IF NOT EXISTS /i.test(s))).toBe(true);
    const names = creates.map((s) => tableName(s.match(/^CREATE TABLE IF NOT EXISTS ([\w."]+)/i)![1]));
    expect(names.sort()).toEqual([...NEW_TABLES].sort());
    expect(NEW_TABLES).toContain(NOTIFICATION_SETTINGS_V2_TABLE);
    expect(NEW_TABLES).toContain(EMAIL_SENDER_V2_TABLE);
  });

  it("alters, triggers, indexes and polices only its own tables", () => {
    const targets = [
      ...matching(/^ALTER TABLE/i).map((s) => s.match(/^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?([\w."]+)/i)![1]),
      ...matching(/^CREATE (?:OR REPLACE )?TRIGGER/i).map((s) => s.match(/ ON ([\w."]+) /i)![1]),
      ...matching(/^DROP TRIGGER/i).map((s) => s.match(/ ON ([\w."]+)$/i)![1]),
      ...matching(/^CREATE (?:UNIQUE )?INDEX/i).map((s) => s.match(/ ON ([\w."]+) /i)![1]),
      ...matching(/^(CREATE|DROP) POLICY/i).map((s) => s.match(/ ON ([\w."]+)/i)![1]),
      ...matching(/^COMMENT ON TABLE/i).map((s) => s.match(/^COMMENT ON TABLE ([\w."]+)/i)![1]),
    ].map(tableName);
    expect(targets.length).toBeGreaterThan(20);
    for (const t of targets) expect(NEW_TABLES as readonly string[]).toContain(t);
  });

  it("drops nothing but its own policies and triggers, and writes no rows", () => {
    for (const s of matching(/^DROP /i)) expect(s).toMatch(/^DROP (POLICY|TRIGGER) IF EXISTS /i);
    expect(matching(/^(TRUNCATE|DELETE|UPDATE|INSERT|MERGE|COPY)\b/i)).toEqual([]);
    expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|SCHEMA|TYPE|INDEX)\b/i);
    expect(code).not.toMatch(/\bpublic\.tenants\s+(ADD|ALTER|DROP)\b/i);
  });

  it("creates only its own two functions", () => {
    const names = matching(/^CREATE (?:OR REPLACE )?FUNCTION/i).map((s) => s.match(/FUNCTION public\.(\w+)\(/i)![1]);
    expect(names.sort()).toEqual([...NEW_FUNCTIONS].sort());
  });
});

describe("ops/notifications_v2.sql: access", () => {
  it("switches RLS on for all three new tables", () => {
    for (const t of NEW_TABLES) {
      expect(matching(new RegExp(`^ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY$`, "i"))).toHaveLength(1);
    }
  });

  it("revokes everything from anon and authenticated before granting", () => {
    const revoke = matching(/^REVOKE ALL ON public\./i);
    expect(revoke).toHaveLength(1);
    expect(revoke[0]).toMatch(/FROM anon, authenticated$/);
    for (const t of NEW_TABLES) expect(revoke[0]).toContain(`public.${t}`);
    const firstGrant = statements.findIndex((s) => /^GRANT /i.test(s));
    expect(statements.indexOf(revoke[0])).toBeLessThan(firstGrant);
    expect(matching(/^GRANT .* TO (.*\b)?anon\b/i)).toEqual([]);
  });

  it("lets browsers read the test-send log but never write it", () => {
    const grants = matching(/^GRANT .*notification_test_sends_v2.* TO authenticated$/i);
    expect(grants).toEqual(["GRANT SELECT ON public.notification_test_sends_v2 TO authenticated"]);
    const policies = matching(/^CREATE POLICY \w+ ON public\.notification_test_sends_v2 /i);
    for (const p of policies) expect(p).toMatch(/FOR SELECT TO authenticated|FOR ALL TO service_role/);
  });

  it("revokes EXECUTE on its functions from PUBLIC and anon", () => {
    for (const fn of NEW_FUNCTIONS) {
      expect(matching(new RegExp(`^REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon`, "i"))).toHaveLength(1);
    }
  });

  it("scopes staff through an active app_users row, never get_user_tenant_id()", () => {
    expect(code).not.toMatch(/get_user_tenant_id/i);
    const staff = matching(/^CREATE POLICY .* TO authenticated/i);
    expect(staff.length).toBe(9);
    for (const p of staff) {
      expect(p).toMatch(/au\.auth_user_id = auth\.uid\(\)/);
      expect(p).toMatch(/au\.is_active IS TRUE/);
      expect(p).toMatch(/OR public\.is_super_admin\(\)/);
    }
  });

  it("keeps viewers (and managers without an editor grant) out of every write", () => {
    const writes = matching(/^CREATE POLICY .* FOR (INSERT|UPDATE|DELETE) TO authenticated/i);
    expect(writes).toHaveLength(6);
    for (const p of writes) {
      expect(p).toMatch(/au\.role <> 'viewer'/);
      expect(p).toMatch(/mp\.tab_key = 'settings\.reminders' AND mp\.access_level = 'editor'/);
    }
  });

  it("gives service_role a policy on every table", () => {
    for (const t of NEW_TABLES) {
      expect(matching(new RegExp(`^CREATE POLICY \\w+ ON public\\.${t} FOR ALL TO service_role USING \\(true\\) WITH CHECK \\(true\\)$`, "i"))).toHaveLength(1);
    }
  });
});

describe("ops/notifications_v2.sql: agrees with the TypeScript", () => {
  const sqlRegex = (column: string) => {
    const m = code.match(new RegExp(`${column} ~ '([^']+)'`));
    expect(m, `a ${column} pattern`).toBeTruthy();
    return m![1];
  };
  const limit = (re: RegExp) => {
    const m = code.replace(/\s+/g, " ").match(re);
    expect(m, String(re)).toBeTruthy();
    return Number(m![1]);
  };

  it("uses the same notification key rule as the hook, and every catalog key fits it", () => {
    const pattern = sqlRegex("notification_key");
    expect(pattern).toBe(NOTIFICATION_KEY_PATTERN.source);
    const re = new RegExp(pattern);
    for (const item of NOTIFICATION_CATALOG) expect(item.key).toMatch(re);
  });

  it("uses the same sender local-part rule as settings-model", () => {
    expect(sqlRegex("from_local_part")).toBe(LOCAL_PART_PATTERN.source);
  });

  it("lets only a dot or an underscore follow the slug, as settings-model and the test function do", () => {
    // A dash would let tenant "open" send as "open-bay@", tenant open-bay's default.
    const guard = matching(/FUNCTION public\.tenant_email_sender_guard/)[0];
    expect(guard).toBeTruthy();
    expect(guard).toContain("substr(NEW.from_local_part, v_len + 1, 1) IN ('.', '_')");
    expect(guard).not.toMatch(/IN \([^)]*'-'/);
    expect(isValidLocalPart("open-bay", "open").ok).toBe(false);
    expect(isValidLocalPart("open.bay", "open").ok).toBe(true);
    const edge = readFileSync(join(repo, "supabase", "functions", "notification-test-v2", "index.ts"), "utf8");
    expect(edge).toContain("value.startsWith(s) && (sep === '.' || sep === '_') && value.length > s.length + 1");
    expect(edge).not.toMatch(/sep === '-'/);
  });

  it("allows exactly the three channels", () => {
    const m = code.match(/channel IN \(([^)]+)\)\),/);
    expect(m).toBeTruthy();
    const channels = m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    expect(channels).toEqual([...NOTIFICATION_CHANNELS]);
  });

  it("caps text at the page's limits", () => {
    expect(limit(/btrim\(subject[^)]*\)\) <= (\d+)/)).toBe(EMAIL_SUBJECT_MAX);
    const title = limit(/btrim\(title[^)]*\)\) <= (\d+)/);
    expect(title).toBe(PUSH_TITLE_MAX);
    expect(title).toBe(IN_APP_TITLE_MAX);
    expect(limit(/WHEN 'push' THEN char_length\(btrim\(body[^)]*\)\) <= (\d+)/)).toBe(PUSH_BODY_MAX);
    expect(limit(/WHEN 'in_app' THEN char_length\(btrim\(body[^)]*\)\) <= (\d+)/)).toBe(IN_APP_BODY_MAX);
  });

  it("accepts exactly the push options settings-model writes", () => {
    const m = code.replace(/\s+/g, " ").match(/\(push_options((?: - '\w+')+)\) = '\{\}'::jsonb/);
    expect(m).toBeTruthy();
    const keys = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(keys.sort()).toEqual([...PUSH_OPTION_KEYS].sort());
  });
});
