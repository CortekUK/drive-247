/**
 * Offline look at the portal's main sidebar Support row: the real AppSidebarV2 in
 * the real v2 SidebarProvider, with only its data hooks answered from memory.
 *
 * What it proves: Support sits directly under Fines with the same row height and
 * icon as its neighbours; the unread badge is right-aligned inside the row and the
 * label does not move when the count changes (0 → 2 → 12); the row's accessible
 * name carries the count; light and dark both render it legibly; the collapsed
 * rail keeps a corner badge; and the link opens /support.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig.js';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temp = await mkdtemp(resolve(tmpdir(), 'drive247-sidebar-badge-'));
const out = resolve(root, 'artifacts/support-sidebar-badge'); await mkdir(out, { recursive: true });

/* One module answers every mocked import; each export is what that hook returns. */
const fixture = `
import React from 'react';
/* Every mocked import path loads its own copy of this module, so the count lives on
   window where all copies share it. */
const shared = (window.__unread ??= { value: 2, listeners: new Set() });
window.setUnread = (n) => { shared.value = n; shared.listeners.forEach((l) => l()); };
export const useSupportUnreadMessages = () => ({ count: React.useSyncExternalStore((l) => { shared.listeners.add(l); return () => shared.listeners.delete(l); }, () => shared.value) });
export const usePathname = () => '/';
export const useRouter = () => ({ push: () => {}, replace: () => {} });
export const useSearchParams = () => new URLSearchParams();
export default function Link({ href, children, ...props }) { return React.createElement('a', { href, ...props, onClick: (e) => { e.preventDefault(); window.lastNavigation = href; props.onClick?.(e); } }, children); }
export const useReminderStats = () => ({ data: undefined });
export const useOrgSettings = () => ({ settings: {} });
export const useRentalSettings = () => ({ settings: {} });
export const useFleetHealthStats = () => ({ needsAttention: 0 });
export const useFleetHealthEnabled = () => false;
export const usePendingBookingsCount = () => ({ data: 0 });
export const useTenant = () => ({ tenant: { id: 't1', slug: 'acme-hire', company_name: 'Acme Hire' }, tenantSlug: 'acme-hire', refetchTenant: () => {} });
export const useTenantSubscription = () => ({});
export const useManagerPermissions = () => ({ isManager: false, canView: () => true, canViewSettings: () => true });
export const useCMSPages = () => ({ data: [], isLoading: false });
export const useNavPreferences = () => ({ preferences: { topLevelOrder: [], groupOrder: [], groupItemOrder: {}, hidden: [], pinned: [] } });
export const useV2 = () => true;
export const usePortalExperience = () => ({ onV2: true, lean: true });
export const usePortalOnV2 = () => true;
export const useRentalDetailV2 = () => ({});
export const useVehicleRecord = () => ({});
export const useCustomerRailHeader = () => ({ title: '', subtitle: '' });
export const OrgSwitcher = () => React.createElement('div', { className: 'flex h-10 items-center px-2 text-[13px] font-semibold' }, 'Acme Hire');
export const SidebarPromo = () => null;
export const DevSection = () => null;
export const SidebarCustomizerDialog = () => null;
export const TraxRail = () => null;
export const SupportRail = () => null;
export const UserMenuV2 = () => React.createElement('div', { className: 'flex h-10 items-center px-2 text-[13px]' }, 'Operator');
export const SettingsLinkV2 = () => null;
const auth = { appUser: { id: 'a1', role: 'head_admin', is_super_admin: false } };
export const useAuthStore = Object.assign((selector) => (selector ? selector(auth) : auth), { getState: () => auth, setState: () => {} });
export const useAuth = () => auth;
export const supabase = {};
`;
const mocked = ['@/hooks/use-support-messaging', 'next/navigation', 'next/link', '@/hooks/use-reminders', '@/hooks/use-org-settings', '@/hooks/use-rental-settings', '@/hooks/use-fleet-health', '@/hooks/use-pending-bookings', '@/contexts/TenantContext', '@/hooks/use-tenant-subscription', '@/hooks/use-manager-permissions', '@/hooks/use-cms-pages', '@/hooks/use-nav-preferences', '@/lib/v2-context', '@/components/rentals-v2/rental-detail/use-rental-detail-v2', '@/components/vehicles-v2/use-vehicle-record', '@/components/customers-v2/customer-detail/use-customer-detail-v2', '@/components/shared/layout/org-switcher', '@/components/shared/layout/sidebar-promo', '@/components/shared/layout/dev-section', '@/components/shared/layout/sidebar-customizer-dialog', '@/components/trax/trax-rail', '@/components/support/support-rail', '@/components/shared/layout/user-menu-v2', '@/stores/auth-store', '@/integrations/supabase/client'];
const portalPath = (request) => { const base = resolve(root, 'apps/portal/src', request.slice(2)); for (const c of [base + '.ts', base + '.tsx', resolve(base, 'index.ts'), resolve(base, 'index.tsx'), base]) if (existsSync(c)) return c; return base + '.ts'; };

