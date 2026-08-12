"""Stage 4b - assemble: validate agent fragments and build each unit's graph.

Takes the structural layer (.graphify_struct.json) plus every semantic fragment
an extraction agent wrote (.graphify_chunk_*.json) and produces, per unit:

    graphify-out/.graphify_extract.json   merged extraction (graphify's own name)
    graphify-out/graph.json               built + clustered graph
    graphify-out/GRAPH_REPORT.md          audit report
    graphify-out/graph.html               interactive view

The per-unit graphs are deliberately NOT namespaced: they are meant to be used
directly (`graphify query --graph units/portal/graphify-out/graph.json`).
Namespacing happens only at merge time, in kg_merge.py.

Agent output is untrusted, so everything is validated here and the repairs are
counted and reported rather than applied silently.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import (REPO, STATE, UNITS, unit_out, load_json,  # noqa: E402
                      write_json)

ID_RE = re.compile(r'^[a-z0-9_]+$')
VALID_CONF = {"EXTRACTED", "INFERRED", "AMBIGUOUS"}


def norm_id(s: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', str(s).lower()).strip('_')


def _relpath(s) -> str | None:
    if not s:
        return None
    p = str(s)
    root = str(REPO)
    if p.startswith(root):
        p = p[len(root):]
    return p.lstrip('/')


def assemble_unit(name: str, report: dict) -> dict:
    out = unit_out(name)
    struct = load_json(out / ".graphify_struct.json", {"nodes": [], "edges": []})
    nodes: dict[str, dict] = {n["id"]: n for n in struct["nodes"]}
    edges: list[dict] = list(struct["edges"])
    struct_ids = set(nodes)
    # Explicit provenance. Downstream stages must be able to tell a node derived
    # from source (AST/SQL) from one an agent proposed; source_file and
    # source_location are present on both, so neither can be used as the test.
    for n in nodes.values():
        n["origin"] = "structural"

    stats = {"chunks": 0, "chunks_bad": 0, "sem_nodes": 0, "sem_edges": 0,
             "hyperedges": 0, "ids_normalised": 0, "edges_dropped": 0,
             "stub_nodes": 0, "conf_fixed": 0, "merged_into_ast": 0}

    for cf in sorted(out.glob(".graphify_chunk_*.json")):
        data = load_json(cf)
        if not isinstance(data, dict) or "nodes" not in data or "edges" not in data:
            stats["chunks_bad"] += 1
            report.setdefault("bad_chunks", []).append(str(cf))
            continue
        stats["chunks"] += 1

        idmap: dict[str, str] = {}
        for n in data.get("nodes") or []:
            raw = n.get("id")
            if not raw:
                continue
            nid = raw if ID_RE.match(str(raw)) else norm_id(raw)
            if nid != raw:
                stats["ids_normalised"] += 1
            if not nid:
                continue
            idmap[str(raw)] = nid
            n["id"] = nid
            n["source_file"] = _relpath(n.get("source_file"))
            n.setdefault("unit", name)
            n["unit"] = name
            n.setdefault("file_type", "code")
            if nid in struct_ids:
                # the AST already owns this symbol; keep its precise location and
                # take only the semantic label, which is the human-readable name
                tgt = nodes[nid]
                if n.get("label") and len(str(n["label"])) > len(str(tgt.get("label", ""))):
                    tgt["semantic_label"] = n["label"]
                tgt["semantic"] = True
                stats["merged_into_ast"] += 1
            elif nid not in nodes:
                n["semantic"] = True
                n["origin"] = "semantic"
                nodes[nid] = n
                stats["sem_nodes"] += 1

        for e in data.get("edges") or []:
            s, t = e.get("source"), e.get("target")
            if not s or not t:
                stats["edges_dropped"] += 1
                continue
            s = idmap.get(str(s)) or (str(s) if ID_RE.match(str(s)) else norm_id(s))
            t = idmap.get(str(t)) or (str(t) if ID_RE.match(str(t)) else norm_id(t))
            if not s or not t or s == t:
                stats["edges_dropped"] += 1
                continue
            conf = str(e.get("confidence", "")).upper()
            if conf not in VALID_CONF:
                conf = "INFERRED"
                stats["conf_fixed"] += 1
            try:
                score = float(e.get("confidence_score", 0.6))
            except (TypeError, ValueError):
                score = 0.6
                stats["conf_fixed"] += 1
            if conf == "EXTRACTED":
                score = 1.0
            e.update({
                "source": s, "target": t, "confidence": conf,
                "confidence_score": max(0.0, min(1.0, score)),
                "source_file": _relpath(e.get("source_file")),
                "relation": e.get("relation") or "conceptually_related_to",
                "weight": float(e.get("weight", 1.0) or 1.0),
                "semantic": True,
            })
            edges.append(e)
            stats["sem_edges"] += 1

        for h in data.get("hyperedges") or []:
            members = [idmap.get(str(x), norm_id(x)) for x in (h.get("nodes") or [])]
            members = [m for m in members if m]
            if len(members) < 3:
                continue
            h["nodes"] = members
            h["unit"] = name
            report.setdefault("hyperedges", []).append(h)
            stats["hyperedges"] += 1

    # Any edge endpoint with no node becomes an explicit concept stub rather than
    # an attribute-less node materialised implicitly by networkx.
    for e in edges:
        for k in ("source", "target"):
            nid = e[k]
            if nid not in nodes:
                nodes[nid] = {
                    "id": nid, "label": nid.replace("_", " "), "file_type": "code",
                    "unit": name, "source_file": e.get("source_file"),
                    "source_location": None, "kind": "concept",
                    "inferred_stub": True, "origin": "semantic",
                }
                stats["stub_nodes"] += 1

    extraction = {"nodes": list(nodes.values()), "edges": edges,
                  "input_tokens": 0, "output_tokens": 0}
    write_json(out / ".graphify_extract.json", extraction)
    report.setdefault("units", {})[name] = stats
    print(f"{name:16s} chunks={stats['chunks']:3d} bad={stats['chunks_bad']:2d} "
          f"+sem_nodes={stats['sem_nodes']:5d} +sem_edges={stats['sem_edges']:5d} "
          f"merged={stats['merged_into_ast']:5d} stubs={stats['stub_nodes']:4d} "
          f"-> {len(nodes):5d} nodes / {len(edges):5d} edges")
    return extraction


def build_unit_graph(name: str) -> tuple[int, int, int]:
    """Build + cluster + export the standalone per-unit graph."""
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json, to_html

    out = unit_out(name)
    extraction = load_json(out / ".graphify_extract.json")
    G = build_from_json(extraction)
    if G.number_of_nodes() == 0:
        print(f"{name:16s} EMPTY graph - skipped")
        return 0, 0, 0

    # graphify refuses to shrink an existing graph.json, guarding against a run
    # with chunk files missing. Here the extraction is reassembled from every
    # chunk on disk each time, so a shrink is legitimate (a re-run agent can
    # return slightly fewer nodes). Force it, but say so rather than hide it.
    prev = load_json(out / "graph.json")
    if prev and len(prev.get("nodes", [])) > G.number_of_nodes():
        print(f"{name:16s} note: graph shrank {len(prev['nodes'])} -> "
              f"{G.number_of_nodes()} nodes (re-extraction), overwriting")
    communities = cluster(G)
    cohesion = score_all(G, communities)
    labels = {cid: f"Community {cid}" for cid in communities}
    gods = god_nodes(G)
    surprises = surprising_connections(G, communities)
    questions = suggest_questions(G, communities, labels)
    det = (load_json(STATE / "detect.json", {}) or {}).get(name, {})
    detection = {"total_files": det.get("total_files", 0),
                 "total_words": det.get("total_words", 0),
                 "needs_graph": True, "warning": None,
                 "files": det.get("files", {})}
    rep = generate(G, communities, cohesion, labels, gods, surprises, detection,
                   {"input": 0, "output": 0}, name, suggested_questions=questions)
    (out / "GRAPH_REPORT.md").write_text(rep)
    to_json(G, communities, str(out / "graph.json"), force=True)
    write_json(out / ".graphify_analysis.json", {
        "communities": {str(k): v for k, v in communities.items()},
        "cohesion": {str(k): v for k, v in cohesion.items()},
        "gods": gods, "surprises": surprises, "questions": questions,
    })
    if G.number_of_nodes() <= 5000:
        to_html(G, communities, str(out / "graph.html"))
    return G.number_of_nodes(), G.number_of_edges(), len(communities)


def run(only: list[str] | None = None) -> None:
    report: dict = {}
    for u in UNITS:
        if only and u["name"] not in only:
            continue
        assemble_unit(u["name"], report)
    print()
    for u in UNITS:
        if only and u["name"] not in only:
            continue
        n, e, c = build_unit_graph(u["name"])
        if n:
            print(f"{u['name']:16s} graph: {n:5d} nodes, {e:5d} edges, {c:3d} communities")
    write_json(STATE / "assemble_report.json", report)


if __name__ == "__main__":
    run(sys.argv[1:] or None)
