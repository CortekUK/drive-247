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
const temp=await mkdtemp(resolve(tmpdir(),'drive247-trax-offline-'));
const screenshots=resolve(root,'artifacts/trax-phase1');await mkdir(screenshots,{recursive:true});
const tenantId='00000000-0000-4000-8000-000000000001';
const fixture=`
import React from 'react';
export const useTenant=()=>({tenant:{id:'${tenantId}',slug:window.offlineSlug??'northwind'}});
export const useAuthStore=()=>({user:{id:'offline-user'},appUser:{id:'offline-staff',auth_user_id:'offline-user',name:'Offline operator',role:'admin',is_active:true}});
export const useAuth=useAuthStore;
export const useV2=()=>window.offlineV2!==false;
export const useManagerPermissions=()=>({permissions:[]});
export const useTenantBranding=()=>({branding:{accent_color:'#6554c0'}});
export const usePathname=()=>'/rentals';
export const useRouter=()=>({push:(href)=>{window.lastNavigation=href;window.dispatchEvent(new CustomEvent('offline-navigation',{detail:href}));}});
export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'offline-only',user:{id:'offline-user'}}}})},channel:()=>{const c={on:()=>c,subscribe:()=>c};return c;},removeChannel:()=>{}};
export default function Link({children,href,...props}){return React.createElement('a',{href,...props},children);}
`;
const config=loadConfig(resolve(root,'apps/portal/tailwind.config.ts'));
config.content=[resolve(root,'apps/portal/src/components/trax/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/chat/**/*.{ts,tsx}'),resolve(root,'apps/portal/src/components/ui/**/*.{ts,tsx}')];
const css=(await postcss([tailwind(config)]).process((await readFile(resolve(root,'apps/portal/src/global.css'),'utf8'))+'\n'+(await readFile(resolve(root,'apps/portal/src/styles/v2-theme.css'),'utf8')),{from:undefined})).css;
await writeFile(resolve(temp,'style.css'),css);
const mocks=new Set(['@/integrations/supabase/client','@/stores/auth-store','@/contexts/TenantContext','@/hooks/use-manager-permissions','@/hooks/use-tenant-branding','@/lib/v2-context','next/navigation','next/link']);
await build({stdin:{contents:`import React,{useEffect,useRef,useState} from 'react'; import {createRoot} from 'react-dom/client'; import {TraxLauncher} from './apps/portal/src/components/trax/trax-launcher';
const root=createRoot(document.getElementById('root'));
function Harness(){
  const ref=useRef(null);const [navigation,setNavigation]=useState('');
  useEffect(()=>{const show=(event)=>setNavigation(event.detail);window.addEventListener('offline-navigation',show);return()=>window.removeEventListener('offline-navigation',show);},[]);
  const buttonStyle={border:'1px solid #c4b5fd',borderRadius:8,padding:'10px 16px',background:'white',color:'#4c1d95',cursor:'pointer'};
  return React.createElement(React.Fragment,null,
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
    React.createElement(TraxLauncher,{ref}));
}
window.renderOffline=(slug='northwind',v2=true)=>{window.offlineSlug=slug;window.offlineV2=v2;root.render(React.createElement(Harness,{key:slug+v2}));};window.renderOffline();`,resolveDir:root,loader:'tsx'},outfile:resolve(temp,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_SUPABASE_URL':'"https://offline.invalid"'},plugins:[{name:'offline-fixtures',setup(b){
  b.onResolve({filter:/.*/},(args)=>{
    if(mocks.has(args.path))return {path:args.path,namespace:'fixture'};
    if(args.path==='react'||args.path==='react-dom/client'||args.path.startsWith('react/'))return {path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path+'.js')};
    if(args.path.startsWith('@/'))return {path:resolve(root,'apps/portal/src',args.path.slice(2))+(args.path.endsWith('.json')?'':(args.path.includes('/components/')?'.tsx':'.ts'))};
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
await new Promise((resolve)=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  // Use an installed browser with a fresh ephemeral profile. No browser download.
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:!manual,...(executablePath?{executablePath}:{})});
  const page=await browser.newPage({viewport:{width:1366,height:900},reducedMotion:'reduce'});
  let supportRequests=0;
  const errors=[];page.on('pageerror',(error)=>errors.push(error.message));
  await page.route('**/*',async(route)=>{
    if(route.request().url().startsWith('http://127.0.0.1:'))return route.continue();
    if(route.request().url()==='https://offline.invalid/functions/v1/trax-support'){
      if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST'}});
      supportRequests++;
      const response=await handleSupportRequest(new Request(route.request().url(),{method:'POST',headers:route.request().headers(),body:route.request().postData()}),{reads,signingSecret:'offline-browser-signing-only'});
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
  await page.getByRole('button',{name:'Return handover',exact:true}).click();
  await page.getByText('Application guide · Live records not checked',{exact:true}).waitFor();
  assert(await page.getByText('This is application guidance.',{exact:false}).count()>0);
  await page.screenshot({path:resolve(screenshots,'desktop.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Open Rentals',exact:true}).click();
  await page.waitForFunction(()=>window.lastNavigation==='/rentals');
  assert.equal(await page.evaluate(()=>window.lastNavigation),'/rentals');
  await page.getByTestId('navigation-result').filter({hasText:'Navigation verified: /rentals'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();
  await page.getByText('Checking access and application guidance...').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Roman Urdu help',exact:true}).click();
  await page.getByText('check nahi kiya.',{exact:false}).waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(overflow,false);await page.screenshot({path:resolve(screenshots,'mobile.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Close TRAX',exact:true}).click();
  const checkedRequests=supportRequests;
  for(const fixture of ['Non-V2 tenant fixture','V1 layout fixture']){
    await page.getByRole('button',{name:fixture,exact:true}).click();
    await page.getByRole('button',{name:'Ask AI',exact:true}).click();
    await page.keyboard.press('Control+j');
    assert.equal(await page.getByRole('textbox',{name:'Ask TRAX'}).count(),0);
    assert.equal(supportRequests,checkedRequests);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'passed',checks:['Northwind-V2-launcher','V1-excluded','other-tenants-excluded','actual-dialog','English-guidance','server-verified-navigation','Roman-Urdu','mobile-no-horizontal-clipping','no-page-errors'],screenshots}));
  }
}finally{await browser?.close();await new Promise((resolve)=>server.close(resolve));}
