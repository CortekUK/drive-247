"""Stage 7 - update: keep the graph current as the codebase moves.

Two speeds, on purpose:

  structural  free and deterministic (AST, SQL, import resolution, seams).
              Re-runs on every commit via the git hook. Never needs an LLM.
  semantic    costs agents. Only the files whose content actually changed are
              re-chunked, so a normal commit refreshes a handful of chunks, not
              all 108.

Anything the structural pass cannot refresh is recorded in
state/needs_semantic.json instead of being silently left stale, and `kg status`
reports it.
"""
from __future__ import annotations

import hashlib
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kgcommon import (REPO, STATE, UNITS, unit_out, load_json,  # noqa: E402
                      write_json, is_semantic_skip)

MANIFEST = STATE / "manifest.json"


def _sha(p: Path) -> str | None:
    try:
        return hashlib.sha256(p.read_bytes()).hexdigest()
    except OSError:
        return None


def current_files() -> dict[str, list[str]]:
    """unit -> absolute file list, from the last detect run."""
    det = load_json(STATE / "detect.json", {}) or {}
    return {u: d.get("files", {}) and
            [f for v in d["files"].values() for f in v] for u, d in det.items()}


def snapshot() -> dict:
    out = {}
    for unit, files in current_files().items():
        for f in files:
            h = _sha(Path(f))
            if h:
                out[f] = {"sha": h, "unit": unit}
    return out


def diff() -> dict:
    old = load_json(MANIFEST, {}) or {}
    new = snapshot()
    added = [f for f in new if f not in old]
    changed = [f for f in new if f in old and old[f]["sha"] != new[f]["sha"]]
    deleted = [f for f in old if f not in new]
    units = sorted({new[f]["unit"] for f in added + changed} |
                   {old[f]["unit"] for f in deleted})
    return {"added": added, "changed": changed, "deleted": deleted,
            "units": units, "snapshot": new}


def plan_semantic(files: list[str]) -> list[str]:
    """Write incremental chunk specs for just these files. Returns spec paths."""
    from kgcommon import UNIT_BY_NAME
    inc = STATE / "chunks_incremental"
    if inc.exists():
        shutil.rmtree(inc)
    inc.mkdir(parents=True, exist_ok=True)

    by_unit: dict[str, list[str]] = {}
    snap = load_json(MANIFEST, {}) or {}
    for f in files:
        if is_semantic_skip(f):
            continue
        u = snap.get(f, {}).get("unit")
        if not u:
            for unit in UNITS:
                if any(str(REPO / p) in f for p in unit["paths"]):
                    u = unit["name"]
                    break
        if u:
            by_unit.setdefault(u, []).append(f)

    specs = []
    for unit, fs in sorted(by_unit.items()):
        u = UNIT_BY_NAME.get(unit)
        if not u:
            continue
        size = 5 if u["kind"] == "documents" else 20
        fs.sort()
        for i in range(0, len(fs), size):
            n = i // size + 1
            spec = inc / f"{unit}-inc-{n:03d}.json"
            write_json(spec, {
                "unit": unit, "unit_label": u["label"], "unit_kind": u["kind"],
                "chunk": n, "incremental": True,
                "out": str(unit_out(unit) / f".graphify_chunk_{unit}_inc_{n:03d}.json"),
                "repo_root": str(REPO), "files": fs[i:i + size],
            })
            specs.append(str(spec))
    return specs


def run(structural_only: bool = True) -> dict:
    import kg_detect, kg_ast, kg_sql, kg_resolve, kg_assemble, kg_merge

    print("Re-detecting corpus...")
    kg_detect.run()
    kg_sql.run()

    d = diff()
    print(f"\nChanged: {len(d['added'])} added, {len(d['changed'])} modified, "
          f"{len(d['deleted'])} deleted across units: {', '.join(d['units']) or '(none)'}")

    graphify_units = [u["name"] for u in UNITS
                      if u["extractor"] == "graphify" and u["name"] in d["units"]]
    if graphify_units:
        print("\nStructural re-extraction:")
        kg_ast.run(graphify_units)
        kg_resolve.run(graphify_units)

    # Files needing semantic refresh (deleted ones just drop out on reassembly)
    stale = [f for f in d["added"] + d["changed"] if not is_semantic_skip(f)]
    write_json(MANIFEST, d["snapshot"])
    specs = plan_semantic(stale) if stale else []
    write_json(STATE / "needs_semantic.json", {
        "files": stale, "specs": specs,
        "note": "Run the semantic agent stage over these specs, then `kg assemble && kg merge`.",
    })

    print("\nReassembling units + merging:")
    kg_assemble.run()
    kg_merge.run()

    if specs:
        print(f"\n{len(stale)} file(s) changed semantically -> {len(specs)} incremental "
              f"chunk spec(s) queued in state/chunks_incremental/")
        print("   The structural graph is already current. Ask Claude to run the")
        print("   semantic stage to refresh meaning for those files.")
    else:
        print("\nNo semantic refresh needed.")
    return {"stale": stale, "specs": specs, **{k: d[k] for k in ("added", "changed", "deleted")}}


if __name__ == "__main__":
    run()
