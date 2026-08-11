"""Stage 9 - labels: give every community a plain-language name.

`kg_labels export` writes a compact digest of each community (size, which units
it spans, its highest-degree members) small enough to hand to labelling agents.
`kg_labels apply` reads merged/labels.json back and regenerates the report and
HTML so the names show up everywhere.

Labels matter more than they look: graphify phrases its suggested questions from
community labels, so "Community 27" produces a useless question and "Stripe
Connect payouts" produces a good one.
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import MERGED, STATE, load_json, write_json  # noqa: E402

TOP_N = 18


def export(graph_dir: Path = MERGED, out: Path | None = None) -> Path:
    from graphify.build import build_from_json

    extraction = load_json(graph_dir / ".graphify_extract.json")
    analysis = load_json(graph_dir / ".graphify_analysis.json")
    G = build_from_json(extraction)
    communities = {int(k): v for k, v in analysis["communities"].items()}
    cohesion = {int(k): v for k, v in analysis.get("cohesion", {}).items()}

    digest = []
    for cid, members in sorted(communities.items(), key=lambda kv: -len(kv[1])):
        present = [m for m in members if m in G]
        top = sorted(present, key=lambda n: G.degree(n), reverse=True)[:TOP_N]
        units = Counter(G.nodes[m].get("unit", "?") for m in present)
        kinds = Counter(G.nodes[m].get("kind") for m in present if G.nodes[m].get("kind"))
        rels = Counter()
        for m in present:
            for _, _, d in G.edges(m, data=True):
                if d.get("relation"):
                    rels[d["relation"]] += 1
        digest.append({
            "id": cid,
            "size": len(members),
            "cohesion": round(cohesion.get(cid, 0.0), 3),
            "units": dict(units.most_common(5)),
            "kinds": dict(kinds.most_common(6)),
            "relations": dict(rels.most_common(6)),
            "members": [
                {"label": G.nodes[m].get("semantic_label") or G.nodes[m].get("label", m),
                 "file": G.nodes[m].get("source_file"),
                 "kind": G.nodes[m].get("kind")}
                for m in top
            ],
        })
    out = out or (STATE / "community_summary.json")
    write_json(out, {"communities": digest, "total": len(digest)})
    print(f"exported {len(digest)} community digests -> {out}")
    return out


def batches(min_size: int = 3, per_batch: int = 14) -> list[str]:
    """Split the digest into per-agent batch files.

    Communities below min_size are left with their default "Community N" name:
    a two-node community has nothing to summarise, and labelling it would spend
    an agent to say less than the member list already says.
    """
    digest = load_json(STATE / "community_summary.json")["communities"]
    worth = [c for c in digest if c["size"] >= min_size]
    skipped = len(digest) - len(worth)
    bdir = STATE / "label_batches"
    if bdir.exists():
        import shutil
        shutil.rmtree(bdir)
    bdir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i in range(0, len(worth), per_batch):
        p = bdir / f"batch-{i // per_batch + 1:03d}.json"
        write_json(p, {"communities": worth[i:i + per_batch]})
        paths.append(str(p))
    write_json(STATE / "label_batch_index.json", {"batches": paths})
    print(f"{len(worth)} communities to label in {len(paths)} batches "
          f"({skipped} below size {min_size} keep default names)")
    return paths


def apply(graph_dir: Path = MERGED, name: str = "drive-247 monorepo") -> None:
    from graphify.build import build_from_json
    from graphify.analyze import suggest_questions
    from graphify.report import generate
    from graphify.export import to_json

    labels_raw = load_json(graph_dir / "labels.json", {}) or {}
    if not labels_raw:
        print(f"no {graph_dir}/labels.json - nothing to apply")
        return
    labels = {int(k): v for k, v in labels_raw.items()}

    extraction = load_json(graph_dir / ".graphify_extract.json")
    analysis = load_json(graph_dir / ".graphify_analysis.json")
    detect = load_json(STATE / "detect.json", {}) or {}

    G = build_from_json(extraction)
    communities = {int(k): v for k, v in analysis["communities"].items()}
    cohesion = {int(k): v for k, v in analysis["cohesion"].items()}
    for cid in communities:
        labels.setdefault(cid, f"Community {cid}")

    questions = suggest_questions(G, communities, labels)
    detection = {
        "total_files": sum(d.get("total_files", 0) for d in detect.values()),
        "total_words": sum(d.get("total_words", 0) for d in detect.values()),
        "needs_graph": True, "warning": None,
        "files": {"code": [], "document": [], "paper": []},
    }
    rep = generate(G, communities, cohesion, labels, analysis["gods"],
                   analysis["surprises"], detection, {"input": 0, "output": 0},
                   name, suggested_questions=questions)
    (graph_dir / "GRAPH_REPORT.md").write_text(rep)
    to_json(G, communities, str(graph_dir / "graph.json"))
    analysis["questions"] = questions
    write_json(graph_dir / ".graphify_analysis.json", analysis)
    print(f"applied {len(labels_raw)} labels; report + graph.json regenerated")


def run(argv=None):
    argv = argv or sys.argv[1:]
    if argv and argv[0] == "apply":
        apply()
    elif argv and argv[0] == "batches":
        batches()
    else:
        export()
        batches()


if __name__ == "__main__":
    run()
