"""Relevance-ranked query over the knowledge graph.

graphify's own `query` renders its subgraph sorted by *degree*, which works on a
small corpus but inverts on this one: `tenants` has 855 edges and `rentals` 691,
so every question - whatever it asked - came back topped by the same handful of
hubs, and the nodes that actually matched were pushed past the token budget.

This ranks by match strength instead, and reports each match with the edges that
carry information. Pure structural plumbing (`contains`, `imports`, `depends_on`)
is deprioritised: it is true, already known, and crowds out the semantic and
seam edges that answer questions.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import KG_ROOT, load_json  # noqa: E402

STOP = {"the", "and", "how", "what", "does", "did", "are", "was", "were", "for",
        "from", "with", "that", "this", "when", "where", "which", "who", "why",
        "into", "onto", "get", "gets", "use", "used", "uses", "can", "will",
        "its", "our", "your", "you", "all", "any", "not", "but", "has", "have"}

# Structural relations are true but uninformative in an answer - the AST layer
# already guarantees them, and they are by far the most numerous.
LOW_VALUE_RELATIONS = {"contains", "imports", "depends_on", "method"}


def _terms(question: str) -> list[str]:
    raw = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]{2,}", question.lower())
    return [t for t in raw if t not in STOP] or raw


def _score(data: dict, terms: list[str]) -> float:
    label = str(data.get("semantic_label") or data.get("label") or "").lower()
    src = str(data.get("source_file") or "").lower()
    words = set(re.findall(r"[a-z0-9_]+", label))
    s = 0.0
    for t in terms:
        if t in words:
            s += 3.0                     # whole-word hit in the label
        elif t in label:
            s += 1.5                     # substring hit in the label
        if t in src:
            s += 1.0                     # the file path mentions it
    if data.get("kind") in ("table", "view", "sql_function"):
        s *= 1.15                        # schema objects answer "what touches X"
    return s


def run(argv=None) -> None:
    argv = list(argv if argv is not None else sys.argv[1:])
    unit = None
    budget = 2500
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("-u", "--unit") and i + 1 < len(argv):
            unit = argv[i + 1]; i += 2
        elif a == "--budget" and i + 1 < len(argv):
            budget = int(argv[i + 1]); i += 2
        else:
            rest.append(a); i += 1
    question = " ".join(rest).strip()
    if not question:
        print("usage: kg query \"<question>\" [-u <unit>] [--budget N]", file=sys.stderr)
        sys.exit(1)

    gpath = (KG_ROOT / "units" / unit / "graphify-out" / "graph.json") if unit \
        else (KG_ROOT / "merged" / "graph.json")
    if not gpath.exists():
        print(f"error: {gpath} not built. Run `kg build` first.", file=sys.stderr)
        sys.exit(1)

    import networkx as nx
    from networkx.readwrite import json_graph
    raw = load_json(gpath)
    try:
        G = json_graph.node_link_graph(raw, edges="links")
    except TypeError:
        G = json_graph.node_link_graph(raw)

    labels = load_json((gpath.parent / "labels.json")) or \
        load_json(KG_ROOT / "merged" / "labels.json") or {}

    terms = _terms(question)
    scored = [(_score(d, terms), n) for n, d in G.nodes(data=True)]
    scored = sorted([s for s in scored if s[0] > 0], reverse=True)
    if not scored:
        print(f"No node matches {terms}. Try a table name, function name, or file name.")
        return

    out = [f'Q: {question}', f'   matched on: {", ".join(terms)}',
           f'   graph: {"unit " + unit if unit else "unified"} '
           f'({G.number_of_nodes()} nodes, {G.number_of_edges()} edges)', ""]

    chars, cap = 0, budget * 4
    shown = 0
    for sc, nid in scored:
        if shown >= 10 or chars > cap:
            break
        d = G.nodes[nid]
        lbl = d.get("semantic_label") or d.get("label") or nid
        loc = f"{d.get('source_file')}:{d.get('source_location')}" if d.get("source_file") else "-"
        comm = labels.get(str(d.get("community")), "")
        head = (f"* {lbl}\n"
                f"    {loc}   [unit={d.get('unit', '?')}"
                f"{', ' + comm if comm else ''}]")
        # rank this node's edges by how much they explain
        nbrs = []
        for _, v, ed in G.edges(nid, data=True):
            rel = ed.get("relation", "")
            weight = (0 if rel in LOW_VALUE_RELATIONS else 2)
            weight += {"EXTRACTED": 1, "INFERRED": 0.5}.get(ed.get("confidence"), 0)
            nbrs.append((weight, rel, ed.get("confidence", ""), v))
        nbrs.sort(key=lambda x: -x[0])
        lines = [head]
        for _, rel, conf, v in nbrs[:7]:
            vl = G.nodes[v].get("semantic_label") or G.nodes[v].get("label") or v
            lines.append(f"      --{rel} [{conf}]--> {vl}")
        if len(nbrs) > 7:
            lines.append(f"      ... {len(nbrs) - 7} more edges")
        block = "\n".join(lines)
        chars += len(block)
        out.append(block)
        shown += 1

    if len(scored) > shown:
        out.append(f"\n({len(scored) - shown} further matches not shown - "
                   f"raise --budget or narrow the question)")
    print("\n".join(out))


if __name__ == "__main__":
    run()
