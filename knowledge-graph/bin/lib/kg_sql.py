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
SCHEMA = r'(?:(?:public|auth|storage|extensions)\s*\.\s*)?'

RE_CREATE_TABLE = re.compile(
    rf'create\s+table\s+(?:if\s+not\s+exists\s+)?{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_ALTER_TABLE = re.compile(
    rf'alter\s+table\s+(?:only\s+)?{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_FUNCTION = re.compile(
    rf'create\s+(?:or\s+replace\s+)?function\s+{Q}{SCHEMA}{Q}{NAME}{Q}\s*\(', re.I)
RE_TRIGGER = re.compile(
    rf'create\s+(?:or\s+replace\s+)?trigger\s+{Q}{NAME}{Q}(.*?)(?:;|$)', re.I | re.S)
RE_POLICY = re.compile(
    rf'create\s+policy\s+{Q}([^"\']+?){Q}\s+on\s+{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_ENUM = re.compile(
    rf'create\s+type\s+{Q}{SCHEMA}{Q}{NAME}{Q}\s+as\s+enum', re.I)
RE_INDEX = re.compile(
    rf'create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?'
    rf'{Q}{NAME}{Q}\s+on\s+{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_REFERENCES = re.compile(
    rf'references\s+{Q}{SCHEMA}{Q}{NAME}{Q}\s*\(', re.I)
RE_RLS = re.compile(
    rf'alter\s+table\s+(?:only\s+)?{Q}{SCHEMA}{Q}{NAME}{Q}\s+enable\s+row\s+level\s+security', re.I)
RE_VIEW = re.compile(
    rf'create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?'
    rf'{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_TRG_ON = re.compile(rf'\son\s+{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)
RE_TRG_EXEC = re.compile(
    rf'execute\s+(?:procedure|function)\s+{Q}{SCHEMA}{Q}{NAME}{Q}', re.I)

# Column capture inside a CREATE TABLE ( ... ) body
RE_COL = re.compile(r'^\s*"?([a-z_][a-z0-9_]*)"?\s+([a-z][a-z0-9_ \[\]]*)', re.I | re.M)
SQL_KEYWORDS = {
    'constraint', 'primary', 'unique', 'foreign', 'check', 'exclude', 'like',
    'create', 'alter', 'drop', 'if', 'not', 'references', 'on', 'default',
}


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
            t = m.group(1).lower()
            tid = _sid("tbl", t)
            loc = _line_of(sql, m.start())
            node = add(tid, t, "table", src, loc, columns=[], created_by=src)
            tables.setdefault(tid, node)
            body = _table_body(sql, m.end())
            cols = []
            for cm in RE_COL.finditer(body):
                cname, ctype = cm.group(1).lower(), cm.group(2).strip().lower()
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
                target = _sid("tbl", rm.group(1).lower())
                if target != tid:
                    edge(tid, target, "references", "EXTRACTED", 1.0, src, loc)

        for m in RE_VIEW.finditer(sql):
            vid = _sid("view", m.group(1).lower())
            loc = _line_of(sql, m.start())
            add(vid, m.group(1).lower(), "view", src, loc)
            edge(mig_id, vid, "creates", "EXTRACTED", 1.0, src, loc)

        for m in RE_ENUM.finditer(sql):
            eid = _sid("enum", m.group(1).lower())
            loc = _line_of(sql, m.start())
            add(eid, m.group(1).lower(), "enum", src, loc)
            edge(mig_id, eid, "creates", "EXTRACTED", 1.0, src, loc)

        for m in RE_FUNCTION.finditer(sql):
            fid = _sid("fn", m.group(1).lower())
            loc = _line_of(sql, m.start())
            add(fid, f"{m.group(1).lower()}()", "sql_function", src, loc)
            edge(mig_id, fid, "defines", "EXTRACTED", 1.0, src, loc)

        for m in RE_TRIGGER.finditer(sql):
            trg, tail = m.group(1).lower(), m.group(2) or ""
            gid = _sid("trg", trg)
            loc = _line_of(sql, m.start())
            add(gid, trg, "trigger", src, loc)
            edge(mig_id, gid, "defines", "EXTRACTED", 1.0, src, loc)
            on = RE_TRG_ON.search(tail)
            if on:
                edge(gid, _sid("tbl", on.group(1).lower()), "fires_on", "EXTRACTED", 1.0, src, loc)
            ex = RE_TRG_EXEC.search(tail)
            if ex:
                edge(gid, _sid("fn", ex.group(1).lower()), "executes", "EXTRACTED", 1.0, src, loc)

        for m in RE_POLICY.finditer(sql):
            pname, tbl = m.group(1).strip(), m.group(2).lower()
            h = hashlib.sha256(pname.encode()).hexdigest()[:8]
            pid = _sid("pol", f"{tbl}_{h}")
            loc = _line_of(sql, m.start())
            add(pid, f"RLS: {pname}", "rls_policy", src, loc, policy_on=tbl)
            edge(pid, _sid("tbl", tbl), "secures", "EXTRACTED", 1.0, src, loc)

        for m in RE_INDEX.finditer(sql):
            iid = _sid("idx", m.group(1).lower())
            loc = _line_of(sql, m.start())
            add(iid, m.group(1).lower(), "index", src, loc)
            edge(iid, _sid("tbl", m.group(2).lower()), "indexes", "EXTRACTED", 1.0, src, loc)

        for m in RE_RLS.finditer(sql):
            tid = _sid("tbl", m.group(1).lower())
            if tid in nodes:
                nodes[tid]["rls_enabled"] = True

        # ALTER TABLE ... REFERENCES outside a CREATE body
        for m in RE_ALTER_TABLE.finditer(sql):
            tid = _sid("tbl", m.group(1).lower())
            seg = sql[m.end():m.end() + 600]
            for rm in RE_REFERENCES.finditer(seg):
                target = _sid("tbl", rm.group(1).lower())
                if target != tid:
                    edge(tid, target, "references", "EXTRACTED", 1.0, src,
                         _line_of(sql, m.start()))

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
