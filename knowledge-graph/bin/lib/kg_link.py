"""Stage 5 - link: derive the cross-unit seams.

Per-unit graphs are extracted in isolation, so nothing in them connects a portal
hook to the edge function it calls, or an edge function to the table it writes.
Those seams are what makes the merged graph a system map instead of nine
disconnected islands.

They are derived deterministically from source rather than guessed by an agent:
grep-level evidence is exact, costs nothing, and re-runs on every incremental
update, so the seam layer can never drift from the code.

Precision guard: a captured name only becomes an edge if the target actually
exists (a real table in the migrations, a real supabase/functions/<name>/ dir).
That is what keeps `Array.from(...)` and friends out of the table graph.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import REPO, STATE, load_json  # noqa: E402

RE_INVOKE = re.compile(r"""functions\s*\.\s*invoke\(\s*['"`]([A-Za-z0-9_\-]+)['"`]""")
RE_FN_URL = re.compile(r"""/functions/v1/([A-Za-z0-9_\-]+)""")
RE_STORAGE = re.compile(r"""storage\s*\.\s*from\(\s*['"`]([A-Za-z0-9_\-]+)['"`]""")
RE_FROM = re.compile(r"""(?<!storage)\.from\(\s*['"`]([a-z_][a-z0-9_]*)['"`]\s*\)""")
RE_RPC = re.compile(r"""\.rpc\(\s*['"`]([a-z_][a-z0-9_]*)['"`]""")

WRITE_OPS = ("insert(", "update(", "upsert(", "delete(")
READ_OPS = ("select(",)


def _access_kind(text: str, pos: int) -> str:
    """Classify a .from('table') call by the operation that follows it."""
    window = text[pos:pos + 260]
    w = any(op in window for op in WRITE_OPS)
    r = any(op in window for op in READ_OPS)
    if w and not r:
        return "writes_table"
    if r and not w:
        return "reads_table"
    return "accesses_table"


def build_links(nodes: list[dict]) -> tuple[list[dict], list[dict]]:
    """Return (extra_nodes, seam_edges) for an already-namespaced node list."""
    # file (repo-relative) -> namespaced file node id
    file_node: dict[str, str] = {}
    tables: dict[str, str] = {}
    sqlfns: dict[str, str] = {}
    for n in nodes:
        if n.get("source_location") == "L1" and n.get("source_file"):
            file_node.setdefault(n["source_file"], n["id"])
        kind = n.get("kind")
        if kind in ("table", "view"):
            tables.setdefault(str(n.get("label", "")).lower(), n["id"])
        elif kind == "sql_function":
            sqlfns.setdefault(str(n.get("label", "")).rstrip("()").lower(), n["id"])

    # edge-function name -> its entrypoint file node
    edgefn: dict[str, str] = {}
    fdir = REPO / "supabase" / "functions"
    if fdir.is_dir():
        for d in sorted(fdir.iterdir()):
            if not d.is_dir() or d.name.startswith("_"):
                continue
            for entry in ("index.ts", "index.js", "mod.ts"):
                rel = f"supabase/functions/{d.name}/{entry}"
                if rel in file_node:
                    edgefn[d.name] = file_node[rel]
                    break

    detect = load_json(STATE / "detect.json", {}) or {}
    scan: list[str] = []
    for unit, s in detect.items():
        if unit == "database":
            continue
        scan.extend(s.get("files", {}).get("code", []))

    extra_nodes: dict[str, dict] = {}
    edges: list[dict] = []
    seen: set[tuple] = set()
    stats = {"invoke": 0, "invoke_unknown": 0, "table": 0, "rpc": 0,
             "rpc_unknown": 0, "storage": 0, "files": 0}

    def add(src, tgt, relation, conf, score, srcfile):
        key = (src, tgt, relation)
        if key in seen or src == tgt:
            return
        seen.add(key)
        edges.append({
            "source": src, "target": tgt, "relation": relation,
            "confidence": conf, "confidence_score": score,
            "source_file": srcfile, "source_location": None,
            "weight": 1.0, "seam": True,
        })

    for abs_path in scan:
        p = Path(abs_path)
        try:
            rel = str(p.resolve().relative_to(REPO))
        except ValueError:
            continue
        src_id = file_node.get(rel)
        if not src_id:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        stats["files"] += 1

        for m in list(RE_INVOKE.finditer(text)) + list(RE_FN_URL.finditer(text)):
            fn = m.group(1)
            if fn in edgefn:
                add(src_id, edgefn[fn], "invokes_function", "EXTRACTED", 1.0, rel)
                stats["invoke"] += 1
            else:
                nid = f"extfn__{re.sub(r'[^a-z0-9]+', '_', fn.lower())}"
                extra_nodes.setdefault(nid, {
                    "id": nid, "label": fn, "kind": "unresolved_edge_function",
                    "file_type": "code", "unit": "seams", "source_file": None,
                    "source_location": None, "external": True,
                })
                add(src_id, nid, "invokes_function", "AMBIGUOUS", 0.3, rel)
                stats["invoke_unknown"] += 1

        for m in RE_FROM.finditer(text):
            t = m.group(1).lower()
            tid = tables.get(t)
            if not tid:
                continue  # not a known table -> almost certainly Array.from etc.
            add(src_id, tid, _access_kind(text, m.end()), "EXTRACTED", 1.0, rel)
            stats["table"] += 1

        for m in RE_RPC.finditer(text):
            fn = m.group(1).lower()
            fid = sqlfns.get(fn)
            if fid:
                add(src_id, fid, "calls_sql_function", "EXTRACTED", 1.0, rel)
                stats["rpc"] += 1
            else:
                nid = f"extrpc__{re.sub(r'[^a-z0-9]+', '_', fn)}"
                extra_nodes.setdefault(nid, {
                    "id": nid, "label": f"{fn}()", "kind": "unresolved_sql_function",
                    "file_type": "code", "unit": "seams", "source_file": None,
                    "source_location": None, "external": True,
                })
                add(src_id, nid, "calls_sql_function", "AMBIGUOUS", 0.3, rel)
                stats["rpc_unknown"] += 1

        for m in RE_STORAGE.finditer(text):
            b = m.group(1)
            nid = f"bucket__{re.sub(r'[^a-z0-9]+', '_', b.lower())}"
            extra_nodes.setdefault(nid, {
                "id": nid, "label": f"bucket: {b}", "kind": "storage_bucket",
                "file_type": "code", "unit": "seams", "source_file": None,
                "source_location": None,
            })
            add(src_id, nid, "uses_storage_bucket", "EXTRACTED", 1.0, rel)
            stats["storage"] += 1

    print(f"  seams: {stats['invoke']} invoke ({stats['invoke_unknown']} unresolved), "
          f"{stats['table']} table access, {stats['rpc']} rpc ({stats['rpc_unknown']} unresolved), "
          f"{stats['storage']} storage, over {stats['files']} files "
          f"-> {len(edges)} edges, {len(extra_nodes)} new nodes")
    return list(extra_nodes.values()), edges
