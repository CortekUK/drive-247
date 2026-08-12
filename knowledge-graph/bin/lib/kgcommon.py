"""Shared helpers for the drive-247 knowledge-graph pipeline.

Every stage (detect, ast, sql, semantic, namespace, link, merge) imports from
here so that the unit partition lives in exactly one place: units.json.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

KG_ROOT = Path(__file__).resolve().parents[2]      # knowledge-graph/
LIB = KG_ROOT / "bin" / "lib"
STATE = KG_ROOT / "state"
UNITS_DIR = KG_ROOT / "units"
MERGED = KG_ROOT / "merged"

_manifest = json.loads((LIB / "units.json").read_text())
REPO = Path(_manifest["repo_root"]).resolve()
UNITS = _manifest["units"]
UNIT_BY_NAME = {u["name"]: u for u in UNITS}
UNIT_NAMES = [u["name"] for u in UNITS]

# Files that get structural (AST) treatment but are deliberately withheld from
# semantic agents. Both categories are high-volume and semantically empty:
#   - shadcn/ui primitives are duplicated near-verbatim across all five apps
#   - integrations/supabase/types.ts is 637KB of generated DB typings x4 copies
SEMANTIC_SKIP_MARKERS = ("/components/ui/",)
SEMANTIC_SKIP_SUFFIXES = ("integrations/supabase/types.ts",)


def unit_dir(name: str) -> Path:
    return UNITS_DIR / name


def unit_out(name: str) -> Path:
    d = UNITS_DIR / name / "graphify-out"
    d.mkdir(parents=True, exist_ok=True)
    return d


def unit_paths(unit: dict) -> list[Path]:
    """Absolute, existing source paths for a unit."""
    out = []
    for rel in unit["paths"]:
        p = REPO / rel
        if p.exists():
            out.append(p)
    return out


def is_semantic_skip(path: str) -> bool:
    p = path.replace(os.sep, "/")
    if any(m in p for m in SEMANTIC_SKIP_MARKERS):
        return True
    if any(p.endswith(s) for s in SEMANTIC_SKIP_SUFFIXES):
        return True
    return False


def rel(path: str | Path) -> str:
    """Repo-relative path, for stable source_file values across machines."""
    p = Path(path)
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


def load_json(p: Path, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, json.JSONDecodeError):
        return default


def write_json(p: Path, obj) -> None:
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2))
    os.replace(tmp, p)
