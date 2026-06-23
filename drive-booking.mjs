import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

async function shot(url, name) {
  console.log(`\n=== ${url} ===`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  } catch (e) { console.log('goto warn:', e.message); }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: false });
  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 600);
  console.log('title:', title);
  console.log('visible text (first 600):\n', bodyText.replace(/\n{2,}/g,'\n'));
  console.log('screenshot:', `/tmp/${name}.png`);
}

await shot('http://localhost:3000/', 'ob-home');
await shot('http://localhost:3000/booking', 'ob-booking');

console.log('\n=== JS errors captured ===');
console.log(errors.length ? errors.slice(0,15).join('\n') : 'NONE');
await browser.close();
