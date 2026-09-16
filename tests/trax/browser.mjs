/** Offline smoke test of the actual TRAX dialog/hook and Phase 1 handler. */
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manual=process.argv.includes('--manual');
const supportMode=process.argv.includes('--support');
const operationalMode=process.argv.includes('--operational');
const financeMode=process.argv.includes('--finance');
const financeFixtures=financeMode?await import('./finance-fixtures.mjs'):null;
const supportFixture=supportMode?(await import('./support-fixtures.mjs')).createMemoryTicketStore():null;
supportFixture?.setAgent(true);
const diagnosticFixtures=operationalMode||financeMode?await import('./operational-fixtures.mjs'):null;
const temp=await mkdtemp(resolve(tmpdir(),'drive247-trax-offline-'));
const screenshots=resolve(root,financeMode?'artifacts/trax-finance':supportMode?'artifacts/trax-support':operationalMode?'artifacts/trax-operations':'artifacts/trax-phase1');await mkdir(screenshots,{recursive:true});
const tenantId='00000000-0000-4000-8000-000000000001';
const fixture=`
import React from 'react';
export const useTenant=()=>({tenant:{id:'${tenantId}',slug:window.offlineSlug??'northwind'}});
export const useAuthStore=()=>({user:{id:'offline-user'},appUser:{id:'offline-staff',auth_user_id:'offline-user',name:'Offline operator',role:'admin',is_active:true}});
export const useAuth=useAuthStore;
export const useV2=()=>window.offlineV2!==false;
export const useManagerPermissions=()=>({permissions:[]});
export const useTenantBranding=()=>({branding:{accent_color:'#6554c0'}});
export const usePathname=()=>'/trax';
export const useSearchParams=()=>new URLSearchParams();
export const useRouter=()=>({push:(href)=>{window.lastNavigation=href;window.dispatchEvent(new CustomEvent('offline-navigation',{detail:href}));}});
export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'offline-only',user:{id:'offline-user'}}}})},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:()=>{}};
export default function Link({children,href,...props}){return React.createElement('a',{href,...props},children);}
`;
const config=loadConfig(resolve(root,'apps/portal/tailwind.config.ts'));
config.content=[resolve(root,'shared/trax-support/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/trax/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/support/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/chat/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/ui/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/ui-v2/**/*.{ts,tsx}')];
const css=(await postcss([tailwind(config)]).process((await readFile(resolve(root,'apps/portal/src/global.css'),'utf8'))+'\n'+(await readFile(resolve(root,'apps/portal/src/styles/v2-theme.css'),'utf8')),{from:undefined})).css;
await writeFile(resolve(temp,'style.css'),css);
const mocks=new Set(['@/integrations/supabase/client','@/stores/auth-store','@/contexts/TenantContext','@/hooks/use-manager-permissions','@/hooks/use-tenant-branding','@/lib/v2-context','next/navigation','next/link']);
await build({stdin:{contents:`import React,{useEffect,useRef,useState} from 'react'; import {createRoot} from 'react-dom/client'; import {TraxLauncher} from './apps/portal/src/components/trax/trax-launcher';
import {TraxSupportProvider} from './apps/portal/src/components/trax/support/trax-support-context';
import {PortalSupport} from './apps/portal/src/components/support/portal-support';
const root=createRoot(document.getElementById('root'));
function Harness(){
  const ref=useRef(null);const [navigation,setNavigation]=useState('');
  useEffect(()=>{const show=(event)=>setNavigation(event.detail);window.addEventListener('offline-navigation',show);return()=>window.removeEventListener('offline-navigation',show);},[]);
  const buttonStyle={border:'1px solid #c4b5fd',borderRadius:8,padding:'10px 16px',background:'white',color:'#4c1d95',cursor:'pointer'};
  return React.createElement(TraxSupportProvider,null,
    React.createElement('main',{style:{padding:24,fontFamily:'system-ui',maxWidth:900,margin:'0 auto'}},
      React.createElement('h1',{style:{fontSize:24,fontWeight:600,marginBottom:12}},'TRAX offline test'),
      React.createElement('p',{style:{marginBottom:12}},'Isolated fixture session. No live accounts, bookings, payments or model providers are connected.'),
      React.createElement('p',{style:{marginBottom:20}},'Navigation is validated by the real support handler and shown below. This harness does not open actual portal pages.'),
      React.createElement('div',{style:{display:'flex',flexWrap:'wrap',gap:8,marginBottom:16}},
        React.createElement('button',{style:buttonStyle,onClick:()=>window.renderOffline('northwind',true)},'Northwind V2 fixture'),
        React.createElement('button',{style:buttonStyle,onClick:()=>window.renderOffline('northwind',false)},'V1 layout fixture'),
        React.createElement('button',{style:buttonStyle,onClick:()=>window.renderOffline('offline-other',true)},'Non-V2 tenant fixture')),
      React.createElement('p',{'data-testid':'fixture-mode',style:{marginBottom:16}},'Current fixture: '+(window.offlineV2===false?'V1 layout':window.offlineSlug==='northwind'?'Northwind V2':'tenant outside V2 rollout')),
      React.createElement('button',{style:buttonStyle,onClick:()=>ref.current?.open()},'Ask AI'),
      React.createElement('p',{role:'status','data-testid':'navigation-result',style:{marginTop:20,overflowWrap:'anywhere'}},navigation?'Navigation verified: '+navigation:'No navigation selected.')),
    React.createElement(TraxLauncher,{ref}),
    /* The portal's Support section, mounted on navigation exactly as /support does. */
    /* Bounded to the viewport, the way the dashboard layout bounds the real route,
       and left below the harness controls so they stay clickable. Inline styles:
       this file is not one of the sources Tailwind compiled classes from. */
    navigation.startsWith('/support')&&React.createElement('section',{'data-testid':'portal-support',style:{position:'fixed',left:16,right:16,top:330,bottom:16,zIndex:20,display:'flex',flexDirection:'column',overflow:'hidden',borderRadius:12,border:'1px solid rgba(0,0,0,0.08)',background:'white',padding:12}},
      React.createElement(PortalSupport,{
        initialTicketId:new URL(navigation,'http://offline.invalid').searchParams.get('ticket')||undefined,
        composeIssueId:new URL(navigation,'http://offline.invalid').searchParams.get('issue')||undefined})));
}
window.renderOffline=(slug='northwind',v2=true)=>{window.offlineSlug=slug;window.offlineV2=v2;root.render(React.createElement(Harness,{key:slug+v2}));};window.renderOffline();`,resolveDir:root,loader:'tsx'},outfile:resolve(temp,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://offline.invalid"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"fixture"'},plugins:[{name:'offline-fixtures',setup(b){
  b.onResolve({filter:/.*/},(args)=>{
    if(mocks.has(args.path))return {path:args.path,namespace:'fixture'};
    if(args.path==='react'||args.path==='react-dom/client'||args.path.startsWith('react/'))return {path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path+'.js')};
    if(args.path.startsWith('@/'))return {path:resolve(root,'apps/portal/src',args.path.slice(2))+(args.path.endsWith('.json')?'':(args.path.includes('/components/')?'.tsx':'.ts'))};
  });
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'jsx',resolveDir:root}));
}}],logLevel:'silent'});
await build({entryPoints:[resolve(root,'supabase/functions/trax-support/support/handler.ts')],outfile:resolve(temp,'handler.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {handleSupportRequest}=await import(pathToFileURL(resolve(temp,'handler.mjs')).href);
const reads={authenticate:async()=>({id:'offline-user'}),staff:async()=>({id:'offline-staff',auth_user_id:'offline-user',tenant_id:tenantId,role:'admin',is_active:true,is_super_admin:false}),tenant:async()=>({id:tenantId,slug:'northwind',status:'active'}),permissions:async()=>[],entity:async(kind,id)=>diagnosticFixtures&&((kind==='vehicle'&&id===diagnosticFixtures.vehicle)||(kind==='rental'&&id===diagnosticFixtures.rental))?{id,tenant_id:tenantId}:null};
const server=createServer(async(req,res)=>{
  const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
  res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');
  res.end(file?await readFile(resolve(temp,file)):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="v2-theme"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  // Use an installed browser with a fresh ephemeral profile. No browser download.
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:!manual,...(executablePath?{executablePath}:{})});
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(12_000);
  let supportRequests=0;
  const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.route('**/*',async(route)=>{
    if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();
    if(route.request().url()==='https://offline.invalid/functions/v1/trax-support'){
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'}});
      supportRequests++;
      if(diagnosticFixtures&&JSON.parse(route.request().postData()).type==='recheck')diagnosticFixtures.simulateCompletedReturn();
      const response=await handleSupportRequest(new Request(route.request().url(),{method:'POST',headers:route.request().headers(),body:route.request().postData()}),{reads,signingSecret:'offline-browser-signing-only',...(supportFixture?{store:supportFixture.store}:{}),...(diagnosticFixtures?{model:diagnosticFixtures.model,operational:diagnosticFixtures.operational,clock:diagnosticFixtures.clock,now:()=>Date.parse('2026-09-14T12:00:00Z')}:{}),...(financeFixtures?{model:financeFixtures.model,finance:financeFixtures.finance}:{})});
      return route.fulfill({status:response.status,body:await response.text(),headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
    return route.abort(); // No live provider, database, font or analytics traffic.
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if(manual){
    console.log('TRAX manual test is open in an isolated browser. Click Ask AI. Keep this terminal and browser open; network interception runs here. Close the browser or press Ctrl+C to finish. No credentials or live records are used.');
    await new Promise((resolve)=>{
      const finish=()=>resolve();
      const stop=()=>{void browser.close();};
      browser.once('disconnected',finish);
      process.once('SIGINT',stop);
      browser.once('disconnected',()=>process.removeListener('SIGINT',stop));
    });
  }else{
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();
  await page.getByText('Checking access and application guidance...').waitFor({state:'hidden'});
  if(financeMode){
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('Please investigate the payment for rental DEMO-104.');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
    await page.getByText('no ticket was created',{exact:false}).waitFor();
    await page.getByText('USD 50.00 refunded',{exact:false}).first().waitFor();
    await page.getByText('Drive247 and Stripe disagree',{exact:false}).first().waitFor();
    // The only external links are the server-built, hook-validated Stripe destinations for this payment.
    const stripeLink=page.getByRole('link',{name:'Open in Stripe'}).first();
    assert.equal(await stripeLink.getAttribute('href'),'https://dashboard.stripe.com/test/payments/pi_offline');
    assert.equal(await stripeLink.getAttribute('target'),'_blank');
    assert.equal(await stripeLink.getAttribute('rel'),'noopener noreferrer');
    assert.equal(await page.getByRole('link',{name:'View receipt'}).first().getAttribute('href'),'https://pay.stripe.com/receipts/payment/offline');
    assert.equal(await page.getByLabel('Current support issue').count(),0); // The issue selector is gone.
    assert.equal(await page.locator('[data-testid="trax-issue-state"]').count(),0);
    await page.screenshot({path:resolve(screenshots,'payment-investigation.png'),fullPage:true,animations:'disabled'});
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('What is my available Stripe balance?');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
    await page.getByText('Available: USD 123.45; GBP 4.00.',{exact:false}).waitFor();
    await page.screenshot({path:resolve(screenshots,'account-balance.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await page.getByText('Available: USD 123.45; GBP 4.00.',{exact:false}).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.screenshot({path:resolve(screenshots,'mobile.png'),fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Close TRAX',exact:true}).click();
  }else if(supportMode){
    // 1 — an issue TRAX cannot resolve becomes a real ticket in the same answer.
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('My payment has not arrived. Please help investigate.');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
    await page.getByRole('button',{name:/^Open support ticket/}).waitFor();
    assert.equal(supportFixture.tickets.size,1);
    const created=[...supportFixture.tickets.values()][0];
    const thread=page.locator('[data-slot="trax-conversation"]');
    assert.match((await thread.innerText()).replace(/\s+/g,' '),new RegExp(`created support ticket #${created.reference}`,'i'));
    // 2 — no support policy state on screen, and no ticket interface inside TRAX.
    const shown=(await thread.innerText()).replace(/\s+/g,' ');
    for(const gone of ['Support level','Investigating this issue','This is resolved','Request human support','Communicate with Support','Contact Support','Nothing has been submitted yet'])assert.ok(!shown.includes(gone),`TRAX still shows "${gone}"`);
    assert.equal(await page.locator('#trax-issue').count(),0);
    assert.equal(await page.getByTestId('trax-issue-state').count(),0);
    assert.equal(await page.getByTestId('support-inbox').count(),0);
    await page.screenshot({path:resolve(screenshots,'escalation-desktop.png'),fullPage:true,animations:'disabled'});

    // 3 — the same issue asked again reuses that ticket rather than opening another.
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('I still need a human agent for this payment.');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
    await page.getByText('already linked to support ticket',{exact:false}).waitFor();
    assert.equal(supportFixture.tickets.size,1);

    // 4 — a failed handoff says so, invents nothing, and the retry creates it once.
    const originalSubmit=supportFixture.store.submit;
    supportFixture.store.submit=async()=>{throw Error('Isolated submission failure');};
    await page.locator('button[aria-label="Clear conversation"]').click();
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('I want to speak to a human agent about a refund.');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
    await page.getByRole('button',{name:'Try creating the ticket again',exact:true}).waitFor();
    assert.equal(supportFixture.tickets.size,1);
    assert.ok(!(await thread.innerText()).includes('TRX-FIXTURE-2'),'a reference was shown for a ticket that was never created');
    await page.screenshot({path:resolve(screenshots,'handoff-failed.png'),fullPage:true,animations:'disabled'});
    supportFixture.store.submit=originalSubmit;
    await page.getByRole('button',{name:'Try creating the ticket again',exact:true}).click();
    await page.getByRole('button',{name:/^Open support ticket/}).waitFor();
    assert.equal(supportFixture.tickets.size,2);
    const second=[...supportFixture.tickets.values()][1];
    await page.screenshot({path:resolve(screenshots,'submitted-conversation.png'),fullPage:true,animations:'disabled'});

    // 5 — the ticket opens in the portal's Support section, not inside TRAX.
    await page.getByRole('button',{name:/^Open support ticket/}).click();
    assert.equal(await page.evaluate(()=>window.lastNavigation??''),`/support?ticket=${second.id}`);
    await page.getByTestId('support-inbox').waitFor();
    assert.equal(await page.getByRole('button',{name:'Close TRAX',exact:true}).isVisible(),false);
    await page.screenshot({path:resolve(screenshots,'support-section.png'),fullPage:true,animations:'disabled'});

    // 6 — TRAX kept its conversation behind the navigation, history included.
    await page.getByRole('button',{name:'Ask AI',exact:true}).click();
    await page.getByRole('button',{name:/^Open support ticket/}).waitFor();
    await page.getByRole('button',{name:'History',exact:true}).click();
    await page.getByLabel('Previous TRAX conversations').getByRole('button').first().click();
    await page.getByRole('textbox',{name:'Ask TRAX'}).waitFor();
    // A reopened conversation still shows its ticket: reference in the answer, button under it.
    await page.getByRole('button',{name:/^Open support ticket/}).waitFor();
    assert.match((await thread.innerText()).replace(/\s+/g,' '),/support ticket #TRX-FIXTURE-/);
    assert.equal(supportFixture.tickets.size,2);
    await page.getByRole('button',{name:'Close TRAX',exact:true}).click();

    // 7 — retention stays with support, in the Support section.
    await page.getByRole('button',{name:'Retention',exact:true}).click();
    await page.getByRole('button',{name:'Save retention periods',exact:true}).click();
    await page.getByRole('button',{name:'Preview cleanup',exact:true}).click();
    await page.getByText('Nothing was deleted.',{exact:false}).waitFor();
    await page.screenshot({path:resolve(screenshots,'retention.png'),fullPage:true,animations:'disabled'});
    await page.keyboard.press('Escape'); // The retention dialog is modal; the page behind it is next.
    await page.getByRole('button',{name:'Preview cleanup',exact:true}).waitFor({state:'hidden'});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.screenshot({path:resolve(screenshots,'mobile.png'),fullPage:true,animations:'disabled'});
    await page.setViewportSize({width:1366,height:900});
  }else{
  if(operationalMode){
    await page.getByRole('textbox',{name:'Ask TRAX'}).fill('The car and keys are back. DEMO-01 is unavailable on the V2 website for September 15 to 18, 2026. The customer browser timezone is America/New_York; no location filter.');
    await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
  } else await page.getByRole('button',{name:'Return handover',exact:true}).click();
  await page.getByText(operationalMode?'AI answer \u00b7 Live records checked':'Prepared guidance fallback \u00b7 Live records not checked',{exact:true}).waitFor();
  if(operationalMode) {
    await page.getByText('Receiving completion is not recorded.',{exact:false}).first().waitFor();
    assert(await page.getByRole('button',{name:'Check Again',exact:true}).count()===1);
  } else assert(await page.getByText('This is application guidance.',{exact:false}).count()>0);
  await page.screenshot({path:resolve(screenshots,'desktop.png'),fullPage:true,animations:'disabled'});
  if(operationalMode){
    await page.getByRole('button',{name:'Check Again',exact:true}).click();
    await page.getByText('A fleet-wide blocked period still applies',{exact:false}).waitFor();
    assert(await page.getByRole('button',{name:'Check Again',exact:true}).count()===1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);
    await page.getByRole('button',{name:'Check Again',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:resolve(screenshots,'mobile.png'),fullPage:true,animations:'disabled'});
    await page.getByRole('button',{name:'Close TRAX',exact:true}).click();
  } else {
  await page.getByRole('button',{name:'Open Rentals',exact:true}).click();
  await page.waitForFunction(()=>window.lastNavigation==='/rentals');
  assert.equal(await page.evaluate(()=>window.lastNavigation),'/rentals');
  await page.getByTestId('navigation-result').filter({hasText:'Navigation verified: /rentals'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();
  await page.getByText('Checking access and application guidance...').waitFor({state:'hidden'});
  // One conversation per session: closing TRAX and reopening keeps the thread.
  await page.getByText('Prepared guidance fallback · Live records not checked',{exact:true}).first().waitFor();
  await page.getByRole('textbox',{name:'Ask TRAX'}).fill('Gaari wapis aaye to return kaise record karein?');
  await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
  await page.getByText('check nahi kiya.',{exact:false}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(overflow,false);await page.screenshot({path:resolve(screenshots,'mobile.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Close TRAX',exact:true}).click();
  }
  }
  const checkedRequests=supportRequests;
  for(const fixture of ['Non-V2 tenant fixture','V1 layout fixture']){
    await page.getByRole('button',{name:fixture,exact:true}).click();
    await page.getByRole('button',{name:'Ask AI',exact:true}).click();
    await page.keyboard.press('Control+j');
    assert.equal(await page.getByRole('textbox',{name:'Ask TRAX'}).count(),0);
    assert.equal(supportRequests,checkedRequests);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',mode:financeMode?'scripted-model-finance-fixtures':supportMode?'offline-support-storage-fixtures':operationalMode?'scripted-model-operational-fixtures':'prepared-guidance-fixtures',checks:financeMode?['actual-dialog-hook-handler','linked-payment-check','refund-discrepancy','multi-currency-account-funds','honest-unconfigured-handoff','no-issue-controls','V1-excluded','mobile-no-clipping']:supportMode?['real-dialog-hook-handler','automatic-ticket-on-escalation','no-score-or-issue-controls','no-ticket-ui-inside-trax','existing-ticket-reused','failed-handoff-invents-nothing','retry-creates-once','ticket-opens-support-section','conversation-kept-behind-navigation','reopened-conversation-keeps-its-ticket','retention-save-and-dry-run','V1-excluded','other-tenants-excluded','mobile-no-horizontal-clipping','no-page-errors']:operationalMode?['real-dialog-hook-handler','scripted-model-tools','unrecorded-return','fresh-recheck-remaining-block','V1-excluded','other-tenants-excluded','mobile-no-horizontal-clipping','no-page-errors']:['Northwind-V2-launcher','V1-excluded','other-tenants-excluded','actual-dialog','English-guidance','server-verified-navigation','conversation-survives-close','Roman-Urdu','mobile-no-horizontal-clipping','no-page-errors'],screenshots}));
  }
}finally{await browser?.close();await new Promise((resolve)=>server.close(resolve));}