const config = loadConfig(resolve(root, 'apps/portal/tailwind.config.ts'));
config.content = [resolve(root, 'apps/portal/src/components/shared/layout/app-sidebar-v2.tsx'), resolve(root, 'apps/portal/src/components/ui-v2/**/*.tsx')];
const css = (await postcss([tailwind(config)]).process((await readFile(resolve(root, 'apps/portal/src/global.css'), 'utf8')) + '\n' + (await readFile(resolve(root, 'apps/portal/src/styles/v2-theme.css'), 'utf8')), { from: undefined })).css;
await writeFile(resolve(temp, 'style.css'), css);
await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import {AppSidebarV2} from './apps/portal/src/components/shared/layout/app-sidebar-v2';
import {SidebarProvider,SidebarInset} from './apps/portal/src/components/ui-v2/sidebar';
import {TooltipProvider} from './apps/portal/src/components/ui-v2/tooltip';
createRoot(document.getElementById('root')).render(React.createElement(TooltipProvider,null,React.createElement(SidebarProvider,{className:'h-svh bg-background bg-app-gradient'},React.createElement(AppSidebarV2),React.createElement(SidebarInset,{className:'bg-transparent p-6 text-sm'},'Dashboard'))));`, resolveDir: root, loader: 'tsx' },
  outfile: resolve(temp, 'app.js'), bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"' }, logLevel: 'silent',
  plugins: [{ name: 'offline', setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (mocked.includes(args.path)) return { path: args.path, namespace: 'fixture' };
      if (args.path === 'react' || args.path === 'react-dom' || args.path === 'react-dom/client' || args.path.startsWith('react/')) return { path: resolve(root, 'node_modules', args.path === 'react' ? 'react/index.js' : args.path === 'react-dom' ? 'react-dom/index.js' : args.path === 'react-dom/client' ? 'react-dom/client.js' : args.path + '.js') };
      if (args.path.startsWith('@/')) return { path: portalPath(args.path) };
    });
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'jsx', resolveDir: root }));
  } }],
});
const server = createServer(async (req, res) => {
  const file = req.url === '/app.js' ? 'app.js' : req.url === '/style.css' ? 'style.css' : null;
  res.setHeader('Content-Type', file?.endsWith('.js') ? 'text/javascript' : file ? 'text/css' : 'text/html');
  res.end(file ? await readFile(resolve(temp, file)) : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="v2-theme"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));

let browser;
try {
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const rail = page.locator('[data-slot="sidebar-container"]');
  const support = rail.locator('a[href="/support"]');
  const fines = rail.locator('a[href="/fines"]');
  await support.waitFor();
  const box = async (l) => { const b = await l.boundingBox(); assert.ok(b, 'not on screen'); return b; };

  // Directly under Fines, the same row.
  const order = await rail.locator('a').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
  assert.equal(order[order.indexOf('/fines') + 1], '/support', 'Support is not directly below Fines');
  const f = await box(fines), s = await box(support);
  assert.equal(Math.round(s.height), Math.round(f.height), 'Support row height differs from Fines');
  assert.equal(Math.round(s.x), Math.round(f.x));
  assert.ok(Math.abs(s.y - (f.y + f.height)) < 8, 'Support does not follow Fines');

  // Hover and selected use the sidebar's own highlight (the Fines treatment), never white.
  const paint = (locator) => locator.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, fg: cs.color, icon: getComputedStyle(el.querySelector('svg')).color, radius: cs.borderRadius }; });
  const dashboard = rail.locator('a[href="/"]').first();
  const selected = await paint(dashboard);
  await page.mouse.move(5, 790);
  await fines.hover(); await page.waitForTimeout(250);
  const finesHover = await paint(fines);
  await support.hover(); await page.waitForTimeout(250);
  const supportHover = await paint(support);
  await page.screenshot({ path: resolve(out, 'sidebar-support-hover.png'), clip: { x: 0, y: 380, width: 300, height: 220 } });
  assert.deepEqual(supportHover, finesHover, 'Support does not hover like Fines');
  assert.equal(supportHover.bg, selected.bg, 'Support\u2019s hover is not the selected item\u2019s tint');
  assert.equal(supportHover.fg, selected.fg);
  assert.equal(supportHover.icon, selected.icon);
  assert.notEqual(supportHover.bg, 'rgb(255, 255, 255)', 'Support hovers white');
  await page.mouse.move(5, 790); await page.waitForTimeout(250);

  const label = support.locator('span').first();
  const badge = support.locator('span[aria-hidden="true"]');
  await badge.waitFor();
  assert.equal(await badge.textContent(), '2');
  assert.equal(await support.getAttribute('aria-label'), 'Support, 2 unread messages');
  const b2 = await box(badge), l2 = await box(label);
  assert.ok(s.x + s.width - (b2.x + b2.width) <= 12, 'the badge is not at the row\u2019s right edge');
  assert.ok(Math.abs((b2.y + b2.height / 2) - (s.y + s.height / 2)) <= 1.5, 'the badge is not vertically centred in the row');
  const colors = await badge.evaluate((el) => { const cs = getComputedStyle(el); return { fg: cs.color, bg: cs.backgroundColor }; });
  assert.notEqual(colors.fg, colors.bg);
  await page.screenshot({ path: resolve(out, 'sidebar-light-2.png'), clip: { x: 0, y: 0, width: 300, height: 800 } });

  await page.evaluate(() => window.setUnread(12));
  await page.waitForFunction(() => document.querySelector('[data-slot="sidebar-container"] a[href="/support"] span[aria-hidden="true"]')?.textContent === '12');
  const l12 = await box(label);
  assert.equal(Math.round(l12.x), Math.round(l2.x), 'the label moved when the count changed');
  assert.equal(await support.getAttribute('aria-label'), 'Support, 12 unread messages');
  const b12 = await box(badge);
  assert.ok(Math.abs((b12.x + b12.width) - (b2.x + b2.width)) <= 1, 'the badge\u2019s right edge moved');

  await page.evaluate(() => window.setUnread(1));
  await page.waitForFunction(() => document.querySelector('[data-slot="sidebar-container"] a[href="/support"]')?.getAttribute('aria-label') === 'Support, 1 unread message');
  await page.evaluate(() => window.setUnread(0));
  await page.waitForFunction(() => !document.querySelector('[data-slot="sidebar-container"] a[href="/support"] span[aria-hidden="true"]'));
  assert.equal(await support.getAttribute('aria-label'), null);
  assert.equal(Math.round((await box(label)).x), Math.round(l2.x), 'the label moved when the badge disappeared');

  // Dark.
  await page.evaluate(() => { window.setUnread(2); document.documentElement.classList.add('dark'); });
  await badge.waitFor();
  await page.screenshot({ path: resolve(out, 'sidebar-dark-2.png'), clip: { x: 0, y: 0, width: 300, height: 800 } });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));

  // Collapsed: a corner badge on the icon.
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);
  const corner = support.locator('span[aria-hidden="true"]');
  await corner.waitFor();
  assert.equal(await corner.textContent(), '2');
  await page.screenshot({ path: resolve(out, 'sidebar-collapsed-2.png'), clip: { x: 0, y: 0, width: 120, height: 800 } });
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(400);

  // It opens the existing Support section.
  await support.click();
  assert.equal(await page.evaluate(() => window.lastNavigation), '/support');

  assert.deepEqual(errors, [], 'page errors: ' + errors.join(' || '));
  console.log(JSON.stringify({ status: 'passed', mode: 'support-sidebar-badge', checks: ['directly-below-fines', 'same-row-height-and-inset', 'badge-right-aligned-and-centred', 'accessible-name-with-count', 'label-fixed-as-count-changes', 'singular-message', 'hidden-at-zero', 'dark-mode', 'collapsed-corner-badge', 'opens-support-route', 'support-hover-matches-fines-and-selected', 'no-page-errors'], screenshots: out }));
} finally {
  await browser?.close();
  server.close();
}
