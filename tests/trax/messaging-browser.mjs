/** Real shared inbox/admin sidebar + handler + isolated PostgreSQL candidate SQL.
 * Authentication identities are test fixtures; no live tenants/email/provider. */
import {build} from 'esbuild';import {chromium} from 'playwright';
import postcss from 'postcss';import tailwind from 'tailwindcss';import loadConfig from 'tailwindcss/loadConfig.js';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';import {createServer} from 'node:http';
import {tmpdir} from 'node:os';import {resolve,dirname} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),temp=await mkdtemp(resolve(tmpdir(),'trax-messaging-browser-')),out=resolve(root,'artifacts/trax-messaging');await mkdir(out,{recursive:true});
const {PGlite}=await import(pathToFileURL(process.env.TRAX_PGLITE_PATH??resolve(tmpdir(),'drive247-trax-sql-tests/node_modules/@electric-sql/pglite/dist/index.js')));const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table tenants(id uuid primary key,status text,company_name text,slug text);
create table app_users(id uuid primary key,auth_user_id uuid unique,tenant_id uuid,role text,is_active boolean,is_super_admin boolean,name text);
create table rentals(id uuid primary key,tenant_id uuid,status text);create table vehicles(id uuid primary key,tenant_id uuid);create table customers(id uuid primary key,tenant_id uuid);create table payments(id uuid primary key,tenant_id uuid);create table manager_permissions(app_user_id uuid,tab_key text,access_level text);`);
for(const name of ['20260915190000_trax_v2_support.sql','20260915200000_trax_support_messaging.sql'])await db.exec(await readFile(resolve(root,'supabase/migrations',name),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.query("insert into tenants values($1,'active','Northwind · isolated fixture','northwind'),($2,'active','Second rental · isolated fixture','northwind')",[id(1),id(2)]);
const actors={one:{id:id(11),auth_user_id:id(21),tenant_id:id(1),role:'admin',is_active:true,is_super_admin:false,name:'Fixture operator'},two:{id:id(12),auth_user_id:id(22),tenant_id:id(2),role:'admin',is_active:true,is_super_admin:false,name:'Second operator'},admin:{id:id(13),auth_user_id:id(23),tenant_id:null,role:'admin',is_active:true,is_super_admin:true,name:'Support reviewer'}};
actors.unassigned={id:id(14),auth_user_id:id(24),tenant_id:null,role:'admin',is_active:true,is_super_admin:true,name:'Unassigned support fixture'};
for(const actor of Object.values(actors))await db.query('insert into app_users values($1,$2,$3,$4,$5,$6,$7)',Object.values(actor));await db.query('insert into trax_support_agents(staff_id) values($1)',[id(13)]);
const config=loadConfig(resolve(root,'apps/admin/tailwind.config.ts'));config.content=[resolve(root,'shared/trax-support/**/*.{ts,tsx}'),resolve(root,'apps/admin/components/**/*.{ts,tsx}')];
const css=(await postcss([tailwind(config)]).process(await readFile(resolve(root,'apps/admin/app/globals.css'),'utf8'),{from:undefined})).css;
const mocks=`import React from 'react';const actors=${JSON.stringify(actors)};export const actor=actors[new URLSearchParams(location.search).get('actor')??'one'];export const useAuthStore=()=>({user:actor,logout:async()=>{}});export const supabase={auth:{getSession:async()=>({data:{session:{access_token:new URLSearchParams(location.search).get('actor')??'one'}}})}};export const usePathname=()=>'/admin/support';export default function Link({href,children,...props}){return React.createElement('a',{href,...props},children);}`;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {SupportInbox} from './shared/trax-support/SupportInbox';import {useMessagingClient,useSupportUnread} from './shared/trax-support/client';import Sidebar from './apps/admin/components/admin/Sidebar';import {AdminSupportWorkspace} from './apps/admin/components/support/AdminSupportWorkspace';import {SidebarProvider} from './apps/admin/components/admin/SidebarContext';import {actor,supabase} from '@/lib/supabase';const token=async()=>(await supabase.auth.getSession()).data.session.access_token;function Harness(){const call=useMessagingClient({scope:actor.id,token,tenantId:actor.tenant_id,admin:actor.is_super_admin});const unread=useSupportUnread(call);return <SidebarProvider><div className="flex h-screen bg-background text-foreground">{(actor.is_super_admin||new URLSearchParams(location.search).has('showSidebar'))&&<Sidebar/>}<main className="flex min-w-0 flex-1 flex-col p-3"><p className="mb-2 text-xs text-muted-foreground">Isolated local test · no live accounts or email · {actor.is_super_admin?'Platform support':'My Tickets '+(unread.count??'')}</p><div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border">{actor.is_super_admin?<AdminSupportWorkspace/>:<SupportInbox call={call} scope={actor.id}/>}</div></main></div></SidebarProvider>}createRoot(document.getElementById('root')).render(<Harness/>);`,loader:'tsx',resolveDir:root},outfile:resolve(temp,'app.js'),bundle:true,format:'esm',define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_SUPABASE_URL':'"http://offline.invalid"','process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY':'"fixture"'},plugins:[{name:'offline-auth',setup(b){b.onResolve({filter:/.*/},args=>{if(['@/lib/supabase','@/store/authStore','next/navigation','next/link'].includes(args.path))return {path:args.path,namespace:'fixture'};if(args.path==='react'||args.path==='react-dom/client'||args.path.startsWith('react/'))return {path:resolve(root,'node_modules',args.path==='react'?'react/index.js':args.path==='react-dom/client'?'react-dom/client.js':args.path+'.js')};if(args.path.startsWith('@/'))return {path:resolve(root,'apps/admin',args.path.slice(2))+(args.path.includes('components/')?'.tsx':'.ts')};});b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mocks,loader:'jsx',resolveDir:root}));}}],logLevel:'silent'});
await build({entryPoints:[resolve(root,'supabase/functions/trax-support/support/messaging.ts')],outfile:resolve(temp,'handler.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});const {handleMessaging}=await import(pathToFileURL(resolve(temp,'handler.mjs')));
const reads={authenticate:async token=>actors[token]?{id:actors[token].auth_user_id}:null,staff:async user=>Object.values(actors).find(a=>a.auth_user_id===user),tenant:async tenant=>(await db.query('select * from tenants where id=$1',[tenant])).rows[0],permissions:async()=>[],entity:async()=>null};
const adapter={rpc:async(name,args)=>{try{const values=Object.values(args);return {data:(await db.query(`select public.${name}(${values.map((_,i)=>'$'+(i+1)).join(',')}) v`,values)).rows[0].v,error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
let failNextSend=false,loseCreateResponse=false,failNextStatus=false;const server=createServer(async(req,res)=>{if(req.url.startsWith('/api/trax-messaging')){const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks).toString();if(failNextSend&&JSON.parse(body).action==='send'){failNextSend=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture connection interrupted. Your draft is preserved.'}));return;}if(failNextStatus&&JSON.parse(body).action==='status'){failNextStatus=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture status failure.',code:'unavailable'}));return;}const response=await handleMessaging(new Request('http://localhost/api',{method:'POST',headers:{Authorization:req.headers.authorization??''},body}),{reads,db:adapter,enabled:true});if(loseCreateResponse&&JSON.parse(body).action==='create'){loseCreateResponse=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture lost the creation response.'}));return;}res.writeHead(response.status,{'Content-Type':'application/json'});res.end(await response.text());return;}if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(await readFile(resolve(temp,'app.js')));return;}if(req.url==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body style="--font-manrope:Arial"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext({viewport:{width:1365,height:900}});await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
const tenant=await context.newPage(),admin=await context.newPage(),two=await context.newPage();const errors=[];for(const page of [tenant,admin,two])page.on('pageerror',e=>errors.push(e.message));
try{
  const setup=await context.newPage();setup.on('pageerror',e=>errors.push(e.message));
  await setup.route('**/api/trax-messaging',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'local_configuration_required',error:'Local support needs server configuration.'})}));
  await setup.goto(origin+'/?actor=admin');
  await setup.getByRole('link',{name:'Support',exact:true}).waitFor();
  await setup.getByRole('heading',{name:'Support needs setup',exact:true}).waitFor();
  assert.equal(await setup.getByLabel('Support tickets',{exact:true}).count(),0);
  await setup.getByText('Local setup steps',{exact:true}).click();
  await setup.screenshot({path:resolve(out,'admin-support-setup.png')});
  await setup.unroute('**/api/trax-messaging');await setup.getByRole('button',{name:'Check again',exact:true}).click();
  await setup.getByTestId('support-inbox').waitFor();await setup.close();
  const restricted=await context.newPage();restricted.on('pageerror',e=>errors.push(e.message));
  const restrictedActions=[];restricted.on('request',req=>{if(req.url().endsWith('/api/trax-messaging'))restrictedActions.push(req.postDataJSON().action);});
  await restricted.goto(origin+'/?actor=unassigned');
  await restricted.getByRole('link',{name:'Support',exact:true}).waitFor();
  await restricted.getByRole('heading',{name:'Support access required',exact:true}).waitFor();
  assert.equal(await restricted.getByLabel('Support tickets',{exact:true}).count(),0);
  assert.equal(restrictedActions.includes('list'),false);
  await restricted.screenshot({path:resolve(out,'admin-support-access.png')});await restricted.close();
  const ordinary=await context.newPage();await ordinary.goto(origin+'/?actor=one&showSidebar=1');
  await ordinary.getByRole('link',{name:'Contact Requests',exact:true}).waitFor();
  assert.equal(await ordinary.getByRole('link',{name:/^Support(?: |$)/}).count(),0);await ordinary.close();
  await tenant.goto(origin+'/?actor=one');await admin.goto(origin+'/?actor=admin');await two.goto(origin+'/?actor=two');
  await tenant.getByRole('button',{name:'New request',exact:true}).click();assert.equal((await db.query('select count(*)::int n from trax_support_tickets')).rows[0].n,0);
  await tenant.getByLabel('Subject',{exact:true}).fill('Returned vehicle cannot be booked');await tenant.getByLabel('Your message',{exact:true}).fill('The customer returned the keys. Please help us check the recorded return.');
  await tenant.screenshot({path:resolve(out,'tenant-composer.png')});await tenant.getByRole('button',{name:'Send',exact:true}).click();await tenant.getByLabel('Message thread').getByText('The customer returned the keys.',{exact:false}).waitFor();
  await two.getByRole('button',{name:'New request',exact:true}).click();await two.getByLabel('Subject',{exact:true}).fill('A separate tenant request');await two.getByLabel('Your message',{exact:true}).fill('Please help us find our workflow.');await two.getByRole('button',{name:'Send',exact:true}).click();
  await admin.getByRole('link',{name:'Support 2',exact:true}).waitFor({timeout:15000});assert.equal((await db.query('select count(*)::int n from trax_support_email_jobs')).rows[0].n,2);
  await admin.screenshot({path:resolve(out,'admin-unread-two.png')});await admin.getByRole('button').filter({hasText:'Returned vehicle cannot be booked'}).click();await admin.getByRole('link',{name:'Support 1',exact:true}).waitFor({timeout:15000});
  await admin.getByLabel('Reply to the tenant').fill('The previous rental is still open in the supplied report. Please review the existing return workflow.');await admin.getByRole('button',{name:'Send',exact:true}).click();
  await tenant.getByLabel('Message thread').getByText('Please review the existing return workflow.',{exact:false}).waitFor({timeout:15000});
  await admin.screenshot({path:resolve(out,'admin-conversation.png')});await tenant.screenshot({path:resolve(out,'tenant-conversation.png')});
  failNextSend=true;await tenant.getByLabel('Reply in this conversation').fill('Thanks, we will check that now.');await tenant.getByRole('button',{name:'Send',exact:true}).click();await tenant.getByRole('alert').filter({hasText:'Fixture connection interrupted'}).waitFor();assert.equal(await tenant.getByLabel('Reply in this conversation').inputValue(),'Thanks, we will check that now.');await tenant.getByRole('button',{name:'Retry send',exact:true}).click();await tenant.getByLabel('Message thread').getByText('Thanks, we will check that now.',{exact:true}).waitFor();
  await admin.getByLabel('Reply to the tenant').fill('Please contact us again if this issue recurs.');await admin.getByRole('button',{name:'Send',exact:true}).click();await admin.getByLabel('Ticket status',{exact:true}).selectOption('closed');await tenant.getByText('A follow-up message reopens this ticket.',{exact:true}).waitFor({timeout:15000});
  await tenant.getByLabel('Reply in this conversation').fill('The same issue is still happening.');await tenant.getByRole('button',{name:'Send',exact:true}).click();await tenant.getByLabel('Message thread').getByText('The same issue is still happening.',{exact:true}).waitFor();assert.equal((await db.query("select status from trax_support_tickets where summary='Returned vehicle cannot be booked'")).rows[0].status,'open');
  await tenant.reload();await tenant.getByRole('button').filter({hasText:'Returned vehicle cannot be booked'}).click();await tenant.getByLabel('Message thread').getByText('The same issue is still happening.',{exact:true}).waitFor();
  await context.setOffline(true);await tenant.getByLabel('Reply in this conversation').fill('Retry after the connection returns.');await tenant.getByRole('button',{name:'Send',exact:true}).click();await tenant.getByRole('button',{name:'Retry send',exact:true}).waitFor();
  const firstTicket=(await db.query("select id from trax_support_tickets where summary='Returned vehicle cannot be booked'")).rows[0].id;
  const offlineReply=await adapter.rpc('trax_messaging_request',{p_user:id(23),p_staff:id(13),p_tenant:null,p_admin:true,p_action:'send',p_data:{id:firstTicket,nonce:id(300),body:'Support reply received while you were offline.'}});assert.equal(offlineReply.error,null);
  await context.setOffline(false);await tenant.getByRole('button',{name:'Retry send',exact:true}).click();await tenant.getByLabel('Message thread').getByText('Support reply received while you were offline.',{exact:true}).waitFor({timeout:15000});await tenant.getByLabel('Message thread').getByText('Retry after the connection returns.',{exact:true}).waitFor();assert.equal(await tenant.getByLabel('Message thread').getByText('Retry after the connection returns.',{exact:true}).count(),1);
  loseCreateResponse=true;await two.getByRole('button',{name:'New request',exact:true}).click();await two.getByLabel('Subject',{exact:true}).fill('Retry across refresh');await two.getByLabel('Your message',{exact:true}).fill('First message survives a lost response.');await two.getByRole('button',{name:'Send',exact:true}).click();await two.getByRole('button',{name:'Retry send',exact:true}).waitFor();
  await two.reload();await two.getByRole('button',{name:'New request',exact:true}).click();await two.getByLabel('Subject',{exact:true}).fill('Retry across refresh');await two.getByLabel('Your message',{exact:true}).fill('First message survives a lost response.');await two.getByRole('button',{name:'Send',exact:true}).click();await two.getByLabel('Message thread').getByText('First message survives a lost response.',{exact:true}).waitFor();assert.equal((await db.query('select count(*)::int n from trax_support_tickets')).rows[0].n,3);
  await tenant.setViewportSize({width:390,height:844});assert.equal(await tenant.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await tenant.screenshot({path:resolve(out,'tenant-mobile.png')});
  // ── Super Admin status control, and what the tenant sees ─────────────────────
  // Two sessions are open at once here: `admin` is the authorized platform account
  // and `tenant` is the requester, on the same ticket.
  // The mobile check above left the tenant on a phone, where the list gives way to
  // the conversation; both columns are wanted for the status comparison.
  await tenant.setViewportSize({width:1365,height:900});
  const statusOf=async()=>(await db.query('select status from trax_support_tickets where id=$1',[firstTicket])).rows[0].status;
  await admin.getByRole('button').filter({hasText:'Returned vehicle cannot be booked'}).click();
  await admin.getByLabel('Ticket status',{exact:true}).waitFor();
  // A tenant never gets the control, only the badge.
  assert.equal(await tenant.getByLabel('Ticket status',{exact:true}).count(),0,'the tenant was given a status selector');

  /* Badges, not the select's own options: a closed <select> keeps its options in
     the DOM but never visible. */
  const badge=(page,status)=>page.locator('section[aria-label="Support conversation"] header [data-testid="ticket-status"][data-status="'+status+'"]');
  const rowBadge=(page,status)=>page.getByTestId('support-ticket-list').locator('[data-testid="ticket-status"][data-status="'+status+'"]').first();
  await admin.getByLabel('Ticket status',{exact:true}).selectOption('in_progress');
  await badge(admin,'in_progress').waitFor({timeout:15000});
  assert.equal(await statusOf(),'in_progress','In progress was not persisted');
  // The tenant's own view catches up on its own, without a refresh or a sign-out.
  await rowBadge(tenant,'in_progress').waitFor({timeout:20000});
  await admin.screenshot({path:resolve(out,'admin-status-in-progress.png')});
  await tenant.screenshot({path:resolve(out,'tenant-status-in-progress.png')});

  await admin.getByLabel('Ticket status',{exact:true}).selectOption('closed');
  await badge(admin,'closed').waitFor({timeout:15000});
  assert.equal(await statusOf(),'closed','Resolved was not persisted');
  await rowBadge(tenant,'closed').waitFor({timeout:20000});
  // And it is still Resolved after a reload on both sides: one stored record.
  await tenant.reload();await tenant.getByRole('button').filter({hasText:'Returned vehicle cannot be booked'}).click();
  await badge(tenant,'closed').waitFor({timeout:20000});
  assert.equal(await statusOf(),'closed');

  // A failed save leaves the stored status showing, and says so.
  failNextStatus=true;
  await admin.getByLabel('Ticket status',{exact:true}).selectOption('open');
  await admin.getByRole('alert').filter({hasText:'not saved'}).waitFor({timeout:15000});
  assert.equal(await statusOf(),'closed','a failed status change was written anyway');
  await badge(admin,'closed').waitFor({timeout:15000});

  assert.deepEqual(errors,[]);await writeFile(resolve(out,'browser-results.json'),JSON.stringify({passed:true,liveEmail:false,liveTenants:false,actualSql:true,checks:['Support visible during missing setup','setup recovery opens authorized inbox','unassigned platform admin sees access state without ticket list','ordinary staff cannot see platform Support link','composer has no writes','atomic first send','Support 2 → 1','two-way automatic updates','failed draft retry','resolved ticket reopens','admin status selector persists','tenant sees the status without refreshing','failed status change keeps the stored status','tenant has no status control','refresh restores conversation','offline reconnect catches up without duplicate messages','lost first-send response retries across refresh without duplicate','mobile no clipping'],errors},null,2));console.log('Messaging browser checks passed; isolated SQL and auth fixtures, no live email.');
}catch(e){console.log('Browser errors:',errors);await tenant.screenshot({path:resolve(out,'failure.png')});console.log((await tenant.locator('body').innerText()).slice(0,1200));throw e;}finally{await browser.close();server.close();await db.close();}
