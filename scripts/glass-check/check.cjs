/**
 * glass:check — does the Glass look hold on every page of the portal?
 *
 * Opens the real portal as the northwind canary in system Chrome, visits every
 * page in pages.json at desktop and phone width, in light and dark, takes a
 * screenshot of each, and runs the checks below. Writes out/report.md and
 * out/report.json beside the screenshots and exits non-zero if anything failed.
 *
 *   npm run glass:check                      every page, every view
 *   npm run glass:check -- dashboard rentals only those pages
 *   npm run glass:check -- --view=desktop-light
 *
 * Needs the portal dev server on :4002 (npm run dev:portal) and
 * SUPABASE_ACCESS_TOKEN, exactly as v1:check does. It signs in by minting one
 * session for GLASS_CHECK_EMAIL (default: the canary's operator) through the
 * auth admin API — no password, no email sent — and revokes that one session
 * when it finishes. Every page load is a read; nothing is written.
 *
 * WHAT IT CATCHES (broken, not ugly — a person still has to like the page):
 *   look-off     the page is not in Glass at all
 *   page-error   an uncaught exception or a failed load
 *   solid-slab   a large opaque block left inside the content (a card or
 *                panel Glass did not reach)
 *   faint-text   text whose contrast against what is painted behind it is
 *                below 3:1 over either the lightest or the darkest part of
 *                the backdrop
 *   overflow     the page scrolls sideways
 *
 * pages.json: { name, path } per page. `open` names a button to press first, so
 * a dialog, menu or panel is checked while it is open; `desktopOnly` skips the
 * phone views for it.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REF = 'hviqoaokxvlancmftwuo';
const ORIGIN = process.env.GLASS_CHECK_ORIGIN || 'http://northwind.portal.localhost:4002';
const EMAIL = process.env.GLASS_CHECK_EMAIL || 'ghulam@cortek.uk';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const OUT = path.join(__dirname, 'out');

/**
 * Errors the portal throws with or without Glass, so not this check's to
 * fail on. Each one is a real bug to fix in its own right:
 *   - Messages: the realtime chat adds presence callbacks after joining.
 */
const KNOWN_ERRORS = ['cannot add presence callbacks after joining a channel'];

const VIEWS = [
  { name: 'desktop-light', width: 1440, height: 900, scheme: 'light' },
  { name: 'desktop-dark', width: 1440, height: 900, scheme: 'dark' },
  { name: 'phone-light', width: 390, height: 844, scheme: 'light' },
  { name: 'phone-dark', width: 390, height: 844, scheme: 'dark' },
];

