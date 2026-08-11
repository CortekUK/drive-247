"""Stage 2b - SQL: structural extraction for Postgres migrations.

graphify's classifier has no '.sql' extension, so 335 migration files - the
authoritative description of this product's data model - are invisible to it.
This module fills that gap with a purpose-built regex extractor.

Design note: columns are stored as an *attribute* on the table node rather than
as nodes of their own. 80 tables x ~20 columns would add ~1600 leaf nodes that
dominate community detection without adding architectural signal.

Writes units/database/graphify-out/.graphify_ast.json (same shape as the AST
stage, so every downstream stage treats SQL exactly like any other unit).
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import STATE, UNIT_BY_NAME, unit_out, load_json, write_json, rel, REPO  # noqa: E402

Q = r'["\']?'                       # optional quoting
NAME = r'([a-zA-Z_][a-zA-Z0-9_]*)'
# An identifier may be bare or double-quoted, and may be schema-qualified in
# either style. This matters: supabase db pull writes pg_dump-style
# `"public"."agreement_templates"`, and a pattern that treats the quote as a
# single optional character captures the SCHEMA as the table name - which
# collapsed all 55 tables of the baseline remote_schema.sql into one node
# labelled "public".
IDENT = r'(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)'
QUAL = rf'(?:{IDENT}\s*\.\s*)?({IDENT})'
SCHEMAS = {"public", "auth", "storage", "extensions", "graphql", "realtime", "vault"}

RE_CREATE_TABLE = re.compile(rf'create\s+table\s+(?:if\s+not\s+exists\s+)?{QUAL}', re.I)
RE_ALTER_TABLE = re.compile(rf'alter\s+table\s+(?:only\s+)?{QUAL}', re.I)
RE_FUNCTION = re.compile(rf'create\s+(?:or\s+replace\s+)?function\s+{QUAL}\s*\(', re.I)
RE_TRIGGER = re.compile(
    rf'create\s+(?:or\s+replace\s+)?trigger\s+({IDENT})(.*?)(?:;|$)', re.I | re.S)
RE_POLICY = re.compile(
    rf'create\s+policy\s+(?:"([^"]+)"|\'([^\']+)\'|([A-Za-z_][A-Za-z0-9_]*))'
    rf'\s+on\s+{QUAL}', re.I)
RE_ENUM = re.compile(rf'create\s+type\s+{QUAL}\s+as\s+enum', re.I)
RE_INDEX = re.compile(
    rf'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?'
    rf'({IDENT})\s+on\s+{QUAL}', re.I)
RE_REFERENCES = re.compile(rf'references\s+{QUAL}\s*\(', re.I)
RE_RLS = re.compile(
    rf'alter\s+table\s+(?:only\s+)?{QUAL}\s+enable\s+row\s+level\s+security', re.I)
RE_VIEW = re.compile(
    rf'create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+'
    rf'(?:if\s+not\s+exists\s+)?{QUAL}', re.I)
RE_TRG_ON = re.compile(rf'\son\s+{QUAL}', re.I)
RE_TRG_EXEC = re.compile(rf'execute\s+(?:procedure|function)\s+{QUAL}', re.I)

# Column capture inside a CREATE TABLE ( ... ) body. pg_dump quotes the type as
# well (`"id" "uuid" DEFAULT ...`), so both sides must tolerate quoting.
RE_COL = re.compile(
    r'^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s+"?([A-Za-z][A-Za-z0-9_ \[\]]*)"?', re.M)
SQL_KEYWORDS = {
    'constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like',
    'create', 'alter', 'drop', 'if', 'not', 'references', 'on', 'default',
}


def _unq(s: str) -> str:
    """Strip surrounding double quotes from an identifier."""
    s = (s or "").strip()
    return s[1:-1] if len(s) > 1 and s[0] == '"' and s[-1] == '"' else s


def _name(m: re.Match, group: int = 1) -> str:
    return _unq(m.group(group)).lower()


def _sid(prefix: str, name: str) -> str:
    return f"{prefix}_{re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')}"


def _strip_comments(sql: str) -> str:
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    sql = re.sub(r'--[^\n]*', ' ', sql)
    return sql


def _line_of(text: str, idx: int) -> str:
    return f"L{text.count(chr(10), 0, idx) + 1}"


def _table_body(sql: str, start: int) -> str:
    """Return the parenthesised body of a CREATE TABLE starting at `start`."""
    i = sql.find('(', start)
    if i == -1:
        return ""
    depth, j = 0, i
    while j < len(sql):
        if sql[j] == '(':
            depth += 1
        elif sql[j] == ')':
            depth -= 1
            if depth == 0:
                return sql[i + 1:j]
        j += 1
    return sql[i + 1:min(len(sql), i + 4000)]


def collect_sql_files() -> list[Path]:
    unit = UNIT_BY_NAME["database"]
    files: list[Path] = []
    for r in unit["paths"]:
        p = REPO / r
        if p.is_dir():
            files.extend(sorted(p.rglob("*.sql")))
        elif p.is_file() and p.suffix.lower() == ".sql":
            files.append(p)
    return files


def run() -> dict:
    files = collect_sql_files()
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    tables: dict[str, dict] = {}

    def add(nid, label, kind, src, loc, **extra):
        if nid not in nodes:
            nodes[nid] = {
                "id": nid, "label": label, "file_type": "code", "kind": kind,
                "source_file": src, "source_location": loc, "unit": "database", **extra,
            }
        return nodes[nid]

    def edge(s, t, relation, conf, score, src, loc=None):
        edges.append({
            "source": s, "target": t, "relation": relation, "confidence": conf,
            "confidence_score": score, "source_file": src, "source_location": loc,
            "weight": 1.0,
        })

    for f in files:
        raw = f.read_text(encoding="utf-8", errors="ignore")
        sql = _strip_comments(raw)
        src = rel(f)
        mig_id = _sid("mig", f.stem)
        add(mig_id, f.name, "migration", src, "L1")

        for m in RE_CREATE_TABLE.finditer(sql):
            t = _name(m)
            if t in SCHEMAS:
                continue
            tid = _sid("tbl", t)
            loc = _line_of(sql, m.start())
            node = add(tid, t, "table", src, loc, columns=[], created_by=src)
            tables.setdefault(tid, node)
            body = _table_body(sql, m.end())
            cols = []
            for cm in RE_COL.finditer(body):
                cname, ctype = _unq(cm.group(1)).lower(), _unq(cm.group(2).strip()).lower()
                if cname in SQL_KEYWORDS:
                    continue
                cols.append(f"{cname} {ctype}")
            existing = node.setdefault("columns", [])
            for c in cols:
                if c not in existing:
                    existing.append(c)
            edge(mig_id, tid, "creates", "EXTRACTED", 1.0, src, loc)
            # foreign keys declared inside this table body
            for rm in RE_REFERENCES.finditer(body):
                rt = _name(rm)
                if rt in SCHEMAS:
                    continue
                target = _sid("tbl", rt)
                if target != tid:
                    edge(tid, target, "references", "EXTRACTED", 1.0, src, loc)

        for m in RE_VIEW.finditer(sql):
            v = _name(m)
            if v in SCHEMAS:
                continue
            vid = _sid("view", v)
            loc = _line_of(sql, m.start())
            add(vid, v, "view", src, loc)
            edge(mig_id, vid, "creates", "EXTRACTED", 1.0, src, loc)

        for m in RE_ENUM.finditer(sql):
            e_ = _name(m)
            eid = _sid("enum", e_)
            loc = _line_of(sql, m.start())
            add(eid, e_, "enum", src, loc)
            edge(mig_id, eid, "creates", "EXTRACTED", 1.0, src, loc)

        for m in RE_FUNCTION.finditer(sql):
            fn = _name(m)
            fid = _sid("fn", fn)
            loc = _line_of(sql, m.start())
            add(fid, f"{fn}()", "sql_function", src, loc)
            edge(mig_id, fid, "defines", "EXTRACTED", 1.0, src, loc)

        for m in RE_TRIGGER.finditer(sql):
            trg, tail = _name(m), m.group(2) or ""
            gid = _sid("trg", trg)
            loc = _line_of(sql, m.start())
            add(gid, trg, "trigger", src, loc)
            edge(mig_id, gid, "defines", "EXTRACTED", 1.0, src, loc)
            on = RE_TRG_ON.search(tail)
            if on and _name(on) not in SCHEMAS:
                edge(gid, _sid("tbl", _name(on)), "fires_on", "EXTRACTED", 1.0, src, loc)
            ex = RE_TRG_EXEC.search(tail)
            if ex:
                edge(gid, _sid("fn", _name(ex)), "executes", "EXTRACTED", 1.0, src, loc)

        for m in RE_POLICY.finditer(sql):
            pname = (m.group(1) or m.group(2) or m.group(3) or "").strip()
            tbl = _unq(m.group(4)).lower()
            if tbl in SCHEMAS:
                continue
            h = hashlib.sha256(pname.encode()).hexdigest()[:8]
            pid = _sid("pol", f"{tbl}_{h}")
            loc = _line_of(sql, m.start())
            add(pid, f"RLS: {pname}", "rls_policy", src, loc, policy_on=tbl)
            edge(pid, _sid("tbl", tbl), "secures", "EXTRACTED", 1.0, src, loc)
            edge(mig_id, pid, "defines", "EXTRACTED", 1.0, src, loc)

        for m in RE_INDEX.finditer(sql):
            idx_name, on_tbl = _name(m, 1), _unq(m.group(2)).lower()
            if on_tbl in SCHEMAS:
                continue
            iid = _sid("idx", idx_name)
            loc = _line_of(sql, m.start())
            add(iid, idx_name, "index", src, loc)
            edge(iid, _sid("tbl", on_tbl), "indexes", "EXTRACTED", 1.0, src, loc)
            edge(mig_id, iid, "defines", "EXTRACTED", 1.0, src, loc)

        for m in RE_RLS.finditer(sql):
            tid = _sid("tbl", _name(m))
            if tid in nodes:
                nodes[tid]["rls_enabled"] = True

        for m in RE_ALTER_TABLE.finditer(sql):
            at = _name(m)
            if at in SCHEMAS:
                continue
            tid = _sid("tbl", at)
            loc = _line_of(sql, m.start())
            # Without this, a migration that only ALTERs a table produces no
            # edges at all and lands as an isolated node - which was most of the
            # 277 single-node "communities" in the database unit.
            edge(mig_id, tid, "alters", "EXTRACTED", 1.0, src, loc)
            seg = sql[m.end():m.end() + 600]
            for rm in RE_REFERENCES.finditer(seg):
                rt = _name(rm)
                if rt in SCHEMAS:
                    continue
                target = _sid("tbl", rt)
                if target != tid:
                    edge(tid, target, "references", "EXTRACTED", 1.0, src, loc)

    # Drop edges pointing at tables that were never created (e.g. auth.users),
    # but keep the referenced entity as an explicit external node.
    known = set(nodes)
    for e in edges:
        for endpoint in ("source", "target"):
            nid = e[endpoint]
            if nid not in known and nid.startswith(("tbl_", "fn_")):
                kind = "external_table" if nid.startswith("tbl_") else "external_function"
                nodes[nid] = {
                    "id": nid, "label": nid.split("_", 1)[1], "file_type": "code",
                    "kind": kind, "source_file": None, "source_location": None,
                    "unit": "database", "external": True,
                }
                known.add(nid)

    result = {"nodes": list(nodes.values()), "edges": edges,
              "input_tokens": 0, "output_tokens": 0}
    write_json(unit_out("database") / ".graphify_ast.json", result)

    # register the unit in detect.json so downstream stages see it
    det = load_json(STATE / "detect.json", {}) or {}
    srcs = [rel(f) for f in files]
    det["database"] = {
        "files": {"code": [str(f) for f in files]},
        "total_files": len(files),
        "total_words": sum(len(Path(f).read_text(errors="ignore").split()) for f in files),
        "counts": {"code": len(files)},
        "semantic_candidates": [str(f) for f in files],
        "ast_only": [],
    }
    write_json(STATE / "detect.json", det)

    kinds: dict[str, int] = {}
    for n in nodes.values():
        kinds[n["kind"]] = kinds.get(n["kind"], 0) + 1
    print(f"database         SQL: {len(nodes)} nodes, {len(edges)} edges from {len(files)} files")
    for k, v in sorted(kinds.items(), key=lambda x: -x[1]):
        print(f"    {k:20s} {v}")
    return result


if __name__ == "__main__":
    run()
