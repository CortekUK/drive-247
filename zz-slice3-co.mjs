import { chromium } from 'playwright';
const url = process.argv[2];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const p = await b.newPage();
const inits = [];
p.on('response', async r => { if (/payment_pages|checkout\/sessions/.test(r.url())) { try { inits.push({u:r.url().slice(0,90), j: await r.json()}); } catch {} } });
await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
const txt = (await p.locator('body').innerText()).replace(/\n+/g,' | ').slice(0, 1200);
console.log('PAGE TEXT:', txt);
for (const i of inits) {
  const j = i.j;
  console.log('--- API', i.u);
  console.log('  amount_total=', j.amount_total, 'currency=', j.currency, 'mode=', j.mode);
  if (j.line_item_group) console.log('  line_items=', JSON.stringify(j.line_item_group).slice(0,900));
  if (j.success_url) console.log('  success_url=', j.success_url);
  if (j.cancel_url) console.log('  cancel_url=', j.cancel_url);
  if (j.metadata) console.log('  metadata=', JSON.stringify(j.metadata));
}
await b.close();
