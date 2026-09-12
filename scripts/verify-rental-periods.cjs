/* Rental-only UI cases; isolated development fixtures, never live mutations. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const output = path.resolve('../timeline-review/rental-full-month');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXE || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = process.env.TIMELINE_BASE_URL || 'http://localhost:4002';
    await page.route('**/*', route => !route.request().url().startsWith(base) && !['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.abort() : route.continue());
    await page.goto(`${base}/playground/timeline`, { timeout: 120000 });
    await page.getByRole('navigation', { name: 'Preview surface' }).getByRole('button', { name: 'Rental', exact: true }).click();
    const screenshot = async name => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: false }); };
    const example = page.getByLabel('Rental example');
    const calendar = page.getByTestId('rental-period-calendar');
    const manage = page.getByRole('dialog', { name: 'Rental periods', exact: true });
    const openManage = async () => { await calendar.getByRole('button', { name: 'Manage', exact: true }).click(); await manage.waitFor(); };
    const done = async () => { await manage.getByRole('button', { name: 'Done', exact: true }).click(); await manage.waitFor({ state: 'hidden' }); };
    const addPreview = async end => {
      await manage.getByRole('button', { name: 'Preview manual extension', exact: true }).click();
      await page.getByLabel('New end date', { exact: true }).fill(end);
      await page.getByRole('button', { name: 'Preview extension', exact: true }).click();
      await page.getByRole('heading', { name: /Manual extension/ }).waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.classList.contains('rp-extension-action'));
    };
    const paint = date => calendar.locator(`[data-rental-date="${date}"] .rp-box-fills > span`).first().evaluate(el => getComputedStyle(el).backgroundColor);

    await calendar.waitFor();
    assert.equal(await calendar.locator('[data-rental-date]').count(), 30, 'Show all real dates of the month');
    assert.equal(await calendar.locator('.rp-occupied').count(), 3, 'Only actual rental dates are colored');
    assert.equal(await page.locator('.rp-period-key-item').count(), 0, 'The permanent sidebar does not contain a detailed period list');
    await screenshot('original');
    await calendar.locator('[data-rental-date="2026-09-10"]').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-rental-date')), '2026-09-11');
    await page.getByRole('tooltip').filter({ hasText: 'Original rental' }).waitFor();
    await page.keyboard.press('Escape');

    await openManage();
    await manage.getByRole('button', { name: 'Preview manual extension', exact: true }).click();
    await page.getByLabel('New end date', { exact: true }).fill('2026-09-11');
    await page.getByRole('button', { name: 'Preview extension', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'after the current end date' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await manage.locator('.rp-period-key-item').count(), 1, 'Cancel leaves the original rental unchanged');
    for (const end of ['2026-09-16', '2026-09-20']) await addPreview(end);
    assert.equal(await manage.locator('.rp-period-key-item').count(), 3);
    await screenshot('manage');
    await done();
    assert.equal(await calendar.locator('[data-rental-date]').count(), 30);
    assert.equal(await calendar.locator('.rp-occupied').count(), 11);
    assert.equal(await calendar.locator('.tl-booking, .tl-date-header, svg line').count(), 0);
    const compact = await calendar.evaluate(el => {
      const grid = el.querySelector('.rp-date-boxes');
      const tile = grid.firstElementChild;
      const panel = el.closest('[role="tabpanel"]');
      return { height: tile.getBoundingClientRect().height, gap: parseFloat(getComputedStyle(grid).gap), font: parseFloat(getComputedStyle(tile.querySelector('strong')).fontSize), texts: [...grid.children].map(box => box.innerText.trim()), width: el.getBoundingClientRect().width, panel: panel.getBoundingClientRect().width, heightUsed: grid.getBoundingClientRect().height / panel.clientHeight, fits: grid.scrollWidth <= grid.clientWidth + 1 && panel.scrollHeight <= panel.clientHeight + 1 };
    });
    assert.ok(compact.height >= 42 && compact.gap <= 2 && compact.font <= 18);
    assert.ok(compact.heightUsed > .85, 'Dates fill the available panel height');
    assert.ok(compact.texts.every(text => /^\d{1,2}$/.test(text)), 'Date numbers are the only visible tile text');
    assert.ok(compact.panel - compact.width <= 26 && compact.fits, 'The grid uses the available sidebar width');
    const colors = await Promise.all(['2026-09-10', '2026-09-14', '2026-09-18'].map(paint));
    assert.equal(new Set(colors).size, 3, 'Original and extensions have distinguishable shades');
    // All period accents stay in the existing indigo/violet family, not status hues.
    const accents = await calendar.locator('.rp-box-fills > span').evaluateAll(nodes => nodes.map(el => Number(getComputedStyle(el).getPropertyValue('--rp-tone').trim().split(' ')[0])));
    assert.ok(accents.every(hue => hue >= 235 && hue <= 280));
    await screenshot('two-extensions');
    await page.getByRole('button', { name: 'Toggle preview theme' }).click();
    await screenshot('two-extensions-dark');
    await page.getByRole('button', { name: 'Toggle preview theme' }).click();

    const selected = calendar.locator('[data-rental-date="2026-09-14"]');
    await selected.click();
    await manage.locator('.rp-selected-date').getByText('Extension #1', { exact: true }).waitFor();
    assert.equal(await manage.locator('.rp-source-label').filter({ hasText: 'Unsaved preview' }).count(), 2);
    await screenshot('selected-date');
    await done();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-rental-date') === '2026-09-14');

    await openManage();
    await addPreview('2026-10-03');
    await done();
    assert.equal(await calendar.locator('[data-rental-date]').count(), 31, 'October shows all 31 dates');
    assert.equal(await calendar.locator('.rp-occupied').count(), 3, 'Only the three actual extension dates are colored');
    const octoberShade = await paint('2026-10-02');
    await calendar.getByRole('button', { name: 'Previous rental month' }).click();
    assert.equal(await paint('2026-09-22'), octoberShade, 'A period keeps its shade across months');
    assert.deepEqual(await Promise.all(['2026-09-10', '2026-09-14', '2026-09-18'].map(paint)), colors, 'Adding another period never recolors the existing ones');
    await screenshot('cross-month');
    await openManage();
    await manage.getByRole('button', { name: 'Discard local previews' }).click();
    assert.equal(await manage.locator('.rp-period-key-item').count(), 1);
    await done();
    assert.equal(await calendar.locator('.rp-occupied').count(), 3);

    await example.selectOption('recorded');
    const boundary = calendar.locator('[data-rental-date="2026-09-13"]');
    assert.equal(await boundary.locator('.rp-box-fills > span').count(), 2, 'The recorded midday boundary retains both proportional fills');
    await screenshot('recorded-extensions');
    await boundary.click();
    assert.match(await manage.locator('.rp-selected-date').innerText(), /Original rental.*Extension #1/s);
    assert.equal(await manage.locator('.rp-source-label').filter({ hasText: 'Unsaved preview' }).count(), 0);
    const swatches = await manage.locator('.rp-period-swatch').evaluateAll(nodes => nodes.map(el => getComputedStyle(el, '::after').backgroundColor));
    assert.deepEqual(swatches, await Promise.all(['2026-09-10', '2026-09-14', '2026-09-18'].map(paint)), 'Detail indicators exactly match their period tiles');
    await done();

    await example.selectOption('long');
    assert.equal(await calendar.locator('[data-rental-date]').count(), 31);
    assert.equal(await calendar.locator('.rp-occupied').count(), 3);
    await calendar.getByRole('button', { name: 'Next rental month' }).click();
    assert.equal(await calendar.locator('[data-rental-date]').count(), 30);
    const columns = await calendar.locator('.rp-date-boxes').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await calendar.locator('[data-rental-date]').first().focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-rental-date')), `2026-09-${String(columns + 1).padStart(2, '0')}`, 'Keyboard rows follow the responsive column count');
    await page.keyboard.press('Escape');
    await screenshot('long-rental');
    for (let i = 0; i < 4; i++) await calendar.getByRole('button', { name: 'Next rental month' }).click();
    assert.equal(await calendar.locator('[data-rental-date="2027-01-03"]').count(), 1);
    await screenshot('year-boundary');
    await openManage();
    assert.equal(await manage.locator('[data-extension-date]').getAttribute('data-extension-date'), '2027-01-04');
    await done();

    await example.selectOption('readonly');
    assert.equal(await calendar.locator('[data-rental-date]').count(), 30);
    assert.equal(await calendar.locator('.rp-occupied').count(), 3);
    await openManage();
    assert.equal(await manage.getByRole('button', { name: /extension/i }).count(), 0, 'Read-only access has details but no extension action');
    await done();
    await example.selectOption('unsupported');
    await page.getByText('Manual preview unavailable', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-rental-date]').count(), 0);
    await example.selectOption('original');
    for (const state of ['loading', 'error', 'empty']) {
      await page.getByLabel('Preview state').selectOption(state);
      assert.equal(await page.locator('[data-extension-date]').count(), 0);
      await screenshot(state);
    }
    await page.getByLabel('Preview state').selectOption('ready');
    await example.selectOption('recorded');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Payment Plan & activity', exact: true }).click();
    await calendar.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await calendar.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await screenshot('mobile');
    await openManage();
    await addPreview('2026-09-24');
    assert.equal(await manage.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    await screenshot('mobile-manage');
    await done();
    await page.waitForFunction(() => document.activeElement?.classList.contains('rp-manage-trigger'));
    assert.equal(await calendar.locator('[data-rental-date]').count(), 30);
    assert.equal(await calendar.locator('.rp-occupied').count(), 15);
    await screenshot('mobile-preview');
    assert.deepEqual(errors, []);
    console.log(`Full-month rental calendar checks passed. Screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