async function api(url, init = {}) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${url} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function mintSession() {
  if (!TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const keys = await api(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': UA },
  });
  const key = (name) => keys.find((k) => k.name === name)?.api_key;
  const anon = key('anon');
  const service = key('service_role');
  const base = `https://${REF}.supabase.co/auth/v1`;
  const link = await api(`${base}/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: EMAIL }),
  });
  const session = await api(`${base}/verify`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: link.hashed_token }),
  });
  const revoke = () =>
    fetch(`${base}/logout?scope=local`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  return { session, revoke };
}

/** Runs in the page. Returns the findings for what is on screen. */
function inspect() {
  const findings = [];
  const root = document.documentElement;
  if (root.getAttribute('data-portal-look') !== 'glass') {
    findings.push({ check: 'look-off', detail: 'html has no data-portal-look="glass"' });
    return findings;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (root.scrollWidth > vw + 2) findings.push({ check: 'overflow', detail: `page is ${root.scrollWidth}px wide in a ${vw}px window` });

  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const label = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 6).join('.');
    const slot = el.getAttribute('data-slot');
    return `${el.tagName.toLowerCase()}${slot ? `[data-slot=${slot}]` : ''}${cls ? '.' + cls : ''}`.slice(0, 150);
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return null;
    return { r, cs };
  };

  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;color:hsl(var(--primary))';
  document.body.appendChild(probe);
  const brand = parse(getComputedStyle(probe).color);
  probe.remove();

  // solid-slab: a big opaque block inside the content.
  const main = document.querySelector('main');
  const LAYERS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"], [data-slot="hover-card-content"]';
  const zones = [main, ...document.querySelectorAll(LAYERS)].filter(Boolean);
  {
    const seen = [];
    const candidates = zones.flatMap((zone) => [zone === main ? null : zone, ...zone.querySelectorAll('*')].filter(Boolean));
    for (const el of candidates) {
      const v = visible(el);
      if (!v) continue;
      const area = Math.min(v.r.width, vw) * Math.min(v.r.height, vh);
      // A layer is small, so a smaller block counts inside one.
      if (area < (el.closest(LAYERS) ? 30000 : 60000)) continue;
      const bg = parse(v.cs.backgroundColor);
      if (!bg || bg.a < 0.93 || v.cs.backgroundImage !== 'none') continue;
      // Pictures, previews of the tenant's own artwork, and blocks painted in the brand colour on purpose.
      if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'VIDEO' || el.closest('[data-glass-skip], figure')) continue;
      if (brand && Math.abs(bg.r - brand.r) + Math.abs(bg.g - brand.g) + Math.abs(bg.b - brand.b) < 12) continue;
      if (seen.some((s) => s.contains(el))) continue;
      seen.push(el);
      findings.push({ check: 'solid-slab', detail: `${label(el)} — ${Math.round(v.r.width)}×${Math.round(v.r.height)} solid ${v.cs.backgroundColor}` });
      if (seen.length >= 8) break;
    }
  }

  // faint-text: contrast of text against everything painted behind it, over
  // the lightest and the darkest the backdrop gets.
  const dark = root.classList.contains('dark');
  const backdrops = dark ? [{ r: 12, g: 10, b: 30 }, { r: 70, g: 72, b: 110 }] : [{ r: 246, g: 246, b: 252 }, { r: 150, g: 152, b: 190 }];
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a) });
  const faint = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  let budget = 900;
  while ((node = walker.nextNode()) && budget-- > 0) {
    if (!node.nodeValue || node.nodeValue.trim().length < 2) continue;
    const el = node.parentElement;
    if (!el || el.closest('[aria-hidden="true"], svg, [data-glass-skip], nextjs-portal')) continue;
    const v = visible(el);
    if (!v) continue;
    // A segmented control's label sits over a sliding thumb that is a sibling,
    // not an ancestor, so its real ground cannot be read from the tree.
    if ([...(el.parentElement?.children || [])].some((c) => c !== el && getComputedStyle(c).position === 'absolute')) continue;
    const ink = parse(v.cs.color);
    if (!ink || ink.a < 0.1) continue;
    const layers = [];
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('rgb(255 255 255')) { layers.length = 0; layers.push(null); break; }
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0.01) layers.push(bg);
      if (bg && bg.a >= 0.98) break;
    }
    if (layers[0] === null) continue; // sits on a picture or gradient: not judged here
    let worst = Infinity;
    for (const backdrop of backdrops) {
      let behind = backdrop;
      for (let i = layers.length - 1; i >= 0; i--) behind = over(layers[i], behind);
      const text = over(ink, behind);
      const a = lum(text), b = lum(behind);
      worst = Math.min(worst, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
    }
    const size = parseFloat(v.cs.fontSize);
    const limit = size >= 18 ? 2.6 : 3;
    if (worst < limit) {
      const key = label(el);
      if (!faint.has(key)) faint.set(key, { ratio: worst, sample: node.nodeValue.trim().slice(0, 40), count: 0 });
      faint.get(key).count++;
    }
  }
  [...faint.entries()].slice(0, 10).forEach(([key, f]) =>
    findings.push({ check: 'faint-text', detail: `${f.ratio.toFixed(2)}:1 “${f.sample}” ×${f.count} — ${key}` })
  );
  return findings;
}

(async () => {
  const args = process.argv.slice(2);
  const viewArg = args.find((a) => a.startsWith('--view='))?.split('=')[1];
  const only = args.filter((a) => !a.startsWith('--'));
  const pages = require('./pages.json').filter((p) => !only.length || only.includes(p.name));
  const views = VIEWS.filter((v) => !viewArg || v.name === viewArg);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const { session, revoke } = await mintSession();
  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  try {
    for (const view of views) {
      const context = await browser.newContext({
        viewport: { width: view.width, height: view.height },
        deviceScaleFactor: 1,
        colorScheme: view.scheme,
        reducedMotion: 'reduce',
      });
      await context.addInitScript(
        ([key, value, theme]) => {
          localStorage.setItem(key, value);
          localStorage.setItem('theme', theme);
        },
        [`sb-${REF}-auth-token`, JSON.stringify(session), view.scheme]
      );
      const page = await context.newPage();
      for (const entry of pages) {
        if (entry.desktopOnly && view.width < 768) continue;
        const errors = [];
        const onError = (e) => errors.push(String(e.message || e).slice(0, 200));
        page.on('pageerror', onError);
        let findings = [];
        try {
          const res = await page.goto(ORIGIN + entry.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
          if (res && res.status() >= 400) findings.push({ check: 'page-error', detail: `HTTP ${res.status()}` });
          await page.waitForSelector('main', { timeout: 30000 });
          await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(1500);
          if (entry.open) {
            // A page entry can open one layer first (a dialog, a menu, a panel),
            // found by its button's accessible name.
            const trigger = page.getByRole('button', { name: entry.open, exact: false }).first();
            await trigger.click({ timeout: 8000 });
            await page.waitForTimeout(900);
          }
          if (new URL(page.url()).pathname.startsWith('/login')) findings.push({ check: 'page-error', detail: 'redirected to /login (session not accepted)' });
          findings = findings.concat(await page.evaluate(inspect));
        } catch (e) {
          findings.push({ check: 'page-error', detail: String(e.message || e).split('\n')[0].slice(0, 200) });
        }
        errors
          .filter((detail) => !KNOWN_ERRORS.some((known) => detail.includes(known)))
          .forEach((detail) => findings.push({ check: 'page-error', detail }));
        page.off('pageerror', onError);
        const shot = `${entry.name}.${view.name}.png`;
        await page.screenshot({ path: path.join(OUT, shot) }).catch(() => {});
        results.push({ page: entry.name, path: entry.path, view: view.name, shot, findings });
        process.stdout.write(`${findings.length ? '✗' : '✓'} ${entry.name.padEnd(14)} ${view.name.padEnd(14)} ${findings.length ? findings.length + ' finding(s)' : ''}\n`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    await revoke();
  }

  const failed = results.filter((r) => r.findings.length);
  const lines = ['# glass:check', '', `${results.length - failed.length} of ${results.length} views pass.`, ''];
  for (const r of results) {
    lines.push(`## ${r.findings.length ? 'FAIL' : 'PASS'} — ${r.page} (${r.view})  \`${r.shot}\``);
    r.findings.forEach((f) => lines.push(`- **${f.check}** ${f.detail}`));
    lines.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length} of ${results.length} views pass. Report: scripts/glass-check/out/report.md`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
