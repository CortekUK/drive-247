"""Stage 8 - html: render the unified graph.

The merged graph is far past graphify's 5,000-node HTML limit, so rendering
every node would produce an unreadable hairball that also locks up the browser.
Instead the unified view is aggregated to one node per community, sized by
membership and linked by cross-community edge weight - which is the level the
whole-system view is actually useful at. Node-level detail lives in the per-unit
graph.html files, which are all comfortably under the limit.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import MERGED, UNITS, unit_out, load_json  # noqa: E402

NODE_LIMIT = 5000


def run() -> None:
    import networkx as nx
    from graphify.build import build_from_json
    from graphify.export import to_html

    extraction = load_json(MERGED / ".graphify_extract.json")
    analysis = load_json(MERGED / ".graphify_analysis.json")
    if not extraction or not analysis:
        print("merged graph not built yet - run `kg merge` first")
        return
    labels_raw = load_json(MERGED / "labels.json", {}) or {}
    labels = {int(k): v for k, v in labels_raw.items()}

    G = build_from_json(extraction)
    communities = {int(k): v for k, v in analysis["communities"].items()}

    if G.number_of_nodes() <= NODE_LIMIT:
        to_html(G, communities, str(MERGED / "graph.html"), community_labels=labels or None)
        print(f"merged/graph.html written ({G.number_of_nodes()} nodes)")
        return

    node_community = {nid: cid for cid, members in communities.items() for nid in members}
    meta = nx.Graph()
    member_counts = {}
    for cid, members in communities.items():
        # describe each community by the units its members come from
        units = Counter(G.nodes[m].get("unit", "?") for m in members if m in G)
        top = ", ".join(f"{u}" for u, _ in units.most_common(3))
        meta.add_node(str(cid),
                      label=labels.get(cid, f"Community {cid}"),
                      unit=top,
                      source_file=None,
                      file_type="code")
        member_counts[cid] = len(members)

    weights = Counter()
    for u, v in G.edges():
        cu, cv = node_community.get(u), node_community.get(v)
        if cu is not None and cv is not None and cu != cv:
            weights[(min(cu, cv), max(cu, cv))] += 1
    for (cu, cv), w in weights.items():
        meta.add_edge(str(cu), str(cv), weight=w,
                      relation=f"{w} cross-community edges", confidence="AGGREGATED")

    meta_communities = {cid: [str(cid)] for cid in communities}
    to_html(meta, meta_communities, str(MERGED / "graph.html"),
            community_labels=labels or None, member_counts=member_counts)
    print(f"merged/graph.html written (aggregated: {meta.number_of_nodes()} communities, "
          f"{meta.number_of_edges()} cross-community links, from {G.number_of_nodes()} nodes)")

    for u in UNITS:
        p = unit_out(u["name"]) / "graph.html"
        if p.exists():
            print(f"  detail: units/{u['name']}/graphify-out/graph.html")


if __name__ == "__main__":
    run()
