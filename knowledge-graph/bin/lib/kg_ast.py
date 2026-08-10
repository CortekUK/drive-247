"""Stage 2 - AST: deterministic structural extraction per unit.

Free and repeatable: no LLM involved. Runs over every code file in a unit
(including the ones withheld from semantic agents) so structural coverage is
always complete even when the semantic layer is partial or stale.

Writes units/<unit>/graphify-out/.graphify_ast.json
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import STATE, UNITS, unit_dir, unit_out, load_json, write_json, rel  # noqa: E402


def run(only: list[str] | None = None) -> None:
    from graphify.extract import extract

    detect = load_json(STATE / "detect.json", {}) or {}
    for u in UNITS:
        name = u["name"]
        if only and name not in only:
            continue
        if u["extractor"] != "graphify":
            continue
        code = [Path(f) for f in detect.get(name, {}).get("files", {}).get("code", [])]
        code = [c for c in code if c.is_file()]
        out = unit_out(name)
        if not code:
            write_json(out / ".graphify_ast.json",
                       {"nodes": [], "edges": [], "input_tokens": 0, "output_tokens": 0})
            print(f"{name:16s} no code files - AST skipped")
            continue
        # cache_root scopes graphify's per-file cache to this unit's workspace
        res = extract(code, cache_root=unit_dir(name))
        # normalise source_file to repo-relative so the merged graph is portable
        for n in res.get("nodes", []):
            if n.get("source_file"):
                n["source_file"] = rel(n["source_file"])
            n["unit"] = name
        for e in res.get("edges", []):
            if e.get("source_file"):
                e["source_file"] = rel(e["source_file"])
        write_json(out / ".graphify_ast.json", res)
        print(f"{name:16s} AST: {len(res['nodes']):5d} nodes, {len(res['edges']):5d} edges "
              f"from {len(code)} files")


if __name__ == "__main__":
    run(sys.argv[1:] or None)
