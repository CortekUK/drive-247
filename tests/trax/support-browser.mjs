/**
 * Offline check of the portal's Support section: the real PortalSupport, the real
 * inbox hook and the real v2 components over a scripted in-memory messaging API.
 * No account, database, email or model provider is contacted.
 *
 * What it proves about the redesign: one page header, a ~320px ticket list beside a
 * conversation, both scrolling inside a viewport-height workspace with the header and
 * the composer always on screen; content-sized bubbles (tenant right, support left)
 * that wrap long text and references; date separators and grouped turns; the server's
 * own unread flag and status; an empty filter result; a failed send that keeps the
 * draft and offers Retry; reading older messages without being pulled to the bottom;
 * and a narrow screen that switches between list and conversation with Back.
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

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const manual=process.argv.includes('--manual');
const temp=await mkdtemp(resolve(tmpdir(),'drive247-support-'));
const screenshots=resolve(root,'artifacts/trax-support-ui');await mkdir(screenshots,{recursive:true});

/* The fixture API. It answers the same actions as trax-messaging with the same shapes,
   in memory, so the component under test is the real one and nothing is stubbed inside it. */
const fixture=`
import React from 'react';
const now=Date.now();
const iso=(minutes)=>new Date(now-minutes*60000).toISOString();
const long='This vehicle was returned on Tuesday afternoon and the customer confirmed the handover in person, but the rental still shows as active in the dashboard and the deposit has not been released, so the same car cannot be booked again for the weekend. Reference RENT-2026-000148-EXTENDED-CONTRACT-ADDENDUM.';
const tickets=[
  {id:'t1',reference:'TRX-11AA22BB33CC',summary:'Returned vehicle still shows as out on rent, and the deposit has not been released to the customer',status:'open',tenant_name:'Northwind',requester:'Offline operator',updated_at:iso(3),created_at:iso(1500),unread:true,
   handoff:{disclosure:'Historical observations; recheck current records before acting.',issue:{reason:'evidence_conflict'},verifiedChecks:[{observedAt:'2026-09-16 09:10',findings:['Rental DEMO-104 is still open.','No return handover is recorded.']}],recordReferences:[{kind:'rental',id:'DEMO-104'}]},
   messages:[
     {seq:1,author_kind:'tenant',body:'The customer returned the keys on Tuesday but the rental is still open.',created_at:iso(1500)},
     {seq:2,author_kind:'support',body:'Thanks — we can see the rental is still open on our side too. Could you confirm which branch received the keys?',created_at:iso(1440)},
     {seq:3,author_kind:'tenant',body:'Manchester.',created_at:iso(1438)},
     {seq:4,author_kind:'tenant',body:long,created_at:iso(1437)},
     {seq:5,author_kind:'support',body:'Understood. We have asked the operations team to review the handover record.',created_at:iso(5)},
     {seq:6,author_kind:'support',body:'One more thing: please do not close the rental manually while this is open.',created_at:iso(4)},
   ]},
  {id:'t2',reference:'TRX-44DD55EE66FF',summary:'Invoice email did not reach the customer',status:'in_progress',tenant_name:'Northwind',requester:'Offline operator',updated_at:iso(2880),created_at:iso(4300),unread:false,
   messages:[{seq:1,author_kind:'tenant',body:'The invoice email bounced.',created_at:iso(4300)},{seq:2,author_kind:'support',body:'We resent it this morning.',created_at:iso(2880)}]},
  {id:'t3',reference:'TRX-77GG88HH99II',summary:'Website booking widget showed the wrong price',status:'closed',tenant_name:'Northwind',requester:'Offline operator',updated_at:iso(20000),created_at:iso(21000),unread:false,
   messages:[{seq:1,author_kind:'tenant',body:'The widget showed £39 instead of £59.',created_at:iso(21000)},{seq:2,author_kind:'support',body:'Fixed in the pricing rule.',created_at:iso(20000)}]},
];
window.failNextSend=false;window.failNextAttach=false;
/* Reserved uploads, and the bytes the browser sent for them. A message claims the
   uploads reserved under its own nonce, the way the SQL does. */
const reserved=[],uploads=new Map();
const claim=(ticket,nonce,seq)=>{for(const file of reserved)if(file.nonce===nonce&&!file.seq){file.seq=seq;file.ticketId=ticket.id;}};
const call=async(action,data={})=>{
  await new Promise(r=>setTimeout(r,10));
  if(action==='count')return {unread:tickets.filter(t=>t.unread).length};
  if(action==='list'){
    const q=String(data.search??'').toLowerCase();
    const found=tickets.filter(t=>(!data.status||t.status===data.status)&&(!q||(t.summary+' '+t.reference).toLowerCase().includes(q)));
    return {tickets:found.map(({messages,handoff,...rest})=>rest),nextOffset:null,unread:tickets.filter(t=>t.unread).length};
  }
  if(action==='detail'){
    const t=tickets.find(x=>x.id===data.id);if(!t)throw Error('Ticket not found.');
    const {messages,...ticket}=t;
    /* The server returns the conversation's files with a short-lived read URL each;
       the fixture hands back the uploaded bytes as a data URL so the image renders. */
    const files=reserved.filter(f=>f.ticketId===t.id&&f.seq).map(f=>({id:f.id,seq:f.seq,name:f.name,mime:f.mime,size:f.size,authorKind:'tenant',url:uploads.get(f.path)}));
    return {ticket,messages,hasOlder:false,latestSeq:messages.length,attachments:files};
  }
  if(action==='read'){const t=tickets.find(x=>x.id===data.id);if(t)t.unread=false;return {readThrough:data.through};}
  if(action==='attach'){
    if(window.failNextAttach){window.failNextAttach=false;throw Error('The attachment could not be reserved. Your message has not been sent.');}
    const path='fixture/'+(data.id??'new')+'/'+String(reserved.length+1);
    reserved.push({id:'a'+(reserved.length+1),path,ticketId:data.id??null,nonce:data.nonce,name:data.name,mime:data.mime,size:data.size});
    return {attachment:{id:'a'+reserved.length,path,name:data.name,mime:data.mime,size:data.size},upload:{url:'fixture://'+path,token:'token'}};
  }
  if(action==='send'){
    if(window.failNextSend){window.failNextSend=false;throw Error('Fixture connection interrupted. Your draft is preserved for retry.');}
    const t=tickets.find(x=>x.id===data.id);t.messages.push({seq:t.messages.length+1,author_kind:'tenant',body:data.body,created_at:new Date().toISOString()});t.updated_at=new Date().toISOString();
    claim(t,data.nonce,t.messages.length);
    return {seq:t.messages.length};
  }
  if(action==='create'){
    const t={id:'t'+(tickets.length+1),reference:'TRX-NEWFIXTURE000',summary:data.subject,status:'open',tenant_name:'Northwind',requester:'Offline operator',updated_at:new Date().toISOString(),created_at:new Date().toISOString(),unread:false,
      messages:[{seq:1,author_kind:'tenant',body:data.body,created_at:new Date().toISOString()}]};
    tickets.unshift(t);claim(t,data.nonce,1);return {id:t.id,reference:t.reference};
  }
  throw Error('Unsupported fixture action: '+action);
};
const uploadAttachment=async(upload,file)=>{
  const bytes=await file.arrayBuffer();
  const base64=btoa(String.fromCharCode(...new Uint8Array(bytes)));
  uploads.set(upload.path,'data:'+file.type+';base64,'+base64);
};
export const useSupportMessaging=()=>({call,scope:'offline-fixture',uploadAttachment,count:1,allowed:true,checking:false,errorCode:null,retry:()=>{}});
export const useTraxSupportOptional=()=>null;
export const usePathname=()=>'/support';
export const useSearchParams=()=>new URLSearchParams();
export const useRouter=()=>({push:()=>{}});
export default function Link({children,href,...props}){return React.createElement('a',{href,...props},children);}
`;
const config=loadConfig(resolve(root,'apps/portal/tailwind.config.ts'));
config.content=[resolve(root,'apps/portal/src/components/**/*.{ts,tsx}'),resolve(root,'shared/trax-support/**/*.{ts,tsx}')];
const css=(await postcss([tailwind(config)]).process((await readFile(resolve(root,'apps/portal/src/global.css'),'utf8'))+'\n'+(await readFile(resolve(root,'apps/portal/src/styles/v2-theme.css'),'utf8')),{from:undefined})).css;
await writeFile(resolve(temp,'style.css'),css);
const mocks=new Set(['@/hooks/use-support-messaging','@/components/trax/support/trax-support-context','next/navigation','next/link']);
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
import {PortalSupport} from './apps/portal/src/components/support/portal-support';
/* The dashboard layout bounds this route's height; the stand-in does the same so the
   workspace is measured the way the portal renders it. */
