/**
 * Offline check that the Trax panel FLOATS over the page instead of docking beside it.
 *
 * It mounts the real TraxPanel, the real providers and the real conversation hook over a
 * stand-in dashboard (sidebar + top bar + wide, tall main), with the support handler
 * answering locally. Nothing live is contacted: no account, booking, payment or model.
 *
 * What it proves: opening, expanding, restoring and closing Trax never changes the page's
 * width, never introduces horizontal overflow, never moves the scroll position, never locks
 * the page and never puts a backdrop over it; the panel sits in the bottom-right corner at a
 * readable size, becomes a near-full-screen overlay on a phone with its composer above the
 * fold, and keeps both the conversation and an unsent draft when it closes.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manual=process.argv.includes('--manual');
const temp=await mkdtemp(resolve(tmpdir(),'drive247-trax-panel-'));
const screenshots=resolve(root,'artifacts/trax-panel');await mkdir(screenshots,{recursive:true});
const tenantId='00000000-0000-4000-8000-000000000001';
const fixture=`
import React from 'react';
export const useTenant=()=>({tenant:{id:'${tenantId}',slug:'northwind'}});
export const useAuthStore=()=>({user:{id:'offline-user'},appUser:{id:'offline-staff',auth_user_id:'offline-user',name:'Offline operator',role:'admin',is_active:true}});
export const useAuth=useAuthStore;
export const useV2=()=>true;
export const useManagerPermissions=()=>({permissions:[]});
export const useTenantBranding=()=>({branding:{accent_color:'#6554c0'}});
export const usePathname=()=>'/rentals';
export const useSearchParams=()=>new URLSearchParams();
export const useRouter=()=>({push:(href)=>{window.lastNavigation=href;}});
export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'offline-only',user:{id:'offline-user'}}}})},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:()=>{}};
export default function Link({children,href,...props}){return React.createElement('a',{href,...props},children);}
`;
const config=loadConfig(resolve(root,'apps/portal/tailwind.config.ts'));
config.content=[resolve(root,'shared/trax-support/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/trax/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/chat/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/ui/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/ui-v2/**/*.{ts,tsx}')];
const css=(await postcss([tailwind(config)]).process((await readFile(resolve(root,'apps/portal/src/global.css'),'utf8'))+'\n'+(await readFile(resolve(root,'apps/portal/src/styles/v2-theme.css'),'utf8')),{from:undefined})).css;
await writeFile(resolve(temp,'style.css'),css);
const mocks=new Set(['@/integrations/supabase/client','@/stores/auth-store','@/contexts/TenantContext','@/hooks/use-manager-permissions','@/hooks/use-tenant-branding','@/lib/v2-context','next/navigation','next/link']);
await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client';
import {TraxPanel} from './apps/portal/src/components/trax/trax-panel';
import {TraxV2Provider} from './apps/portal/src/components/trax/support/trax-support-context';
import {useTrax} from './apps/portal/src/components/trax/trax-provider';
import {TooltipProvider} from './apps/portal/src/components/ui-v2/tooltip';
/* A stand-in for the dashboard layout: the same shape the real one has — a fixed-width
   sidebar and a min-w-0 content column in one flex row — so anything that took width from
   the page would show up here exactly as it would in the portal. */
