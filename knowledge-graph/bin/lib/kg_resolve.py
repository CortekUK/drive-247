"""Stage 3 - resolve: turn dangling import stubs into real dependency edges.

graphify's AST records `imports_from` edges whose target is just the last
segment of the import specifier ('react', 'agreement_injection'). Those targets
do not exist as nodes, so networkx would materialise ~775 attribute-less junk
nodes per unit and the true file->file dependency structure would be lost.

This stage re-reads the import statements from source and resolves each
specifier against the filesystem:

  ./x, ../x   -> relative path + extension/index probing
  @/x         -> <app-root>/src/x then <app-root>/x  (apps disagree on the
                 alias base and booking's tsconfig has comments that break
                 strict JSON, so probe the filesystem instead of parsing it)
  npm:/jsr:/https:/bare -> a SHARED external package node

External package nodes are deliberately NOT namespaced per unit: 'stripe' seen
from portal and from booking must be the same node, so shared dependencies
become visible bridges between apps in the merged graph.

Writes units/<unit>/graphify-out/.graphify_struct.json
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import (REPO, STATE, UNITS, unit_out, load_json,  # noqa: E402
                      write_json, rel)

RE_IMPORT = re.compile(
    r'''(?:^|\s)(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]'''
    r'''|require\(\s*['"]([^'"]+)['"]\s*\)'''
    r'''|import\(\s*['"]([^'"]+)['"]\s*\)''',
    re.M)

EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"]
INDEXES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"]


def _norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def _probe(base: Path) -> Path | None:
    """Resolve a extension-less module path to a real file."""
    for e in EXTS:
        c = Path(str(base) + e)
        if c.is_file():
            return c
    if base.is_dir():
        for i in INDEXES:
            c = base / i
            if c.is_file():
                return c
    return None


def _external_name(spec: str) -> str:
    """Canonical package name for a non-relative specifier."""
    s = spec
    for p in ("npm:", "jsr:", "node:"):
        if s.startswith(p):
            s = s[len(p):]
    if s.startswith(("http://", "https://")):
        # https://esm.sh/stripe@14.21.0  |  https://deno.land/std@0.168.0/http/server.ts
        m = re.match(r'https?://(?:esm\.sh|cdn\.skypack\.dev|unpkg\.com)/(?:v\d+/)?(@?[^@/]+(?:/[^@/]+)?)', s)
        if m:
            s = m.group(1)
        else:
            m = re.match(r'https?://deno\.land/(?:x/)?([^@/]+)', s)
            s = m.group(1) if m else re.sub(r'https?://', '', s).split('/')[0]
    s = re.sub(r'@\d[\w.\-]*$', '', s)          # strip trailing @version
    parts = s.split('/')
    if s.startswith('@') and len(parts) >= 2:    # scoped package
        return '/'.join(parts[:2])
    return parts[0] or s


def run(only: list[str] | None = None) -> None:
    detect = load_json(STATE / "detect.json", {}) or {}
    totals = {"resolved": 0, "external": 0, "unresolved": 0}

    for u in UNITS:
        name = u["name"]
        if only and name not in only:
            continue
        out = unit_out(name)
        ast = load_json(out / ".graphify_ast.json", {"nodes": [], "edges": []})
        if u["extractor"] == "sql":
            # SQL has no import graph; pass structure through unchanged
            write_json(out / ".graphify_struct.json", ast)
            print(f"{name:16s} (sql) {len(ast['nodes'])} nodes passed through")
            continue

        # repo-relative source_file -> file-level node id
        file_node: dict[str, str] = {}
        for n in ast["nodes"]:
            if n.get("source_location") == "L1" and n.get("source_file"):
                file_node.setdefault(n["source_file"], n["id"])

        app_roots = [REPO / p for p in u["paths"] if (REPO / p).is_dir()]
        ext_nodes: dict[str, dict] = {}
        new_edges: list[dict] = []
        stats = {"resolved": 0, "external": 0, "unresolved": 0}

        for srcrel, src_id in file_node.items():
            f = REPO / srcrel
            try:
                text = f.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            seen: set[str] = set()
            for m in RE_IMPORT.finditer(text):
                spec = m.group(1) or m.group(2) or m.group(3)
                if not spec or spec in seen:
                    continue
                seen.add(spec)
                target_id = None

                if spec.startswith('.'):
                    hit = _probe((f.parent / spec).resolve())
                    if hit:
                        target_id = file_node.get(rel(hit))
                        if target_id is None:
                            stats["unresolved"] += 1
                            continue
                elif spec.startswith('@/'):
                    for root in app_roots:
                        hit = _probe(root / "src" / spec[2:]) or _probe(root / spec[2:])
                        if hit:
                            target_id = file_node.get(rel(hit))
                            break
                    if target_id is None:
                        stats["unresolved"] += 1
                        continue

                if target_id:
                    new_edges.append({
                        "source": src_id, "target": target_id, "relation": "imports",
                        "confidence": "EXTRACTED", "confidence_score": 1.0,
                        "source_file": srcrel, "source_location": None, "weight": 1.0,
                    })
                    stats["resolved"] += 1
                else:
                    pkg = _external_name(spec)
                    if not pkg:
                        continue
                    eid = f"ext__{_norm(pkg)}"
                    ext_nodes.setdefault(eid, {
                        "id": eid, "label": pkg, "file_type": "code",
                        "kind": "external_package", "source_file": None,
                        "source_location": None, "unit": "external", "external": True,
                    })
                    new_edges.append({
                        "source": src_id, "target": eid, "relation": "depends_on",
                        "confidence": "EXTRACTED", "confidence_score": 1.0,
                        "source_file": srcrel, "source_location": None, "weight": 1.0,
                    })
                    stats["external"] += 1

        # keep every AST edge except the unresolved import stubs we just replaced
        kept = [e for e in ast["edges"] if e.get("relation") != "imports_from"]
        dropped = len(ast["edges"]) - len(kept)
        struct = {
            "nodes": ast["nodes"] + list(ext_nodes.values()),
            "edges": kept + new_edges,
            "input_tokens": 0, "output_tokens": 0,
        }
        write_json(out / ".graphify_struct.json", struct)
        for k in totals:
            totals[k] += stats[k]
        print(f"{name:16s} dropped {dropped:5d} stub edges -> "
              f"{stats['resolved']:5d} internal imports, {stats['external']:5d} external "
              f"({len(ext_nodes)} pkgs), {stats['unresolved']:4d} unresolved")

    print(f"\nTOTAL internal imports resolved: {totals['resolved']}, "
          f"external dep edges: {totals['external']}, unresolved: {totals['unresolved']}")


if __name__ == "__main__":
    run(sys.argv[1:] or None)
