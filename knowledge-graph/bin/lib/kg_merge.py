"""Stage 6 - merge: one unified, collision-free graph over the whole monorepo.

`graphify merge-graphs` composes with networkx compose_all, which merges by node
id and has no namespacing. Measured on this repo that silently fuses 439 nodes -
313 between portal and booking alone - because every Next.js app produces
`layout_rootlayout`, `page_home`, and identical shadcn symbol ids. So each unit's
internal nodes are prefixed `<unit>__` here before composing.

Deliberately NOT namespaced, so they stay shared and act as bridges:
    ext__<pkg>      an npm/deno package used by several apps
    extfn__/extrpc__/bucket__   seam targets discovered by kg_link

Writes merged/graph.json, merged/graph.html, merged/GRAPH_REPORT.md
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kg_link  # noqa: E402
from kgcommon import (MERGED, STATE, UNITS, unit_out, load_json,  # noqa: E402
                      write_json)

GLOBAL_PREFIXES = ("ext__", "extfn__", "extrpc__", "bucket__")
GLOBAL_UNITS = {"external", "seams"}


def _is_global(nid: str, unit: str | None) -> bool:
    return nid.startswith(GLOBAL_PREFIXES) or (unit in GLOBAL_UNITS)


# "rentals", "rentals table", "table rentals", "db table rentals", "rentals_table"
_TABLE_ALIAS = re.compile(
    r'^(?:db[\s_]+)?(?:table[\s_]+)?([a-z][a-z0-9_]*?)(?:[\s_]+table)?$')


def canonicalise_tables(nodes: dict, edges: list) -> int:
    """Fold semantic "the rentals table" concept nodes onto the real table node.

    Each unit's agents independently invented a private concept node for the
    same physical table (portal__rentals, portal__rentals_table, booking__rentals
    ...), none of them connected to database__tbl_rentals. Left alone, "what
    touches the rentals table" answers from four disconnected fragments.

    Conservative on purpose: only folds when the label is *nothing but* the
    table name (with an optional "table" qualifier), so "Rentals page" and
    "Rental pricing rules" are untouched.
    """
    real: dict[str, str] = {}
    for n in nodes.values():
        if n.get("unit") == "database" and n.get("kind") in ("table", "view"):
            real[str(n.get("label", "")).lower()] = n["id"]
    if not real:
        return 0

    alias: dict[str, str] = {}
    for nid, n in list(nodes.items()):
        # Fold only agent-proposed nodes. source_location cannot be the test:
        # agents emit one too, which previously left `tenants table` (113 edges)
        # standing beside the real `tenants` node.
        if n.get("unit") == "database" or n.get("origin") != "semantic":
            continue
        if n.get("kind") not in (None, "concept"):
            continue
        lab = re.sub(r'[^a-z0-9_\s]', '', str(n.get("label", "")).lower()).strip()
        m = _TABLE_ALIAS.match(lab)
        if not m:
            continue
        tgt = real.get(m.group(1))
        if tgt and tgt != nid:
            alias[nid] = tgt

    if not alias:
        return 0
    for e in edges:
        e["source"] = alias.get(e["source"], e["source"])
        e["target"] = alias.get(e["target"], e["target"])
    for nid in alias:
        nodes.pop(nid, None)
    return len(alias)


def collect() -> dict:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []
    collisions = 0

    for u in UNITS:
        name = u["name"]
        ex = load_json(unit_out(name) / ".graphify_extract.json")
        if not ex:
            print(f"  !! {name}: no extraction found - skipped")
            continue
        idmap: dict[str, str] = {}
        for n in ex["nodes"]:
            local = n["id"]
            if _is_global(local, n.get("unit")):
                nid = local
            else:
                nid = f"{name}__{local}"
            idmap[local] = nid
            if nid in nodes:
                collisions += 1
                continue
            m = dict(n)
            m["id"] = nid
            m["local_id"] = local
            m["unit"] = n.get("unit") if _is_global(local, n.get("unit")) else name
            nodes[nid] = m
        for e in ex["edges"]:
            s = idmap.get(e["source"], e["source"] if _is_global(e["source"], None) else f"{name}__{e['source']}")
            t = idmap.get(e["target"], e["target"] if _is_global(e["target"], None) else f"{name}__{e['target']}")
            m = dict(e)
            m["source"], m["target"] = s, t
            m["unit"] = name
            edges.append(m)
        print(f"  {name:16s} +{len(ex['nodes']):5d} nodes  +{len(ex['edges']):5d} edges")

    print(f"  (global nodes shared across units collapsed: {collisions})")
    return {"nodes": nodes, "edges": edges}


def run() -> None:
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json

    print("Merging units:")
    acc = collect()
    nodes, edges = acc["nodes"], acc["edges"]

    folded = canonicalise_tables(nodes, edges)
    print(f"  folded {folded} duplicate table-concept nodes onto the real schema")

    print("Deriving cross-unit seams:")
    extra_nodes, seam_edges = kg_link.build_links(list(nodes.values()))
    for n in extra_nodes:
        nodes.setdefault(n["id"], n)
    edges.extend(seam_edges)

    # Any dangling endpoint becomes an explicit node, never an implicit one.
    for e in edges:
        for k in ("source", "target"):
            if e[k] not in nodes:
                nodes[e[k]] = {
                    "id": e[k], "label": e[k].split("__")[-1].replace("_", " "),
                    "file_type": "code", "unit": "seams", "kind": "concept",
                    "source_file": None, "source_location": None, "inferred_stub": True,
                }

    extraction = {"nodes": list(nodes.values()), "edges": edges,
                  "input_tokens": 0, "output_tokens": 0}
    MERGED.mkdir(parents=True, exist_ok=True)
    write_json(MERGED / ".graphify_extract.json", extraction)

    G = build_from_json(extraction)
    print(f"\nUnified graph: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    communities = cluster(G)
    cohesion = score_all(G, communities)
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    labels = {cid: f"Community {cid}" for cid in communities}
    questions = suggest_questions(G, communities, labels)

    det = load_json(STATE / "detect.json", {}) or {}
    detection = {
        "total_files": sum(d.get("total_files", 0) for d in det.values()),
        "total_words": sum(d.get("total_words", 0) for d in det.values()),
        "needs_graph": True, "warning": None,
        "files": {"code": [], "document": [], "paper": []},
    }
    rep = generate(G, communities, cohesion, labels, gods, surprises, detection,
                   {"input": 0, "output": 0}, "drive-247 monorepo",
                   suggested_questions=questions)
    (MERGED / "GRAPH_REPORT.md").write_text(rep)
    to_json(G, communities, str(MERGED / "graph.json"), force=True)
    write_json(MERGED / ".graphify_analysis.json", {
        "communities": {str(k): v for k, v in communities.items()},
        "cohesion": {str(k): v for k, v in cohesion.items()},
        "gods": gods, "surprises": surprises, "questions": questions,
    })
    print(f"Communities: {len(communities)}")
    print(f"Wrote {MERGED}/graph.json and GRAPH_REPORT.md")


if __name__ == "__main__":
    run()
