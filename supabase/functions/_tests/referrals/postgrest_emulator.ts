// A PostgREST emulator over PGlite: enough of PostgREST's HTTP surface for
// supabase-js (postgrest-js) to run the referral functions against real SQL.
//
// Output is built with json_agg(row) and input goes through
// jsonb_populate_record(set) — the same mechanisms PostgREST uses — so types,
// defaults, constraint errors and JSON shapes match production.
// deno-lint-ignore-file no-explicit-any

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const IDENT = /^[a-z_][a-z0-9_]*$/;

class RestError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.message));
  }
}

function ident(name: string): string {
  if (!IDENT.test(name)) throw new RestError(400, { code: "PGRST100", message: `bad identifier: ${name}`, details: null, hint: null });
  return `"${name}"`;
}

// ── logic trees: or=(a.eq.1,b.is.null,and(c.gt.2,d.lt.3)) ──────────────────
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"' && s[i - 1] !== "\\") quoted = !quoted;
    if (!quoted) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function unquote(v: string): string {
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\"/g, '"') : v;
}

class Sql {
  params: unknown[] = [];
  ph(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

/** `op.value` (optionally `not.op.value`) against one column. */
function condition(sql: Sql, qual: string, col: string, expr: string): string {
  let negate = false;
  if (expr.startsWith("not.")) { negate = true; expr = expr.slice(4); }
  const dot = expr.indexOf(".");
  if (dot < 0) throw new RestError(400, { code: "PGRST100", message: `bad filter ${col}=${expr}`, details: null, hint: null });
  const op = expr.slice(0, dot);
  const raw = expr.slice(dot + 1);
  const c = `${qual}${ident(col)}`;
  let out: string;
  switch (op) {
    case "eq": out = `${c} = ${sql.ph(unquote(raw))}`; break;
    case "neq": out = `${c} <> ${sql.ph(unquote(raw))}`; break;
    case "gt": out = `${c} > ${sql.ph(unquote(raw))}`; break;
    case "gte": out = `${c} >= ${sql.ph(unquote(raw))}`; break;
    case "lt": out = `${c} < ${sql.ph(unquote(raw))}`; break;
    case "lte": out = `${c} <= ${sql.ph(unquote(raw))}`; break;
    case "like": out = `${c}::text LIKE ${sql.ph(unquote(raw).replace(/\*/g, "%"))}`; break;
    case "ilike": out = `${c}::text ILIKE ${sql.ph(unquote(raw).replace(/\*/g, "%"))}`; break;
    case "is": {
      const v = raw.toLowerCase();
      if (!["null", "true", "false", "unknown"].includes(v)) throw new RestError(400, { code: "PGRST100", message: `bad is.${raw}`, details: null, hint: null });
      out = `${c} IS ${v.toUpperCase()}`;
      break;
    }
    case "in": {
      if (!raw.startsWith("(") || !raw.endsWith(")")) throw new RestError(400, { code: "PGRST100", message: `bad in.${raw}`, details: null, hint: null });
      const items = splitTop(raw.slice(1, -1)).map(unquote);
      out = items.length ? `${c} IN (${items.map(v => sql.ph(v)).join(", ")})` : "false";
      break;
    }
    case "cs": {
      const v = unquote(raw);
      out = v.startsWith("{\"") || v.startsWith("[") || v === "{}" ? `${c} @> ${sql.ph(v)}::jsonb` : `${c} @> ${sql.ph(v)}`;
      break;
    }
    default:
      throw new RestError(400, { code: "PGRST100", message: `unsupported operator ${op}`, details: null, hint: null });
  }
  return negate ? `NOT (${out})` : out;
}

function logicTree(sql: Sql, qual: string, kind: "or" | "and", body: string): string {
  if (!body.startsWith("(") || !body.endsWith(")")) throw new RestError(400, { code: "PGRST100", message: `bad ${kind}=${body}`, details: null, hint: null });
  const parts = splitTop(body.slice(1, -1)).map(part => {
    const m = part.match(/^(not\.)?(or|and)(\(.*\))$/s);
    if (m) {
      const inner = logicTree(sql, qual, m[2] as "or" | "and", m[3]);
      return m[1] ? `NOT (${inner})` : inner;
    }
    const dot = part.indexOf(".");
    return condition(sql, qual, part.slice(0, dot), part.slice(dot + 1));
  });
  return `(${parts.join(kind === "or" ? " OR " : " AND ")})`;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function whereClause(sql: Sql, qual: string, params: URLSearchParams): string {
  const conds: string[] = [];
  for (const [key, value] of params) {
    if (RESERVED.has(key)) continue;
    if (key === "or" || key === "and") conds.push(logicTree(sql, qual, key, value));
    else if (key === "not.or" || key === "not.and") conds.push(`NOT ${logicTree(sql, qual, key.slice(4) as "or" | "and", value)}`);
    else conds.push(condition(sql, qual, key, value));
  }
  return conds.length ? `WHERE ${conds.join(" AND ")}` : "";
}

function selectList(select: string | null, qual = ""): string {
  if (!select || select === "*") return "*";
  const items = splitTop(select.replace(/\s+/g, ""));
  return items.map(item => {
    if (item === "*") return `${qual}*`;
    if (item.includes("(")) throw new RestError(400, { code: "PGRST200", message: `embedded resources are not emulated: ${item}`, details: null, hint: null });
    let alias: string | null = null;
    let expr = item;
    const colon = item.indexOf(":");
    if (colon > 0 && item[colon + 1] !== ":") { alias = item.slice(0, colon); expr = item.slice(colon + 1); }
    expr = expr.replace(/^"(.*)"$/, "$1"); // PostgREST accepts quoted names ("interval")
    let cast = "";
    const cc = expr.indexOf("::");
    if (cc > 0) { cast = expr.slice(cc + 2); expr = expr.slice(0, cc); }
    const col = `${qual}${ident(expr)}${cast ? `::${cast.replace(/[^a-z0-9_]/g, "")}` : ""}`;
    return alias ? `${col} AS ${ident(alias)}` : (cast ? `${col} AS ${ident(expr)}` : col);
  }).join(", ");
}

function orderClause(order: string | null): string {
  if (!order) return "";
  const parts = order.split(",").map(p => {
    const [col, ...mods] = p.split(".");
    let s = ident(col);
    if (mods.includes("desc")) s += " DESC";
    if (mods.includes("asc")) s += " ASC";
    if (mods.includes("nullsfirst")) s += " NULLS FIRST";
    if (mods.includes("nullslast")) s += " NULLS LAST";
    return s;
  });
  return `ORDER BY ${parts.join(", ")}`;
}

function prefer(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("Prefer") ?? "").split(",")) {
    const [k, v] = part.trim().split("=");
    if (k) out[k] = v ?? "";
  }
  return out;
}

function pgError(e: any): RestError {
  const code = String(e?.code ?? "XX000");
  const status = code === "23505" || code === "23503" ? 409 : /^(22|23|42|P0)/.test(code) ? 400 : 500;
  return new RestError(status, { code, message: e?.message ?? String(e), details: e?.detail ?? null, hint: e?.hint ?? null });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export type RestLog = { method: string; path: string; status: number; error?: string };

export function makeRest(db: Db, log: RestLog[]) {
  async function run(sql: string, params: unknown[]) {
    try {
      return await db.query(sql, params);
    } catch (e) {
      throw pgError(e);
    }
  }

  function shape(req: Request, rows: any[], status: number, count?: number | null): Response {
    const singular = (req.headers.get("Accept") ?? "").includes("application/vnd.pgrst.object+json");
    const headers: Record<string, string> = {};
    const range = rows.length ? `0-${rows.length - 1}` : "*";
    headers["Content-Range"] = `${range}/${count ?? "*"}`;
    if (singular) {
      if (rows.length !== 1) {
        return json({ code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null }, 406);
      }
      return json(rows[0], status, headers);
    }
    return json(rows, status, headers);
  }

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/rest\/v1\//, "");
    const params = url.searchParams;
    const pref = prefer(req);
    let status = 200;
    try {
      // ── RPC ───────────────────────────────────────────────────────────
      if (path.startsWith("rpc/")) {
        const fn = path.slice(4);
        const args = req.method === "GET" ? Object.fromEntries(params) : await req.json().catch(() => ({}));
        const sql = new Sql();
        const named = Object.entries(args).map(([k, v]) => `${ident(k)} => ${sql.ph(typeof v === "object" && v !== null ? JSON.stringify(v) : v)}`);
        const r = await run(`SELECT to_json(public.${ident(fn)}(${named.join(", ")})) AS v`, sql.params);
        const res = json(r.rows[0]?.v ?? null);
        log.push({ method: req.method, path, status: 200 });
        return res;
      }

      const table = path;
      const t = `"public".${ident(table)}`;
      const qual = `${ident(table)}.`;
      const sel = selectList(params.get("select"));
      const limit = params.get("limit");
      const offset = params.get("offset");
      const tail = `${orderClause(params.get("order"))} ${limit ? `LIMIT ${Number(limit)}` : ""} ${offset ? `OFFSET ${Number(offset)}` : ""}`;

      if (req.method === "GET" || req.method === "HEAD") {
        const sql = new Sql();
        const where = whereClause(sql, qual, params);
        let count: number | null = null;
        if (pref.count) {
          const c = await run(`SELECT count(*)::int AS n FROM ${t} ${where}`, sql.params);
          count = c.rows[0].n;
        }
        if (req.method === "HEAD") {
          log.push({ method: req.method, path, status: 200 });
          return new Response(null, { status: 200, headers: { "Content-Range": `*/${count ?? "*"}` } });
        }
        const r = await run(`SELECT coalesce(json_agg(_r), '[]'::json) AS body FROM (SELECT ${sel} FROM ${t} ${where} ${tail}) _r`, sql.params);
        const res = shape(req, r.rows[0].body, 200, count);
        log.push({ method: req.method, path, status: res.status });
        return res;
      }

      const wantRows = (pref.return ?? "minimal") === "representation";
      // UPDATE ... FROM exposes the payload's columns too: return the table's only.
      const returning = (inner: string, sql: Sql, ret = "*") =>
        run(`WITH _w AS (${inner} RETURNING ${ret}) SELECT coalesce(json_agg(_r), '[]'::json) AS body FROM (SELECT ${sel} FROM _w) _r`, sql.params);

      if (req.method === "POST") {
        const body = await req.json();
        const rowsIn: Record<string, unknown>[] = Array.isArray(body) ? body : [body];
        const cols = [...new Set(rowsIn.flatMap(r => Object.keys(r)))];
        if (cols.length === 0) throw new RestError(400, { code: "PGRST102", message: "empty body", details: null, hint: null });
        const sql = new Sql();
        const colList = cols.map(ident).join(", ");
        let conflict = "";
        if (pref.resolution) {
          const target = (params.get("on_conflict") ?? "id").split(",").map(s => ident(s.trim())).join(", ");
          if (pref.resolution === "ignore-duplicates") conflict = `ON CONFLICT (${target}) DO NOTHING`;
          else {
            const targetSet = new Set((params.get("on_conflict") ?? "id").split(",").map(s => s.trim()));
            const sets = cols.filter(c => !targetSet.has(c)).map(c => `${ident(c)} = EXCLUDED.${ident(c)}`);
            conflict = sets.length ? `ON CONFLICT (${target}) DO UPDATE SET ${sets.join(", ")}` : `ON CONFLICT (${target}) DO NOTHING`;
          }
        }
        const inner = `INSERT INTO ${t} (${colList}) SELECT ${colList} FROM jsonb_populate_recordset(NULL::${t}, ${sql.ph(JSON.stringify(rowsIn))}::jsonb) ${conflict}`;
        const r = await returning(inner, sql);
        status = 201;
        const res = wantRows ? shape(req, r.rows[0].body, status) : new Response(null, { status });
        log.push({ method: req.method, path, status: res.status });
        return res;
      }

      if (req.method === "PATCH") {
        const body = await req.json();
        const cols = Object.keys(body);
        if (cols.length === 0) throw new RestError(400, { code: "PGRST102", message: "empty body", details: null, hint: null });
        const sql = new Sql();
        const payload = sql.ph(JSON.stringify(body));
        const where = whereClause(sql, qual, params);
        const sets = cols.map(c => `${ident(c)} = _p.${ident(c)}`).join(", ");
        const inner = `UPDATE ${t} SET ${sets} FROM jsonb_populate_record(NULL::${t}, ${payload}::jsonb) AS _p ${where}`;
        const r = await returning(inner, sql, `${qual}*`);
        const res = wantRows ? shape(req, r.rows[0].body, 200) : new Response(null, { status: 204 });
        log.push({ method: req.method, path, status: res.status });
        return res;
      }

      if (req.method === "DELETE") {
        const sql = new Sql();
        const where = whereClause(sql, qual, params);
        const r = await returning(`DELETE FROM ${t} ${where}`, sql);
        const res = wantRows ? shape(req, r.rows[0].body, 200) : new Response(null, { status: 204 });
        log.push({ method: req.method, path, status: res.status });
        return res;
      }

      throw new RestError(405, { code: "PGRST000", message: `method ${req.method}`, details: null, hint: null });
    } catch (e) {
      const err = e instanceof RestError ? e : pgError(e);
      log.push({ method: req.method, path, status: err.status, error: String(err.body.message) });
      return json(err.body, err.status);
    }
  };
}
