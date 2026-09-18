#!/usr/bin/env python3
"""
Deploy one or more edge functions through the Supabase Management API.

    SB_PAT=<personal access token> python3 scripts/deploy-edge-function.py signup-provision
    SB_PAT=... python3 scripts/deploy-edge-function.py signup-provision subscription-webhook

Why this exists rather than `supabase functions deploy`: the Supabase CLI is not
installed in this environment (`npx supabase` resolves to an unrelated 0.5.0
package), and the repo's deploy-functions.sh depends on it. This talks to the
Management API directly, which is the same thing the CLI does.

What it gets right, because each of these has broken a deploy before:

  * TRANSITIVE IMPORTS. A function's `../_shared/*.ts` imports must be uploaded
    with it. Shipping only index.ts produces a function that fails at import
    time on its first request — a dead endpoint, not a build error, so nothing
    tells you until a real user hits it.
  * THE PATH PREFIX. Files are uploaded under `supabase/functions/...`, matching
    how the live functions were deployed, so `../_shared/x.ts` resolves. A
    different prefix silently breaks every relative import.
  * verify_jwt IS CARRIED OVER from the currently deployed metadata, never
    assumed. Deploying a `verify_jwt = false` webhook as `true` makes Stripe's
    deliveries 401 — which looks like Stripe being broken, not like a bad
    deploy. If the function is not deployed yet, supabase/config.toml decides,
    and the default is true.

After deploying, verify what actually shipped:

    SB_PAT=... node scripts/check-edge-deploys.mjs
"""
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FUNCTIONS = os.path.join(REPO, "supabase", "functions")
CONFIG = os.path.join(REPO, "supabase", "config.toml")
PROJECT = os.environ.get("SUPABASE_PROJECT_ID", "hviqoaokxvlancmftwuo")
PREFIX = "supabase/functions"
LOCAL_IMPORT = re.compile(r"""from\s+["'](\.[^"']+)["']""")


def transitive_files(slug: str) -> list[str]:
    """Every local .ts file the entrypoint needs, relative to the functions root."""
    entry = os.path.join(FUNCTIONS, slug, "index.ts")
    if not os.path.isfile(entry):
        sys.exit(f"FATAL: {entry} does not exist")
    seen: set[str] = set()
    queue = [entry]
    while queue:
        path = os.path.realpath(queue.pop())
        if path in seen or not os.path.isfile(path):
            continue
        seen.add(path)
        src = open(path, encoding="utf-8").read()
        for spec in LOCAL_IMPORT.findall(src):
            target = os.path.realpath(os.path.join(os.path.dirname(path), spec))
            for candidate in (target, target + ".ts"):
                if os.path.isfile(candidate):
                    queue.append(candidate)
                    break
    return sorted(os.path.relpath(p, FUNCTIONS) for p in seen)


def verify_jwt_for(slug: str, token: str) -> bool:
    """The live setting if the function exists, else config.toml, else true."""
    try:
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{PROJECT}/functions/{slug}",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req) as res:
            live = json.loads(res.read().decode()).get("verify_jwt")
        if isinstance(live, bool):
            print(f"  verify_jwt: {live} (carried over from the deployed function)")
            return live
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    if os.path.isfile(CONFIG):
        section = f"[functions.{slug}]"
        text = open(CONFIG, encoding="utf-8").read()
        if section in text:
            tail = text.split(section, 1)[1].split("[", 1)[0]
            m = re.search(r"verify_jwt\s*=\s*(true|false)", tail)
            if m:
                value = m.group(1) == "true"
                print(f"  verify_jwt: {value} (from supabase/config.toml)")
                return value
    print("  verify_jwt: True (platform default — no live function, nothing in config.toml)")
    return True


def deploy(slug: str, token: str) -> bool:
    print(f"\n=== {slug} ===")
    files = transitive_files(slug)
    print(f"  files: {len(files)} ({', '.join(f for f in files if f.startswith('_shared'))[:120]}…)"
          if len(files) > 1 else f"  files: {files}")
    jwt = verify_jwt_for(slug, token)

    metadata = {
        "entrypoint_path": f"{PREFIX}/{slug}/index.ts",
        "name": slug,
        "verify_jwt": jwt,
    }

    boundary = uuid.uuid4().hex
    parts: list[bytes] = []

    def add(name: str, value: bytes, filename: str | None, ctype: str) -> None:
        disp = f'form-data; name="{name}"'
        if filename:
            disp += f'; filename="{filename}"'
        parts.append(
            b"--" + boundary.encode() + b"\r\n"
            + f"Content-Disposition: {disp}\r\n".encode()
            + f"Content-Type: {ctype}\r\n\r\n".encode()
            + value + b"\r\n"
        )

    add("metadata", json.dumps(metadata).encode(), None, "application/json")
    for rel in files:
        with open(os.path.join(FUNCTIONS, rel), "rb") as fh:
            add("file", fh.read(), f"{PREFIX}/{rel}", "application/typescript")

    body = b"".join(parts) + b"--" + boundary.encode() + b"--\r\n"
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT}/functions/deploy?slug={slug}",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    try:
        with urllib.request.urlopen(req) as res:
            out = json.loads(res.read().decode())
        print(f"  DEPLOYED  v{out.get('version')}  status={out.get('status')}  verify_jwt={out.get('verify_jwt')}")
        return True
    except urllib.error.HTTPError as e:
        print(f"  FAILED  HTTP {e.code}")
        print("  " + e.read().decode()[:800])
        return False


def main() -> None:
    token = os.environ.get("SB_PAT")
    if not token:
        sys.exit("FATAL: export SB_PAT with a Supabase personal access token")
    slugs = sys.argv[1:]
    if not slugs:
        sys.exit(f"usage: SB_PAT=… python3 {os.path.basename(__file__)} <slug> [slug…]")

    ok = all(deploy(slug, token) for slug in slugs)
    print("\nDone." if ok else "\nOne or more deploys FAILED — nothing was rolled back, so check each one above.")
    print("Verify what actually shipped:  SB_PAT=… node scripts/check-edge-deploys.mjs")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