function Page(){
  const {openSheet}=useTrax();
  return React.createElement('div',{className:'flex min-h-svh bg-background bg-app-gradient'},
    React.createElement('aside',{'data-testid':'sidebar',className:'hidden w-60 shrink-0 border-r border-border/60 p-4 md:block'},'Sidebar'),
    React.createElement('div',{'data-testid':'inset',className:'flex min-w-0 flex-1 flex-col'},
      React.createElement('header',{'data-testid':'top-bar',className:'sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between bg-background/80 px-4 backdrop-blur'},
        React.createElement('span',{className:'text-sm font-semibold'},'Rentals'),
        React.createElement('button',{'data-testid':'open-trax',className:'rounded-lg border border-border px-3 py-1.5 text-sm',onClick:openSheet},'Trax AI')),
      React.createElement('main',{'data-testid':'page',className:'flex min-w-0 flex-1 flex-col gap-4 p-4'},
        React.createElement('div',{'data-testid':'record',className:'rounded-xl border border-border bg-card p-4 text-sm'},'A rental record wide enough to notice if the page were narrowed.'),
        React.createElement('div',{style:{height:2400}},'Tall page content, so the scroll position can be compared.'))));
}
createRoot(document.getElementById('root')).render(
  React.createElement(TooltipProvider,null,
    React.createElement(TraxV2Provider,null,React.createElement(Page),React.createElement(TraxPanel))));`,
  resolveDir:root,loader:'tsx'},outfile:resolve(temp,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://offline.invalid"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"fixture"'},
  plugins:[{name:'offline-fixtures',setup(b){
    b.onResolve({filter:/.*/},(args)=>{
      if(mocks.has(args.path))return {path:args.path,namespace:'fixture'};
      if(args.path==='react'||args.path==='react-dom'||args.path==='react-dom/client'||args.path.startsWith('react/'))return {path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom'?'react-dom/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path+'.js')};
      if(args.path.startsWith('@/')){/* `@/x` as the portal resolves it: the file as named, or its .ts/.tsx/index. */const base=resolve(root,'apps/portal/src',args.path.slice(2));const found=[base+'.ts',base+'.tsx',resolve(base,'index.ts'),resolve(base,'index.tsx'),base].find(c=>existsSync(c)&&!c.endsWith(args.path.slice(2)+'/'));return {path:args.path.endsWith('.json')?base:found??base+(args.path.includes('/components/')?'.tsx':'.ts')};}
    });
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'jsx',resolveDir:root}));
  }}],logLevel:'silent'});
await build({entryPoints:[resolve(root,'supabase/functions/trax-support/support/handler.ts')],outfile:resolve(temp,'handler.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {handleSupportRequest}=await import(pathToFileURL(resolve(temp,'handler.mjs')).href);
const reads={authenticate:async()=>({id:'offline-user'}),staff:async()=>({id:'offline-staff',auth_user_id:'offline-user',tenant_id:tenantId,role:'admin',is_active:true,is_super_admin:false}),tenant:async()=>({id:tenantId,slug:'northwind',status:'active'}),permissions:async()=>[],entity:async()=>null};
const server=createServer(async(req,res)=>{
  const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
  res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');
  res.end(file?await readFile(resolve(temp,file)):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="v2-theme"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((done)=>server.listen(0,'127.0.0.1',done));

/** Everything a "did the page move?" comparison needs, read from the live document. */
const measure=(page)=>page.evaluate(()=>{
  const main=document.querySelector('[data-testid="page"]').getBoundingClientRect();
  const inset=document.querySelector('[data-testid="inset"]').getBoundingClientRect();
  const aside=document.querySelector('[data-slot="trax-panel"]');
  const panel=aside?.getBoundingClientRect();
  const style=aside?getComputedStyle(aside):null;
  return {
    mainWidth:Math.round(main.width),mainLeft:Math.round(main.left),insetWidth:Math.round(inset.width),
    documentWidth:document.documentElement.scrollWidth,viewportWidth:window.innerWidth,
    scrollY:Math.round(window.scrollY),
    bodyOverflow:getComputedStyle(document.body).overflow,htmlOverflow:getComputedStyle(document.documentElement).overflow,
    state:aside?.getAttribute('data-state')??null,size:aside?.getAttribute('data-size')??null,
    position:style?.position??null,
    panel:panel?{width:Math.round(panel.width),height:Math.round(panel.height),right:Math.round(window.innerWidth-panel.right),bottom:Math.round(window.innerHeight-panel.bottom),top:Math.round(panel.top)}:null,
    scrim:!!document.querySelector('[data-slot="trax-scrim"]'),
    portalledToBody:aside?.parentElement===document.body,
    gap:!!document.querySelector('[data-slot="trax-gap"]'),
    offset:getComputedStyle(document.documentElement).getPropertyValue('--trax-offset').trim(),
  };
});
const sameLayout=(before,after,what)=>{
  assert.equal(after.mainWidth,before.mainWidth,`${what}: the page column changed width`);
  assert.equal(after.mainLeft,before.mainLeft,`${what}: the page moved sideways`);
  assert.equal(after.insetWidth,before.insetWidth,`${what}: the content area changed width`);
  assert.equal(after.scrollY,before.scrollY,`${what}: the page jumped`);
  assert.ok(after.documentWidth<=after.viewportWidth,`${what}: horizontal overflow (${after.documentWidth} > ${after.viewportWidth})`);
};

let browser;
try{
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:!manual,...(executablePath?{executablePath}:{})});
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  page.setDefaultTimeout(12_000);
  const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
  await page.route('**/*',async(route)=>{
    const url=route.request().url();
    if(url.startsWith('http://127.0.0.1:'))return route.continue();
    if(url==='https://offline.invalid/functions/v1/trax-support'){
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'}});
      const response=await handleSupportRequest(new Request(url,{method:'POST',headers:route.request().headers(),body:route.request().postData()}),{reads,signingSecret:'offline-browser-signing-only'});
      return route.fulfill({status:response.status,body:await response.text(),headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}});
    }
    return route.abort(); // No live provider, database, font or analytics traffic.
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('record').waitFor();
  await page.evaluate(()=>window.scrollTo(0,400));
  const closed=await measure(page);
  assert.equal(closed.gap,false,'a flow gap exists while Trax is closed');

  if(manual){
    console.log('Trax floating-panel fixture is open. Click Trax AI. Close the browser or press Ctrl+C to finish.');
    await new Promise((done)=>{const stop=()=>{void browser.close();};browser.once('disconnected',done);process.once('SIGINT',stop);browser.once('disconnected',()=>process.removeListener('SIGINT',stop));});
  }else{
  // 1 — opening floats over the page and leaves it exactly where it was.
  await page.getByTestId('open-trax').click();
  await page.locator('[data-slot="trax-panel"][data-state="open"]').waitFor();
  await page.getByRole('textbox',{name:'Ask TRAX'}).waitFor();
  const open=await measure(page);
  sameLayout(closed,open,'opening Trax');
  assert.equal(open.gap,false,'opening Trax reserved a column');
  assert.equal(open.portalledToBody,true,'the panel is not on the overlay layer');
  assert.equal(open.position,'fixed','the panel is not pinned to the viewport');
  assert.equal(open.scrim,false,'a backdrop was drawn over the page');
  assert.equal(open.bodyOverflow,closed.bodyOverflow,'the page scroll was locked');
  assert.equal(open.htmlOverflow,closed.htmlOverflow,'the page scroll was locked');
  assert.ok(open.panel.width>=380&&open.panel.width<=520,`panel width ${open.panel.width}px is outside the readable range`);
  assert.ok(open.panel.right>=12&&open.panel.bottom>=12,`panel sits too close to the viewport edge: ${JSON.stringify(open.panel)}`);
  assert.ok(open.panel.top>=12&&open.panel.height<=900-24,`panel does not fit the viewport: ${JSON.stringify(open.panel)}`);
  assert.ok(open.offset.length>0,'--trax-offset is unset while the panel is open');
  // The page underneath is still live: it scrolls, and it takes clicks beside the panel.
  await page.mouse.wheel(0,200);
  await page.waitForFunction((y)=>Math.round(window.scrollY)>y,open.scrollY);
  await page.evaluate((y)=>window.scrollTo(0,y),open.scrollY);
  assert.equal(await page.evaluate(()=>document.elementFromPoint(320,420)?.closest('[data-testid="page"]')!==null),true,'the page is not reachable beside the panel');
  await page.screenshot({path:resolve(screenshots,'floating-desktop.png'),fullPage:false,animations:'disabled'});

  // 1b — hover, focus and pressed states use the sidebar's highlight, never white.
  /* The sidebar's highlight, resolved from the theme's own --primary (what
     `bg-primary/10` compiles to), so this checks the token, not a copied colour. */
  const highlightOf=async(page)=>page.evaluate(()=>{const probe=document.createElement('div');probe.style.backgroundColor='hsl(var(--primary) / 0.1)';probe.style.color='hsl(var(--primary))';document.body.append(probe);const cs=getComputedStyle(probe);const out={bg:cs.backgroundColor,fg:cs.color};probe.remove();return out;});
  const paintOf=(locator)=>locator.evaluate((el)=>{const cs=getComputedStyle(el);const svg=el.querySelector('svg');return {bg:cs.backgroundColor,fg:cs.color,icon:svg?getComputedStyle(svg).color:null};});
  const isWhite=(bg)=>/^rgba?\(255, 255, 255(, 1)?\)$/.test(bg)||/^rgb\(24[0-9], 24[0-9], 24[0-9]\)$/.test(bg)||/^rgb\(25[0-5], 25[0-5], 25[0-5]\)$/.test(bg);
  const hoverPaint=async(page,locator)=>{await locator.hover();await page.waitForTimeout(220);const p=await paintOf(locator);await page.mouse.move(2,2);await page.waitForTimeout(120);return p;};
  const highlight=await highlightOf(page);
  const panelEl=page.locator('[data-slot="trax-panel"]');
  for(const name of ['Conversation history','Open Support','Expand panel','Close Trax']){
    const button=panelEl.getByRole('button',{name,exact:true});
    const painted=await hoverPaint(page,button);
    assert.equal(painted.bg,highlight.bg,`${name} hovers ${painted.bg}, not the sidebar highlight`);
    assert.equal(painted.fg,highlight.fg,`${name}'s hover text is not the highlight colour`);
    assert.equal(painted.icon,highlight.fg,`${name}'s hover icon is not the highlight colour`);
    assert.equal(isWhite(painted.bg),false,`${name} hovers white`);
  }
  await panelEl.getByRole('button',{name:'Conversation history',exact:true}).hover();
  await page.screenshot({path:resolve(screenshots,'header-hover.png'),clip:await panelEl.boundingBox().then(b=>({x:b.x,y:b.y,width:b.width,height:140})),animations:'disabled'});
  await page.mouse.move(2,2);
  // Keyboard focus reads the same.
  await panelEl.getByRole('button',{name:'Open Support',exact:true}).focus();
  await page.keyboard.press('Tab');
  await page.waitForTimeout(250); // the button's own colour transition
  const focused=await page.evaluate(()=>({label:document.activeElement?.getAttribute('aria-label'),visible:document.activeElement?.matches(':focus-visible'),bg:getComputedStyle(document.activeElement).backgroundColor}));
  assert.equal(focused.label,'Expand panel',`Tab moved focus to ${focused.label}`);
  assert.equal(focused.visible,true,'keyboard focus is not :focus-visible');
  assert.equal(focused.bg,highlight.bg,'keyboard focus is not the highlight');
  await page.mouse.move(2,2);
  // Pressed: History open keeps its button highlighted, and the history rows hover the same way.
  await panelEl.getByRole('button',{name:'Conversation history',exact:true}).click();
  await panelEl.getByLabel('Previous TRAX conversations').waitFor();
  await page.mouse.move(2,2);await page.waitForTimeout(300);
  const pressed=await paintOf(panelEl.getByRole('button',{name:'Conversation history',exact:true}));
  assert.equal(pressed.bg,highlight.bg,'History open is not shown with the highlight');
  const back=panelEl.getByRole('button',{name:'Back to conversation',exact:true});
  assert.equal((await hoverPaint(page,back)).bg,highlight.bg,'Back to conversation hovers off-system');
  const historyRow=panelEl.getByLabel('Previous TRAX conversations').getByRole('button').first();
  if(await historyRow.count())assert.equal((await hoverPaint(page,historyRow)).bg,highlight.bg,'a history row hovers off-system');
  await back.click();
  await page.getByRole('textbox',{name:'Ask TRAX'}).waitFor();
  // Suggestions and the composer's "+".
  const chip=panelEl.getByRole('button',{name:'Vehicles out now'});
  assert.ok(await chip.count(),'the suggestion to check is not in the panel');
  if(await chip.count()){const c=await hoverPaint(page,chip);assert.equal(c.bg,highlight.bg,'a suggestion hovers off-system');}
  const attach=panelEl.getByRole('button',{name:/^Attach files$/});
  if(await attach.count()&&!(await attach.getAttribute('aria-disabled')))assert.equal((await hoverPaint(page,attach)).bg,highlight.bg,'the composer + hovers off-system');

  // 2 — a conversation, so what follows can prove it survives.
  await page.getByRole('textbox',{name:'Ask TRAX'}).fill('How do I record returned keys?');
  await page.getByRole('textbox',{name:'Ask TRAX'}).press('Enter');
  await page.getByText('Prepared guidance fallback \u00b7 Live records not checked',{exact:true}).first().waitFor();
  const answered=await measure(page);
  sameLayout(open,answered,'answering in Trax');

  // 3 — expand and restore, both over the same unchanged page.
  await page.getByRole('button',{name:'Expand panel',exact:true}).click();
  await page.locator('[data-slot="trax-panel"][data-size="expanded"]').waitFor();
  const expanded=await measure(page);
  sameLayout(answered,expanded,'expanding Trax');
  assert.ok(expanded.panel.width>open.panel.width,'Expand did not make the panel bigger');
  assert.ok(expanded.panel.right>=12&&expanded.panel.bottom>=12,'the expanded panel touches the viewport edge');
  assert.equal(expanded.scrim,true,'the expanded overlay has no focus scrim');
  await page.screenshot({path:resolve(screenshots,'expanded-desktop.png'),fullPage:false,animations:'disabled'});
  await page.getByRole('button',{name:'Restore panel size',exact:true}).click();
  await page.locator('[data-slot="trax-panel"][data-size="floating"]').waitFor();
  const restored=await measure(page);
  sameLayout(expanded,restored,'restoring Trax');
  assert.equal(restored.panel.width,open.panel.width,'restoring did not return to the floating size');
  assert.equal(restored.scrim,false,'the scrim outlived the expanded overlay');
  assert.equal(await page.evaluate(()=>window.lastNavigation??''),'','expanding or restoring navigated away');

  // 4 — closing keeps the conversation and an unsent draft; only New conversation clears it.
  await page.getByRole('textbox',{name:'Ask TRAX'}).fill('A question I have not sent yet');
  await page.getByRole('button',{name:'Close Trax',exact:true}).click();
  // A closed panel is `invisible` by design, so wait on the attribute, not visibility.
  await page.waitForFunction(()=>document.querySelector('[data-slot="trax-panel"]')?.getAttribute('data-state')==='closed');
  const shut=await measure(page);
  sameLayout(restored,shut,'closing Trax');
  await page.getByTestId('open-trax').click();
  await page.locator('[data-slot="trax-panel"][data-state="open"]').waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Ask TRAX'}).inputValue(),'A question I have not sent yet','the unsent draft was lost');
  assert.ok((await page.locator('[data-slot="trax-support-thread"]').innerText()).includes('How do I record returned keys?'),'the conversation was lost');

  // 5 — a phone: a near-full-screen overlay with the composer above the fold.
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(300);
  const phone=await measure(page);
  assert.ok(phone.documentWidth<=phone.viewportWidth,'horizontal overflow on a phone');
  assert.ok(phone.panel.width>=330&&phone.panel.height>=700,`the phone overlay is too small: ${JSON.stringify(phone.panel)}`);
  const composer=await page.getByRole('textbox',{name:'Ask TRAX'}).boundingBox();
  assert.ok(composer.y+composer.height<=844,'the composer is below the fold on a phone');
  assert.ok(await page.getByRole('button',{name:'Close Trax',exact:true}).isVisible(),'the controls are not reachable on a phone');
  await page.screenshot({path:resolve(screenshots,'floating-mobile.png'),fullPage:false,animations:'disabled'});

  assert.deepEqual(errors,[],'page errors: '+errors.join(' || '));
  console.log(JSON.stringify({status:'passed',mode:'floating-panel-layout',checks:['no-flow-gap','portalled-overlay-layer','page-width-unchanged','no-horizontal-overflow','no-scroll-jump','no-backdrop-or-scroll-lock','header-hover-focus-pressed-use-sidebar-highlight','history-and-suggestions-use-sidebar-highlight','page-usable-beside-panel','readable-corner-size','expand-and-restore','conversation-and-draft-kept','phone-overlay','no-page-errors'],screenshots}));
  }
}finally{
  await browser?.close();
  server.close();
}
