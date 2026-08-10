"""Stage 4a - chunk: plan the semantic extraction fan-out.

Writes one spec file per chunk to state/chunks/. Each extraction agent is
handed only the path to its own spec and reads the file list from there, so the
orchestrator never has to carry ~1600 file paths through its context.

Corpus decisions made here (all reported, none silent):
  - images are dropped: every surviving image is a marketing hero photo or an
    app icon, so a vision agent per image would buy no architectural signal
  - documents present in two renderings (X.md + X.pdf) keep only the richest
    text form; extracting both duplicates every concept node
  - shadcn/ui primitives and generated supabase types.ts are AST-only
    (see kgcommon.SEMANTIC_SKIP_*)
"""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import (REPO, STATE, UNITS, unit_out, load_json,  # noqa: E402
                      write_json)

CHUNK_SIZE = {"documents": 5, "sql-migrations": 25}
DEFAULT_CHUNK = 20
BIG_FILE_BYTES = 120_000
FORMAT_RANK = {".md": 0, ".mdx": 0, ".txt": 1, ".html": 2, ".docx": 3, ".pdf": 4}


def _size(p: str) -> int:
    try:
        return Path(p).stat().st_size
    except OSError:
        return 0


def _dedupe_renderings(paths: list[str]) -> tuple[list[str], list[str]]:
    """Keep one rendering per document stem; return (kept, dropped)."""
    best: dict[str, str] = {}
    for p in paths:
        pp = Path(p)
        if pp.suffix.lower() not in FORMAT_RANK:
            best[p] = p
            continue
        stem = str(pp.with_suffix(""))
        cur = best.get(stem)
        if cur is None or FORMAT_RANK.get(pp.suffix.lower(), 9) < FORMAT_RANK.get(Path(cur).suffix.lower(), 9):
            best[stem] = p
    kept = sorted(set(best.values()))
    dropped = sorted(set(paths) - set(kept))
    return kept, dropped


def run() -> list[str]:
    detect = load_json(STATE / "detect.json", {}) or {}
    chunk_dir = STATE / "chunks"
    if chunk_dir.exists():
        shutil.rmtree(chunk_dir)
    chunk_dir.mkdir(parents=True, exist_ok=True)

    specs: list[str] = []
    report = []
    for u in UNITS:
        name = u["name"]
        d = detect.get(name)
        if not d:
            continue
        cands = list(d.get("semantic_candidates", []))
        images = set(d.get("files", {}).get("image", []))
        cands = [c for c in cands if c not in images]
        cands, dropped = _dedupe_renderings(cands)
        if not cands:
            continue

        size = CHUNK_SIZE.get(u["kind"], DEFAULT_CHUNK)
        cands.sort()  # path sort keeps same-directory files in the same chunk
        out_dir = unit_out(name)

        # Oversized files get a chunk to themselves. This repo has genuine
        # monsters (a 401KB rentals/[id]/page.tsx, a 305KB remote_schema.sql);
        # bundling one with 19 neighbours would exhaust the agent's context and
        # silently truncate the whole batch.
        big = [c for c in cands if _size(c) >= BIG_FILE_BYTES]
        small = [c for c in cands if c not in set(big)]
        batches = [small[i:i + size] for i in range(0, len(small), size)]
        batches.extend([[b] for b in big])
        n_big = len(big)

        n = 0
        for batch in batches:
            n += 1
            spec = chunk_dir / f"{name}-{n:03d}.json"
            write_json(spec, {
                "unit": name,
                "unit_label": u["label"],
                "unit_kind": u["kind"],
                "chunk": n,
                "out": str(out_dir / f".graphify_chunk_{name}_{n:03d}.json"),
                # agents must emit repo-relative source_file values so semantic
                # nodes line up with the AST layer, which is already normalised
                "repo_root": str(REPO),
                "files": batch,
            })
            specs.append(str(spec))
        report.append((name, len(cands), n, len(images), len(dropped), n_big))

    write_json(STATE / "chunk_index.json", {"specs": specs})
    print(f"{'unit':16s} {'files':>6s} {'chunks':>7s} {'imgs_skip':>10s} {'dup_render':>11s} {'solo_big':>9s}")
    for name, nf, nc, ni, nd, nb in report:
        print(f"{name:16s} {nf:6d} {nc:7d} {ni:10d} {nd:11d} {nb:9d}")
    print(f"\nTOTAL chunks (= extraction agents): {len(specs)}")
    return specs


if __name__ == "__main__":
    run()