createRoot(document.getElementById('root')).render(
  React.createElement('div',{className:'flex h-svh flex-col overflow-hidden bg-background bg-app-gradient'},
    React.createElement('header',{className:'flex h-16 shrink-0 items-center px-4 text-sm font-semibold'},'Portal top bar'),
    React.createElement('main',{className:'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4'},
      React.createElement(PortalSupport,null))));`,
  resolveDir:root,loader:'tsx'},outfile:resolve(temp,'app.js'),bundle:true,format:'iife',platform:'browser',jsx:'automatic',
  define:{'process.env.NODE_ENV':'"test"'},
  plugins:[{name:'offline-fixtures',setup(b){
    b.onResolve({filter:/.*/},(args)=>{
      if(mocks.has(args.path))return {path:args.path,namespace:'fixture'};
      if(args.path==='react'||args.path==='react-dom'||args.path==='react-dom/client'||args.path.startsWith('react/'))return {path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom'?'react-dom/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path+'.js')};
      if(args.path.startsWith('@/'))return {path:resolve(root,'apps/portal/src',args.path.slice(2))+(args.path.endsWith('.json')?'':(args.path.includes('/components/')?'.tsx':'.ts'))};
    });
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:fixture,loader:'jsx',resolveDir:root}));
  }}],logLevel:'silent'});
const server=createServer(async(req,res)=>{
  const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
  res.setHeader('Content-Type',file?.endsWith('.js')?'text/javascript':file?'text/css':'text/html');
  res.end(file?await readFile(resolve(temp,file)):'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body class="v2-theme"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise((done)=>server.listen(0,'127.0.0.1',done));

let browser;
try{
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:!manual,...(executablePath?{executablePath}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:860},reducedMotion:'reduce'});
  page.setDefaultTimeout(12_000);
  const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
  await page.route('**/*',(route)=>route.request().url().startsWith('http://127.0.0.1:')?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByTestId('support-inbox').waitFor();

  if(manual){
    console.log('Support fixture is open in an isolated browser. Close it or press Ctrl+C to finish.');
    await new Promise((done)=>{const stop=()=>{void browser.close();};browser.once('disconnected',done);process.once('SIGINT',stop);browser.once('disconnected',()=>process.removeListener('SIGINT',stop));});
  }else{
  // 1 — one compact header, one workspace, no second "My Tickets" header.
  assert.equal(await page.getByRole('heading',{name:'Support',exact:true}).count(),1);
  assert.equal(await page.getByText('My Tickets',{exact:true}).count(),0);
  assert.equal(await page.getByText('Human support · Conversations update automatically',{exact:false}).count(),0);
  await page.getByRole('button',{name:'New ticket',exact:true}).waitFor();
  const list=page.getByTestId('support-ticket-list');
  const listWidth=Math.round((await list.boundingBox()).width);
  assert.ok(listWidth>=300&&listWidth<=340,`ticket list is ${listWidth}px, outside 300–340`);
  assert.equal(await page.getByPlaceholder('Search your tickets…').count(),1);

  // 2 — the page itself does not scroll: the workspace fits the viewport.
  const page1=await page.evaluate(()=>({doc:document.documentElement.scrollHeight,view:window.innerHeight,overflowX:document.documentElement.scrollWidth>window.innerWidth}));
  assert.ok(page1.doc<=page1.view+1,`the page scrolls (${page1.doc} > ${page1.view})`);
  assert.equal(page1.overflowX,false,'horizontal overflow');

  // 3 — the list shows real status and the server's own unread flag.
  const rows=page.locator('[data-testid="support-ticket-list"] ul > li');
  await rows.first().waitFor(); // The list is debounced; wait for the first load.
  assert.equal(await rows.count(),3);
  assert.equal(await rows.first().getByText('Open',{exact:true}).count(),1);
  assert.equal(await rows.first().locator('span.bg-primary.rounded-full').count(),1);
  assert.equal(await rows.nth(2).getByText('Resolved',{exact:true}).count(),1);
  await page.screenshot({path:resolve(screenshots,'inbox-desktop.png'),animations:'disabled'});

  // 4 — a conversation: bubbles sized to their content, grouped, with separators.
  await rows.first().getByRole('button').click();
  await page.getByRole('heading',{name:/Returned vehicle still shows/}).waitFor();
  const thread=page.getByLabel('Message thread');
  await thread.getByText('Manchester.',{exact:true}).waitFor();
  const shortBubble=await thread.locator('[data-slot="bubble"]').filter({hasText:'Manchester.'}).boundingBox();
  const threadBox=await thread.boundingBox();
  assert.ok(shortBubble.width<threadBox.width*0.5,`a three-word reply is ${Math.round(shortBubble.width)}px wide in a ${Math.round(threadBox.width)}px column`);
  const longBubble=await thread.locator('[data-slot="bubble"]').filter({hasText:'RENT-2026-000148'}).boundingBox();
  assert.ok(longBubble.width<=threadBox.width*0.9,'a long message is not content-sized');
  assert.ok(longBubble.height>shortBubble.height,'a long message did not wrap onto more lines');
  // Tenant right, support left.
  const tenantX=shortBubble.x+shortBubble.width/2,supportBubble=await thread.locator('[data-slot="bubble"]').filter({hasText:'Could you confirm which branch'}).boundingBox();
  assert.ok(tenantX>threadBox.x+threadBox.width/2,'tenant messages are not aligned right');
  assert.ok(supportBubble.x+supportBubble.width/2<threadBox.x+threadBox.width/2,'support messages are not aligned left');
  assert.ok(await thread.locator('[role="separator"]').count()>=2,'no date separators');
  // Consecutive support replies are one turn with one author label.
  assert.equal(await thread.getByText('Drive247 Support',{exact:true}).count(),2);
  assert.equal(await thread.locator('[data-slot="message"]').count(),4);
  const overflowing=await thread.evaluate((el)=>el.scrollWidth>el.clientWidth+1);
  assert.equal(overflowing,false,'the conversation scrolls sideways');
  await page.screenshot({path:resolve(screenshots,'conversation-desktop.png'),animations:'disabled'});

  // 5 — the header and the composer stay put while the history scrolls.
  const composerBefore=await page.getByPlaceholder('Write a reply…').boundingBox();
  await thread.evaluate((el)=>{el.scrollTop=0;});
  await page.waitForTimeout(200);
  const composerAfter=await page.getByPlaceholder('Write a reply…').boundingBox();
  assert.equal(Math.round(composerBefore.y),Math.round(composerAfter.y),'the composer moved when the history scrolled');
  assert.ok(composerAfter.y+composerAfter.height<=860,'the composer is below the fold');
  assert.equal(await page.getByRole('heading',{name:/Returned vehicle still shows/}).isVisible(),true,'the conversation header scrolled away');
  // Reading older messages is not interrupted by the 5s refresh.
  const scrollTop=await thread.evaluate((el)=>el.scrollTop);
  await page.waitForTimeout(6000);
  assert.equal(await thread.evaluate((el)=>el.scrollTop),scrollTop,'the thread jumped to the bottom while reading older messages');

  // 6 — secondary metadata is behind the disclosure, not in the header.
  assert.equal(await page.getByText('Historical observations',{exact:false}).count(),0);
  await page.getByRole('button',{name:'Issue details'}).click();
  await page.getByText('TRAX troubleshooting context',{exact:true}).waitFor();
  await page.getByText('Rental DEMO-104 is still open.',{exact:false}).waitFor();
  await page.screenshot({path:resolve(screenshots,'issue-details.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Issue details'}).click();

  // 7 — a failed send keeps the draft and offers Retry; the retry succeeds.
  await page.evaluate(()=>{window.failNextSend=true;});
  await page.getByPlaceholder('Write a reply…').fill('We have not heard anything since Tuesday.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByPlaceholder('Write a reply…').inputValue(),'We have not heard anything since Tuesday.','the draft was lost on a failed send');
  await page.screenshot({path:resolve(screenshots,'failed-send.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Retry send',exact:true}).click();
  await thread.getByText('We have not heard anything since Tuesday.',{exact:true}).waitFor();
  assert.equal(await page.getByPlaceholder('Write a reply…').inputValue(),'','the draft survived a confirmed send');

  // 7b — a screenshot goes with the message, and comes back in the conversation.
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  await page.locator('input[type="file"]').setInputFiles({name:'return-handover.png',mimeType:'image/png',buffer:pngBytes});
  await page.getByText('return-handover.png',{exact:false}).waitFor();
  await page.getByPlaceholder('Write a reply…').fill('Here is the screenshot of the handover screen.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await thread.getByText('Here is the screenshot of the handover screen.',{exact:true}).waitFor();
  const image=thread.locator('img[alt="return-handover.png"]');
  await image.waitFor();
  assert.ok(await image.getAttribute('src'),'the attachment came back without a readable URL');
  assert.equal(await page.getByText('return-handover.png',{exact:false}).count(),0,'the pending file stayed after it was sent');
  await page.screenshot({path:resolve(screenshots,'attachment-sent.png'),animations:'disabled'});

  // 7c — a file the conversation does not accept is refused before any upload.
  await page.locator('input[type="file"]').setInputFiles({name:'notes.txt',mimeType:'text/plain',buffer:Buffer.from('plain text')});
  await page.getByText('Attach a PNG, JPEG, WebP, GIF or PDF.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true,'an unsupported file did not block sending');
  await page.getByRole('button',{name:'Remove notes.txt',exact:true}).click();
  await page.getByPlaceholder('Write a reply…').fill('');

  // 8 — filters and their empty result.
  await page.getByRole('button',{name:'Resolved',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="support-ticket-list"] ul > li').length===1);
  await page.getByPlaceholder('Search your tickets…').fill('nothing matches this');
  await page.getByText('No tickets match these filters.',{exact:true}).waitFor();
  await page.screenshot({path:resolve(screenshots,'empty-results.png'),animations:'disabled'});
  await page.getByPlaceholder('Search your tickets…').fill('');
  await page.getByRole('button',{name:'All',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="support-ticket-list"] ul > li').length===3);

  // 9 — a new ticket from the page header, created only by the first Send.
  await page.getByRole('button',{name:'New ticket',exact:true}).click();
  await page.getByRole('heading',{name:'New ticket',exact:true}).waitFor();
  await page.getByLabel('Subject',{exact:true}).fill('Deposit release is still pending');
  await page.getByLabel('Your message',{exact:true}).fill('The deposit has not been released three days after the return.');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-testid="support-ticket-list"] ul > li').length),3,'a ticket was created before Send');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('heading',{name:'Deposit release is still pending'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('[data-testid="support-ticket-list"] ul > li').length===4);

  // 10 — a phone: the list and the conversation take turns, with Back.
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(300);
  assert.equal(await page.getByTestId('support-ticket-list').isVisible(),false,'both columns are squeezed together on a phone');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false,'horizontal overflow on a phone');
  const phoneComposer=await page.getByPlaceholder('Write a reply…').boundingBox();
  assert.ok(phoneComposer.y+phoneComposer.height<=844,'the composer is below the fold on a phone');
  await page.screenshot({path:resolve(screenshots,'conversation-mobile.png'),animations:'disabled'});
  await page.getByRole('button',{name:'Back to tickets',exact:true}).click();
  await page.getByTestId('support-ticket-list').waitFor();
  assert.equal(await page.getByLabel('Support conversation').isVisible(),false,'the conversation stayed on screen behind the list');
  await page.screenshot({path:resolve(screenshots,'inbox-mobile.png'),animations:'disabled'});

  assert.deepEqual(errors,[],'page errors: '+errors.join(' || '));
  console.log(JSON.stringify({status:'passed',mode:'support-inbox-ui',checks:['one-page-header','ticket-list-320','no-outer-page-scroll','real-status-and-unread','content-sized-bubbles','tenant-right-support-left','date-separators-and-grouping','header-and-composer-fixed','no-jump-while-reading','issue-details-disclosure','failed-send-keeps-draft','retry-sends-once','attachment-sent-and-shown','unsupported-file-refused','filters-and-empty-result','new-ticket-only-on-send','phone-list-and-back','no-page-errors'],screenshots}));
  }
}finally{
  await browser?.close();
  server.close();
}
