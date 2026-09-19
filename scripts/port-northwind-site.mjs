#!/usr/bin/env node
/**
 * Copy the new Northwind booking design (v2/apps/web) into the booking app.
 *
 *   node scripts/port-northwind-site.mjs
 *
 * The design was built as its own Next app. The booking app (apps/booking) is
 * the one that serves every tenant on the booking port, so the design lives
 * there too, behind a tenant check in apps/booking/src/middleware.ts:
 *
 *   v2/apps/web/src/{components,contexts,hooks,integrations,lib}
 *       -> apps/booking/src/northwind-site/...        (imported as `@nw/...`)
 *   v2/apps/web/src/app/<route groups>
 *       -> apps/booking/src/app/(northwind)/northwind-site/...
 *
 * The root layout and providers are NOT copied by this script — they are
 * adapted by hand in apps/booking/src/app/(northwind)/ because they differ
 * (the stylesheet is prebuilt; see scripts/build-northwind-css.mjs).
 *
 * Import rewrites, all mechanical:
 *   "@/app/..."          -> "@/app/(northwind)/northwind-site/..."
 *   "@/..."              -> "@nw/..."
 *   "lucide-react"       -> "lucide-react-nw"     (npm alias: the design's version)
 *   "sonner"             -> "sonner-nw"
 *   "react-day-picker"   -> "react-day-picker-nw"
 *   "tailwind-merge"     -> "tailwind-merge-nw"
 *   import { X as Y } from "radix-ui"  -> import * as Y from "@radix-ui/react-x"
 *     (the booking app already depends on every individual Radix package the
 *     design uses; the combined `radix-ui` package would upgrade shared ones)
 *
 * This was the one-time move. The copy in apps/booking is now the design's
 * source: edit it there. Re-running this script re-imports from v2/apps/web and
 * OVERWRITES the copied files, including any edits made in apps/booking since.
 * It never touches anything outside src/northwind-site and
 * src/app/(northwind)/northwind-site. After any change to class names, run
 * scripts/build-northwind-css.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'v2/apps/web/src');
const LIB_OUT = path.join(ROOT, 'apps/booking/src/northwind-site');
const APP_OUT = path.join(ROOT, 'apps/booking/src/app/(northwind)/northwind-site');

const LIB_DIRS = ['components', 'contexts', 'hooks', 'integrations', 'lib'];
// Adapted by hand, not copied.
const APP_SKIP = new Set(['layout.tsx', 'providers.tsx', 'globals.css']);

const PACKAGE_ALIASES = {
  'lucide-react': 'lucide-react-nw',
  sonner: 'sonner-nw',
  'react-day-picker': 'react-day-picker-nw',
  'tailwind-merge': 'tailwind-merge-nw',
};

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export function rewriteImports(code) {
  let out = code;

  // radix-ui combined package -> the individual packages.
  out = out.replace(/import\s*\{([^}]+)\}\s*from\s*(['"])radix-ui\2;?/g, (_m, names) =>
    names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((n) => {
        const [orig, local = orig] = n.split(/\s+as\s+/).map((s) => s.trim());
        return `import * as ${local} from "@radix-ui/react-${kebab(orig)}";`;
      })
      .join('\n'),
  );

  // Aliased packages (bare specifier or a subpath of it).
  for (const [from, to] of Object.entries(PACKAGE_ALIASES)) {
    const re = new RegExp(`(from\\s*|import\\s*\\(\\s*|import\\s+)(['"])${from.replace(/[-/]/g, '\\$&')}(/[^'"]*)?\\2`, 'g');
    out = out.replace(re, (_m, pre, q, sub = '') => `${pre}${q}${to}${sub}${q}`);
  }

  // Path aliases. `@/app/` first: those files moved under the route group.
  out = out.replace(/(['"])@\/app\//g, '$1@/app/(northwind)/northwind-site/');
  out = out.replace(/(['"])@\/(?!app\/\(northwind\))/g, '$1@nw/');
  return out;
}

function copyTree(from, to, skip = new Set(), isTop = true) {
  let n = 0;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (isTop && skip.has(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      n += copyTree(src, dst, skip, false);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) {
      fs.writeFileSync(dst, rewriteImports(fs.readFileSync(src, 'utf8')));
      n++;
    } else {
      fs.copyFileSync(src, dst);
      n++;
    }
  }
  return n;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let total = 0;
  for (const dir of LIB_DIRS) {
    const n = copyTree(path.join(SRC, dir), path.join(LIB_OUT, dir));
    console.log(`src/${dir}`.padEnd(22), `${n} files -> apps/booking/src/northwind-site/${dir}`);
    total += n;
  }
  const n = copyTree(path.join(SRC, 'app'), APP_OUT, APP_SKIP);
  console.log('src/app (routes)'.padEnd(22), `${n} files -> apps/booking/src/app/(northwind)/northwind-site`);
  total += n;
  console.log(`copied ${total} files`);
}
