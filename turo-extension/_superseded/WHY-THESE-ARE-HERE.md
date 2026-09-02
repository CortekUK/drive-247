# Superseded files

Three agents built this extension into the same folder at the same time. These
files are the parts that lost the reconciliation. Nothing in `manifest.json`
references them, so Chrome ignores them entirely — they are kept only because
they were untracked by git and deleting them would have been unrecoverable.

**You can delete this whole folder.**

## What happened to each

| File | Outcome |
|---|---|
| `lib/schema.js` | Its normalisation layer — locale-agnostic `parseAmount`, the 25-symbol currency table, the null-vs-zero rating rule, `parseVehicleName`, `parseSection` — was **merged into `../parsers.js`** and is live. |
| `lib/csv.js` | Its Excel-safety design — BOM, CRLF, the two-step `="..."` escape, `needsTextForcing` — was **merged into `../csv.js`** and is live. |
| `lib/sheet.js` | Its clipboard-TSV design (leading-apostrophe escaping, distinct from CSV) was **merged into `../csv.js`** as `buildTSV`. |
| `lib/extract.js` | **Superseded and not merged.** Its header states "the real DOM has never been seen", and it leads with `script#__NEXT_DATA__` and JSON-LD listings. Both were later disproven against real Wayback captures of turo.com: Turo is Next.js **App Router** (no `__NEXT_DATA__` at all) and its only JSON-LD block is `schema.org/Organization` — a phone number, zero listing data. Using it would silently find nothing and fall through to the weaker DOM tiers. `../extractor.js` replaces it. |
| `popup-layered.*` | An alternative popup. `../popup.html` + `../popup.js` are canonical. |
