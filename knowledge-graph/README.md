# drive-247 knowledge graph

A navigable map of this monorepo: every app, every edge function, the database
schema, and the seams that connect them. Built with
[graphify](https://github.com/safishamsi/graphify), extended where graphify alone
could not cover this repo.

Everything lives under `knowledge-graph/` and nothing outside it is modified,
apart from a `.graphifyignore` at the repo root and (optionally) a git
post-commit hook.

```
knowledge-graph/
  bin/kg                  the pipeline CLI - start here
  bin/lib/units.json      how the repo is partitioned; edit this to add a unit
  bin/lib/kg_*.py         one module per pipeline stage
  units/<unit>/graphify-out/
      graph.json          that unit's graph, standalone and queryable
      graph.html          interactive view
      GRAPH_REPORT.md     audit report (god nodes, surprises, cohesion)
  merged/
      graph.json          the unified cross-unit graph
      graph.html          aggregated whole-system view
      GRAPH_REPORT.md     unified audit report
  state/                  detect results, chunk plans, manifest, staleness
```

## Quick start

```bash
cd knowledge-graph

./bin/kg status                      # what exists and what is stale
./bin/kg query "how does a booking become a signed rental agreement?"
./bin/kg query -u portal "how are manager permissions enforced?"
./bin/kg path "tenant_subscriptions" "subscription-webhook"
./bin/kg explain "installment_plans"

open merged/graph.html               # whole-system view
open units/portal/graphify-out/graph.html
```

## The nine units

The repo is split into units that are extracted independently and then merged.
`bin/lib/units.json` is the single source of truth; every stage reads it.

| unit | source | why it is its own unit |
|---|---|---|
| `portal` | `apps/portal` | operator admin, by far the largest app |
| `booking` | `apps/booking` | customer site + customer portal, separate auth |
| `admin` | `apps/admin` | super-admin across tenants |
| `web` | `apps/web` | marketing site |
| `bonzah` | `apps/bonzah` | insurance-partner tenant app |
| `edge-functions` | `supabase/functions` | ~320 Deno functions, the real backend |
| `database` | `supabase/migrations` | schema, RLS, triggers |
| `docs` | `docs/`, `CLAUDE.md` | specs and design rationale |
| `scripts` | `scripts/`, root `*.mjs` | ops and seeding |

## How a build works

```
detect -> ast + sql -> resolve -> chunk -> [semantic agents] -> assemble -> merge -> labels -> html
         \________________________________/                    \_______________________________/
             deterministic, free, fast                          needs the graph + (once) agents
```

Two layers, and the distinction matters for keeping it current:

- **Structural** — AST symbols, SQL schema, resolved imports, cross-unit seams.
  Deterministic, costs nothing, rebuilt on every commit.
- **Semantic** — what code *means*: business capabilities, rationale, non-obvious
  couplings. Produced by agents, refreshed on demand.

The structural layer can never drift from the code. The semantic layer can, so
`kg status` always reports exactly how far behind it is instead of pretending.

## Four things this adds on top of stock graphify

Each of these exists because a measured failure on *this* repo required it.

**1. SQL is a first-class unit.** graphify's classifier has no `.sql` extension,
so all 335 migrations — the authoritative data model — were invisible. `kg_sql.py`
extracts tables, columns, foreign keys, indexes, triggers, RLS policies and SQL
functions. Columns are stored as an attribute on the table node rather than as
~1600 leaf nodes that would dominate clustering.

**2. Node ids are namespaced before merging.** `graphify merge-graphs` composes
with `networkx.compose_all`, which merges by node id and does not namespace.
Measured here, that silently fuses **439 nodes** — 313 between portal and booking
alone — because every Next.js app produces `layout_rootlayout`, `page_home` and
identical shadcn symbol ids. Merging without namespacing would have quietly
reported one app's structure as another's. Units are prefixed `<unit>__` at merge
time; per-unit graphs stay un-prefixed so they remain directly queryable.

Deliberately *not* namespaced, so they stay shared and act as bridges:
`ext__<pkg>` (a dependency several apps use), plus the seam targets below.

**3. Imports are resolved to real files.** graphify's AST records `imports_from`
edges whose target is just the last segment of the specifier (`react`,
`agreement_injection`) and does not create those nodes — so networkx would
materialise ~775 attribute-less junk nodes per unit and the true dependency
structure would be lost. `kg_resolve.py` re-reads the import statements and
resolves them against the filesystem (relative paths, `@/` aliases, npm/jsr/deno
URLs), turning **10,234 dangling stubs into 6,774 real file-to-file imports and
3,426 external dependency edges**, with 19 left unresolved.

**4. Cross-unit seams are derived, not guessed.** Units are extracted in
isolation, so nothing in them connects a portal hook to the edge function it
calls or an edge function to the table it writes. `kg_link.py` derives those from
source: `functions.invoke('x')`, `.from('table')` classified as read vs write,
`.rpc()`, and storage buckets. A captured name only becomes an edge if the target
actually exists — a real table in the migrations, a real `supabase/functions/<name>/`
directory — which is what keeps `Array.from(...)` out of the table graph.

Because these are grep-level facts rather than model output, they cost nothing
and re-run on every update, so the seam layer cannot drift.

## Keeping it current

```bash
./bin/kg hook install     # rebuild the structural layer after every commit
./bin/kg update           # or run it by hand
./bin/kg status           # shows exactly what is stale
```

`kg update` hashes every file, re-extracts only the units that changed, re-derives
the seams, and re-merges. It then writes `state/needs_semantic.json` listing the
files whose *meaning* may have changed, and pre-plans incremental chunk specs for
just those files — so a normal commit refreshes a handful of chunks rather than
all 108.

To refresh meaning, ask Claude:

> refresh the knowledge graph's semantic layer — run `kg pending` and extract those chunks

Claude runs the extraction agents over the pending specs, then `kg assemble && kg merge`.

## Corpus decisions

Reported rather than silent, because a graph that hides what it skipped is
worse than one that covers less:

- **Excluded** via `.graphifyignore`: build output (`.next`, `.turbo`), `node_modules`,
  `v2/` (a stale duplicate scaffold: 1094 files, one of them real source),
  gitignored scratch dirs, and `public/` assets.
- **AST-only, withheld from semantic agents**: 192 shadcn/ui primitives (duplicated
  near-verbatim across five apps) and four 637KB generated `supabase/types.ts`
  files. Structure is captured; agents do not read generated DB typings four times.
- **Images skipped**: all 17 surviving images are marketing hero photos or app
  icons, so a vision agent per image would buy no architectural signal.
- **Duplicate renderings collapsed**: 8 documents exist as both `.pdf` and
  `.md`/`.html`. The richest text form is kept; extracting both would duplicate
  every concept node.
- **Oversized files get their own chunk**: this repo has a 401KB
  `rentals/[id]/page.tsx` and a 305KB `remote_schema.sql`. Bundling one with 19
  neighbours would exhaust an agent's context and silently truncate the batch.

## Reading the audit trail

Every edge carries a confidence tag, so you can always tell what was found from
what was inferred:

- `EXTRACTED` — explicit in the source (an import, a `.from('rentals')`, a foreign key). Score 1.0.
- `INFERRED` — a reasonable reading (shared data, implied dependency). 0.4–0.9.
- `AMBIGUOUS` — genuinely uncertain, kept and flagged rather than dropped. 0.1–0.3.

`AMBIGUOUS` seams are real findings worth looking at. For example, an
`.rpc('name')` call whose function is not defined in any migration file shows up
as `unresolved_sql_function` — which is exactly what you would expect in a project
where some database objects were applied outside the migration history.

## Commands

```
kg build            full deterministic build (everything except the agent stage)
kg update           incremental re-extract + re-merge
kg status           unit/unified sizes, and what is stale
kg chunk            (re)plan the semantic fan-out, print the agent count
kg pending          chunk specs waiting for a semantic pass
kg assemble         rebuild unit graphs from structural + semantic fragments
kg merge            re-merge units into the unified graph
kg html             regenerate the unified HTML view
kg query "..."      query the unified graph   (-u <unit> to scope to one unit)
kg path "A" "B"     shortest path between two nodes
kg explain "X"      explain a node and its neighbours
kg hook install     rebuild structure on every git commit
kg doctor           verify the workspace is wired up
```

## Adding a unit

Add an entry to `bin/lib/units.json` and run `./bin/kg build`. Every stage picks
it up — there is no second place to register it.
