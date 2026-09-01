import { chromium } from 'playwright';
const url = 'http://localhost:3111/booking/documents/ui-two-step-fixture-9f3a2c';
const SEL = '.mx-auto.w-full.max-w-2xl';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const ctx = await b.newContext({ viewport:{width:390,height:840} });
const p = await ctx.newPage();
p.on('response', r => { if (r.url().includes('functions/v1')||r.url().includes('/storage/v1/object/customer-documents')) console.log('[net]', r.request().method(), r.status(), r.url().slice(38,150)); });
await p.goto(url, { waitUntil:'domcontentloaded' });
try { await p.waitForSelector('text=Your payment has gone through', { timeout:25000 }); }
catch(e){ console.log('DUMP:', await p.evaluate(s=>{const n=document.querySelector(s); return n?n.innerText:'(no container)';}, SEL)); throw e; }

console.log('\n--- headline before ---');
console.log(await p.evaluate(s=>document.querySelector(s).innerText.split('\n').slice(1,4).join(' '), SEL));

// customer chooses step 2 first
await p.locator('button', { hasText: 'Start this step' }).last().click();
await p.waitForTimeout(400);
await p.locator('input[type=file]').setInputFiles('/tmp/policy.pdf');
await p.waitForTimeout(400);
console.log('\n--- tray ---');
console.log(await p.evaluate(s=>document.querySelector(s).innerText, SEL));
await p.locator('button', { hasText: 'Send my document' }).click();
await p.waitForTimeout(6000);
await p.screenshot({ path:'/tmp/docs-after-insurance.png', fullPage:true });
console.log('\n--- after send ---');
console.log(await p.evaluate(s=>document.querySelector(s).innerText, SEL));
console.log('\nhorizontal overflow px:', await p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth));
await b.close();
