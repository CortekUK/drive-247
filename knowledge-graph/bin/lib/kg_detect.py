"""Stage 1 - detect: classify the corpus per unit.

Writes knowledge-graph/state/detect.json:
    {unit: {files: {code:[...], document:[...]}, total_files, total_words, ...}}

SQL units are skipped here - graphify's classifier has no .sql extension, so
migrations are discovered by kg_sql.py instead.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import STATE, UNITS, unit_paths, write_json, is_semantic_skip  # noqa: E402


def run(only: list[str] | None = None) -> dict:
    from graphify.detect import detect

    summary = {}
    for u in UNITS:
        if only and u["name"] not in only:
            continue
        if u["extractor"] == "sql":
            continue
        merged: dict[str, list[str]] = {}
        words = 0
        for p in unit_paths(u):
            r = detect(p)
            for k, v in r.get("files", {}).items():
                merged.setdefault(k, []).extend(v)
            words += r.get("total_words", 0)
        allf = [f for v in merged.values() for f in v]
        summary[u["name"]] = {
            "files": merged,
            "total_files": len(allf),
            "total_words": words,
            "counts": {k: len(v) for k, v in merged.items() if v},
            "semantic_candidates": [f for f in allf if not is_semantic_skip(f)],
            "ast_only": [f for f in allf if is_semantic_skip(f)],
        }
        s = summary[u["name"]]
        print(f"{u['name']:16s} files={s['total_files']:5d} words={words:>9,d} "
              f"semantic={len(s['semantic_candidates']):5d} ast_only={len(s['ast_only']):4d}")

    prev = {}
    path = STATE / "detect.json"
    if path.exists() and only:
        import json
        prev = json.loads(path.read_text())
    prev.update(summary)
    write_json(path, prev)
    return prev


if __name__ == "__main__":
    run(sys.argv[1:] or None)
