/* Run against npm run dev:portal. Only the development fixture route is used. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = process.env.TIMELINE_BASE_URL || 'http://localhost:4002';
const output = path.resolve(process.env.TIMELINE_SCREENSHOT_DIR || '../timeline-review/browser');
const executablePath = process.env.BROWSER_EXE || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    // Never send a mutation to an external service during the fixture review.
    await page.route('**/*', route => {
      const request = route.request();
      if (!request.url().startsWith(base) && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto(`${base}/playground/timeline`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.getByTestId('timeline').waitFor();
    await page.evaluate(() => document.fonts.ready);
    // This installed Chrome/Playwright pair probes a 1x1 viewport for fullPage,
    // which changes responsive layouts. Capture the actual operator viewport.
    const screenshot = async name => { await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); };
    const surface = name => page.getByRole('navigation', { name: 'Preview surface' }).getByRole('button', { name, exact: true });
    const geometry = () => page.locator('.tl-booking').evaluateAll(nodes => nodes.map(el => ({ id: el.dataset.bookingId, left: el.style.left, width: el.style.width })).sort((a, b) => a.id.localeCompare(b.id)));
    const original = await geometry();
    assert.equal(original.length, 8);
    const perspectives = page.getByRole('group', { name: 'Timeline perspective' });
    assert.equal(await perspectives.getByRole('button', { name: 'Rental', exact: true }).getAttribute('aria-pressed'), 'true');
    for (const name of ['Vehicle', 'Customer', 'Rental']) {
      await perspectives.getByRole('button', { name, exact: true }).click();
      assert.deepEqual(await geometry(), original, `Booking dates or durations changed in ${name} perspective`);
    }
    await page.getByRole('button', { name: 'Show bookings on Sep 10, 2026, today', exact: true }).click();
    assert.equal(await page.locator('.tl-day-item').count(), 3, 'Earlier starts must be included on the selected date');
    await page.getByRole('button', { name: 'Close date details' }).click();
    const first = page.locator('[data-booking-id="fixture-rental-a"]');
    await first.focus();
    await page.getByRole('tooltip').waitFor();
    await first.click();
    await page.locator('[data-slot="popover-content"]').waitFor();
    await screenshot('booking-details');
    await page.keyboard.press('Escape');
    await page.locator('[data-slot="popover-content"]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-booking-id') === 'fixture-rental-a');
    assert.equal(await first.evaluate(el => document.activeElement === el), true);
    await page.getByRole('button', { name: 'Filter timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Active', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.tl-booking').count(), 2);
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await perspectives.getByRole('button', { name: 'Vehicle', exact: true }).click();
    await page.getByRole('button', { name: 'Filter timeline', exact: true }).click();
    await page.getByRole('checkbox', { name: /Toyota RAV4/ }).check();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.tl-booking').count(), 2);
    await page.getByRole('button', { name: 'Clear all', exact: true }).click();
    await perspectives.getByRole('button', { name: 'Rental', exact: true }).click();
    await screenshot('main');
    for (const label of ['Week', '2 weeks']) {
      await page.getByRole('group', { name: 'Date window' }).getByRole('button', { name: label, exact: true }).click();
      assert.equal(await page.locator('.tl-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${label} should fit without horizontal scrolling`);
    }
    assert.equal(await page.locator('.tl-line-label, .tl-line-status').count(), 0, 'No labels or filled cards in booking strokes');
    const paint = await first.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, line: getComputedStyle(el.querySelector('.tl-booking-stroke')).height, target: el.clientHeight }));
    assert.equal(paint.background, 'rgba(0, 0, 0, 0)');
    assert.ok(parseFloat(paint.line) <= 3 && paint.target >= 24, 'Thin strokes need a usable invisible hit area');
    await perspectives.getByRole('button', { name: 'Vehicle', exact: true }).click();
    assert.equal(await page.locator('.tl-grid-row[data-row-id]').count(), 4, 'Group by vehicle without merging its bookings');
    await screenshot('main-vehicles');
    await perspectives.getByRole('button', { name: 'Rental', exact: true }).click();
    await page.getByRole('button', { name: 'Toggle preview theme' }).click();
    await screenshot('main-dark');
    await page.getByRole('button', { name: 'Toggle preview theme' }).click();

    await page.getByRole('group', { name: 'Date window' }).getByRole('button', { name: 'Month', exact: true }).click();
    assert.equal(await page.locator('.tl-date').count(), 30);
    await page.locator('.tl-scroll').evaluate(el => { el.scrollLeft = 300; });
    const headerDate = await page.getByRole('button', { name: 'Show bookings on Sep 10, 2026, today', exact: true }).boundingBox();
    const positionedBooking = await first.boundingBox();
    assert.ok(Math.abs(headerDate.x - positionedBooking.x) < 1.5, 'Header and booking start must stay aligned while scrolling');
    const identityX = (await page.locator('.tl-identity-heading').boundingBox()).x;
    await screenshot('main-month');
    assert.equal(Math.round((await page.locator('.tl-identity-heading').boundingBox()).x), Math.round(identityX));
    await page.getByRole('button', { name: 'Next period', exact: true }).click();
    assert.equal(await page.locator('.tl-date').count(), 31, 'Month navigation must use the actual month length');

    await page.getByRole('button', { name: 'Choose date range', exact: true }).click();
    await page.getByLabel('From', { exact: true }).fill('2026-09-01');
    await page.getByLabel('Through', { exact: true }).fill('2026-11-30');
    await page.getByRole('button', { name: 'Show dates', exact: true }).click();
    assert.equal(await page.locator('.tl-date').count(), 91);
    const stickyX = (await page.locator('.tl-identity-heading').boundingBox()).x;
    await page.locator('.tl-scroll').evaluate(el => { el.scrollLeft = 850; });
    assert.equal(Math.round((await page.locator('.tl-identity-heading').boundingBox()).x), Math.round(stickyX), 'Identity stays sticky across long date ranges');
    await screenshot('main-long-range');

    await surface('Rental').click();
    assert.equal(await page.getByRole('tab', { name: 'Payment Plan', exact: true }).getAttribute('aria-selected'), 'true');
    await screenshot('rental');
    await page.getByRole('button', { name: 'Manage', exact: true }).click();
    await page.getByRole('button', { name: 'Preview manual extension', exact: true }).click();
    await page.getByLabel('New end date', { exact: true }).fill('2026-09-11');
    await page.getByRole('button', { name: 'Preview extension', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'after the current end date' }).waitFor();
    await page.getByLabel('New end date', { exact: true }).fill('2026-09-20');
    await screenshot('extension-dialog');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.locator('.rp-period-key-item').count(), 1, 'Cancel must leave the plan untouched');
    for (const [index, end] of [[1, '2026-09-20'], [2, '2026-09-24'], [3, '2026-09-28']]) {
      await page.getByRole('button', { name: 'Preview manual extension', exact: true }).click();
      assert.match(await page.getByRole('heading', { name: /Manual extension/ }).innerText(), new RegExp(`#${index}`));
      await page.getByLabel('New end date', { exact: true }).fill(end);
      await page.getByRole('button', { name: 'Preview extension', exact: true }).click();
      await page.getByRole('heading', { name: /Manual extension/ }).waitFor({ state: 'hidden' });
      assert.equal(await page.locator('.rp-period-key-item').count(), index + 1);
      assert.match(await page.locator('.rp-period-key-item').first().innerText(), /Sep 10, 2026.*Sep 12, 2026/s);
    }
    assert.match(await page.locator('.rp-period-key-item').last().innerText(), /Extension #3/);
    assert.equal(await page.locator('.tl-booking, .tl-date-header').count(), 0, 'The rental calendar must not render a line-based timeline');
    assert.equal(await page.locator('[data-rental-date][data-periods~="fixture-rental-a:original"]').count(), 3, 'The original date boxes remain filled');
    assert.equal(await page.locator('[data-rental-date]').count(), 30, 'The complete month remains visible');
    assert.equal(await page.locator('.rp-occupied').count(), 19, 'Every rental and extension date remains colored');
    assert.equal(await page.getByRole('button', { name: 'Preview manual extension', exact: true }).getAttribute('data-extension-date'), '2026-09-29');
    assert.equal(await page.locator('.rp-date-boxes').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, 'Date boxes wrap instead of scrolling horizontally');
    const colors = await page.locator('[data-rental-date="2026-09-10"] .rp-box-fills > span, [data-rental-date="2026-09-13"] .rp-box-fills > span, [data-rental-date="2026-09-21"] .rp-box-fills > span').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).backgroundColor));
    assert.equal(new Set(colors).size, 3, 'Original and two extensions have distinct fills');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await screenshot('rental-extensions');
    await page.getByRole('tab', { name: 'Activity', exact: true }).click();
    await page.getByRole('tab', { name: 'Payment Plan', exact: true }).click();
    assert.equal(await page.locator('.rp-occupied').count(), 19, 'Switching contextual tabs should retain previews');

    await surface('Customer').click();
    assert.equal(await page.getByRole('tab', { name: 'At a glance', exact: true }).count(), 1);
    assert.equal(await page.locator('.tl-booking').count(), 2);
    await screenshot('customer');
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.getByRole('button', { name: 'Timeline & overview', exact: true }).click();
    await page.getByRole('tab', { name: 'Timeline', exact: true }).waitFor();
    await screenshot('customer-laptop-panel');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await surface('Vehicle').click();
    assert.match(await page.locator('.tl-rate-grid').innerText(), /Daily.*89.*Weekly.*520.*Monthly.*1,890/s);
    assert.equal(await page.locator('.tl-cell-price').count(), 7);
    await screenshot('vehicle');
    await page.getByRole('button', { name: 'Block dates', exact: true }).click();
    await page.getByLabel('From', { exact: true }).fill('2026-09-13');
    await page.getByLabel('Through', { exact: true }).fill('2026-09-14');
    await page.getByRole('button', { name: 'Preview blocked dates', exact: true }).click();
    await page.getByRole('button', { name: /Blocked.*Unsaved preview/ }).waitFor();
    await screenshot('vehicle-block-preview');

    await surface('Main calendar').click();
    await page.getByLabel('Search timeline', { exact: true }).fill('no-such-fixture');
    assert.equal(await page.locator('.tl-booking').count(), 0);
    await page.getByText('No bookings match these filters', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    for (const state of ['empty', 'loading', 'error', 'ready']) {
      await page.getByLabel('Preview state').selectOption(state);
      if (state !== 'ready') await screenshot(`state-${state}`);
    }
    await page.getByLabel('Preview state').selectOption('dense');
    await perspectives.getByRole('button', { name: 'Vehicle', exact: true }).click();
    const dense = page.locator('[data-row-id="fixture-vehicle-a"]');
    const shortPositions = await dense.locator('[data-booking-id^="fixture-short"]').evaluateAll(nodes => nodes.map(el => ({ top: el.style.top, width: el.getBoundingClientRect().width })));
    assert.equal(shortPositions.length, 2);
    assert.notEqual(shortPositions[0].top, shortPositions[1].top, 'Adjacent short rentals must have independent hit targets');
    assert.ok(shortPositions.every(p => p.width < 4), 'Short periods retain their actual fractional duration');
    await screenshot('main-dense');
    // Header and identities stay fixed while only the shared date area scrolls.
    const identity = page.locator('.tl-identity-heading');
    const beforeScroll = await identity.boundingBox();
    await page.locator('.tl-scroll').evaluate(el => { el.scrollTop = 200; });
    assert.equal(Math.round((await identity.boundingBox()).y), Math.round(beforeScroll.y));
    await page.getByLabel('Preview state').selectOption('ready');
    await perspectives.getByRole('button', { name: 'Rental', exact: true }).click();
    await page.setViewportSize({ width: 1366, height: 900 });
    for (const label of ['Week', '2 weeks']) {
      await page.getByRole('group', { name: 'Date window' }).getByRole('button', { name: label, exact: true }).click();
      assert.equal(await page.locator('.tl-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await screenshot('main-laptop');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel('Preview state').selectOption('dense');
    for (const name of ['Customer', 'Vehicle']) {
      await surface(name).click();
      const board = page.getByTestId('timeline');
      assert.equal(await board.locator('.tl-date').count(), 7);
      assert.equal(await board.locator('.tl-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${name} narrow week fits`);
      assert.ok(await board.locator('.tl-booking').count() > 10);
      await screenshot(`${name.toLowerCase()}-dense-panel`);
    }
    await page.getByLabel('Preview state').selectOption('ready');
    await surface('Main calendar').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await screenshot('main-mobile');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Mobile page must not overflow');
    await surface('Rental').click();
    await page.getByRole('button', { name: 'Payment Plan & activity', exact: true }).click();
    await page.getByRole('tab', { name: 'Payment Plan', exact: true }).waitFor();
    await screenshot('rental-mobile-panel');
    assert.deepEqual(errors, [], 'Browser runtime errors');
    console.log(`Timeline browser checks passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
