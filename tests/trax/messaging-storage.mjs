/** Actual candidate SQL, isolated PostgreSQL/WASM. No live services or keys. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.env.TRAX_PGLITE_PATH??resolve(tmpdir(),'drive247-trax-sql-tests/node_modules/@electric-sql/pglite/dist/index.js')));
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role;
create table tenants(id uuid primary key,status text,company_name text,slug text);
create table app_users(id uuid primary key,auth_user_id uuid unique,tenant_id uuid,role text,is_active boolean,is_super_admin boolean,name text);
create table rentals(id uuid primary key,tenant_id uuid,status text);create table vehicles(id uuid primary key,tenant_id uuid);
create table customers(id uuid primary key,tenant_id uuid);create table payments(id uuid primary key,tenant_id uuid);
create table manager_permissions(app_user_id uuid,tab_key text,access_level text);`);
for(const migration of ['20260915190000_trax_v2_support.sql','20260915200000_trax_support_messaging.sql'])await db.exec(await readFile(new URL('../../supabase/migrations/'+migration,import.meta.url),'utf8'));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const t1=id(1),t2=id(2),s1=id(11),s2=id(12),a1=id(13),a2=id(14),u1=id(21),u2=id(22),au1=id(23),au2=id(24),scope='a'.repeat(64);
await db.query('insert into tenants values($1,\'active\',\'Fixture One\',\'one\'),($2,\'active\',\'Fixture Two\',\'two\')',[t1,t2]);
await db.query("insert into app_users values($1,$2,$3,'admin',true,false,'One'),($4,$5,$6,'admin',true,false,'Two'),($7,$8,null,'admin',true,true,'Support A'),($9,$10,null,'admin',true,true,'Support B')",[s1,u1,t1,s2,u2,t2,a1,au1,a2,au2]);
await db.query('insert into trax_support_agents(staff_id) values($1),($2)',[a1,a2]);
const user=[u1,s1,t1,false],other=[u2,s2,t2,false],admin=[au1,a1,null,true],second=[au2,a2,null,true];
const rpc=async(name,args=[])=>(await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args)).rows[0]?.v;
const call=(actor,action,data={})=>rpc('trax_messaging_request',[...actor,action,data]);
const count=async(table)=>(await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
let ticket,ticket2,job;
await test('opening lists and counts creates no ticket, message or notification',async()=>{assert.equal((await call(user,'count')).unread,0);await call(user,'list');for(const t of ['trax_support_tickets','trax_support_messages','trax_support_email_jobs'])assert.equal(await count(t),0);});
await test('empty first message rolls back all support writes',async()=>{await assert.rejects(()=>call(user,'create',{nonce:id(31),subject:'Help',body:' '}));assert.equal(await count('trax_support_tickets'),0);});
await test('first send atomically creates ticket, first message and durable email job',async()=>{ticket=await call(user,'create',{nonce:id(31),subject:'Vehicle not visible',body:'Please help us check this vehicle.'});assert.match(ticket.reference,/^TRX-/);assert.equal(await count('trax_support_tickets'),1);assert.equal(await count('trax_support_messages'),1);assert.equal(await count('trax_support_email_jobs'),1);});
await test('retries and simultaneous first sends create one logical ticket/message/job',async()=>{const results=await Promise.all(Array.from({length:4},()=>call(user,'create',{nonce:id(31),subject:'Retry',body:'Retry'})));assert.ok(results.every(t=>t.id===ticket.id));for(const t of ['trax_support_tickets','trax_support_messages','trax_support_email_jobs'])assert.equal(await count(t),1);});
await test('guessed ticket IDs deny detail, send, read and status across tenants',async()=>{for(const action of ['detail','send','read','status'])await assert.rejects(()=>call(other,action,{id:ticket.id,nonce:id(32),body:'Forged',through:1,status:'closed'}));await assert.rejects(()=>call(other,'create',{nonce:id(31),subject:'Forged',body:'Forged'}));assert.equal((await call(other,'list')).tickets.length,0);assert.equal((await call(other,'count')).unread,0);});
await test('another staff member in the same tenant cannot read a private conversation',async()=>{await db.query("insert into app_users values($1,$2,$3,'admin',true,false,'Colleague')",[id(15),id(25),t1]);const colleague=[id(25),id(15),t1,false];assert.equal((await call(colleague,'list')).tickets.length,0);await assert.rejects(()=>call(colleague,'detail',{id:ticket.id}));});
await test('tenant admin or a display label cannot grant platform support permission',async()=>{await db.query('insert into trax_support_agents(staff_id) values($1)',[s1]);await assert.rejects(()=>call([u1,s1,null,true],'list'));await assert.rejects(()=>rpc('trax_support_list_tickets',[u1,s1,t1,scope,true,0]));await db.query('delete from trax_support_agents where staff_id=$1',[s1]);});
await test('two tenants raise two distinct unread tickets for each support admin',async()=>{ticket2=await call(other,'create',{nonce:id(33),subject:'Second tenant issue',body:'Need human assistance.'});assert.equal((await call(admin,'count')).unread,2);assert.equal((await call(second,'count')).unread,2);});
await test('five unread messages on one ticket still contribute just one',async()=>{for(let n=40;n<44;n++)await call(user,'send',{id:ticket.id,nonce:id(n),body:'Follow-up '+n});assert.equal((await call(admin,'count')).unread,2);assert.equal(await count('trax_support_email_jobs'),2);});
await test('opening list and fetching details never implicitly mark read',async()=>{await call(admin,'list');await call(admin,'detail',{id:ticket.id});assert.equal((await call(admin,'count')).unread,2);});
await test('viewing one conversation updates only the current admin: Support 2 to 1',async()=>{await call(admin,'read',{id:ticket.id,through:5});assert.equal((await call(admin,'count')).unread,1);assert.equal((await call(second,'count')).unread,2);});
await test('late read acknowledgement preserves a newer concurrently arriving message',async()=>{await call(user,'send',{id:ticket.id,nonce:id(44),body:'New after snapshot'});await call(admin,'read',{id:ticket.id,through:5});assert.equal((await call(admin,'count')).unread,2);await call(admin,'read',{id:ticket.id,through:6});});
await test('own support reply does not count as unread tenant content; tenant sees reply badge',async()=>{await call(admin,'send',{id:ticket.id,nonce:id(45),body:'We are reviewing the return record.'});assert.equal((await call(admin,'count')).unread,1);assert.equal((await call(user,'count')).unread,1);const data=await call(user,'detail',{id:ticket.id});assert.equal(data.messages.at(-1).author_kind,'support');await call(user,'read',{id:ticket.id,through:data.latestSeq});assert.equal((await call(user,'count')).unread,0);});
await test('failed-send retry nonce appends only once and preserves ordering',async()=>{const request={id:ticket.id,nonce:id(46),body:'Retry this reply'};const first=await call(admin,'send',request),retry=await call(admin,'send',request);assert.equal(first.seq,retry.seq);const {messages}=await call(user,'detail',{id:ticket.id});assert.deepEqual(messages.map(m=>m.seq),Array.from({length:8},(_,i)=>i+1));});
await test('support resolution requires a message and saves status together',async()=>{await assert.rejects(()=>call(admin,'status',{id:ticket.id,nonce:id(47),status:'closed',body:''}));assert.equal((await call(admin,'detail',{id:ticket.id})).ticket.status,'open');await call(admin,'status',{id:ticket.id,nonce:id(47),status:'closed',body:'The documented workflow is complete.'});assert.equal((await call(user,'detail',{id:ticket.id})).ticket.status,'closed');});
await test('tenant follow-up reopens the existing resolved issue, cancelling closed retention',async()=>{await call(user,'send',{id:ticket.id,nonce:id(48),body:'This is still happening.'});const data=await call(user,'detail',{id:ticket.id});assert.equal(data.ticket.status,'open');assert.equal(data.ticket.closed_at,null);assert.equal(await count('trax_support_tickets'),2);assert.equal((await call(admin,'count')).unread,2);});
await test('retrying an older resolution cannot re-close a reopened ticket',async()=>{await call(admin,'status',{id:ticket.id,nonce:id(47),status:'closed',body:'The documented workflow is complete.'});assert.equal((await call(user,'detail',{id:ticket.id})).ticket.status,'open');});
await test('search and status filters are scoped and parameterized',async()=>{assert.equal((await call(admin,'list',{search:'Fixture Two'})).tickets.length,1);assert.equal((await call(user,'list',{search:'Fixture Two'})).tickets.length,0);assert.equal((await call(admin,'list',{status:'closed'})).tickets.length,0);assert.equal((await call(admin,'list',{search:"' or 1=1 --"})).tickets.length,0);});
await test('invalid cursors, unsupported writes and tenant status changes are rejected',async()=>{await assert.rejects(()=>call(user,'read',{id:ticket.id,through:999}));await assert.rejects(()=>call(user,'refund',{id:ticket.id}));await assert.rejects(()=>call(user,'status',{id:ticket.id,nonce:id(50),body:'Close',status:'closed'}));});
await test('grant revocation takes effect for count, detail, read and message writes',async()=>{await db.query('update trax_support_agents set active=false where staff_id=$1',[a1]);for(const action of ['count','detail','send','read'])await assert.rejects(()=>call(admin,action,{id:ticket.id,nonce:id(49),body:'Should fail',through:1}));await db.query('update trax_support_agents set active=true where staff_id=$1',[a1]);});
await test('browser cannot directly read, subscribe to or mutate private tables/RPCs',async()=>{await db.exec('set role authenticated');try{for(const t of ['trax_support_messages','trax_support_reads','trax_support_email_jobs'])await assert.rejects(()=>db.query(`select * from ${t}`));await assert.rejects(()=>call(user,'list'));}finally{await db.exec('reset role');}});
await test('email worker claims once; competing worker cannot claim the leased job',async()=>{job=await rpc('trax_support_email_claim');assert.ok(job.lease);const otherJob=await rpc('trax_support_email_claim');assert.notEqual(otherJob.ticket_id,job.ticket_id);assert.equal(await rpc('trax_support_email_claim'),null);});
await test('email envelope is frozen before provider send despite later config changes',async()=>{const args=[job.ticket_id,job.lease,{to:'test@example.invalid',text:'Test preview'}];assert.equal((await rpc('trax_support_email_prepare',args)).text,'Test preview');assert.equal((await rpc('trax_support_email_prepare',[...args.slice(0,2),{text:'Changed'}])).text,'Test preview');});
await test('provider failure retains first message and ticket and schedules retry',async()=>{await rpc('trax_support_email_finish',[job.ticket_id,job.lease,null,'Provider unavailable']);assert.equal(await count('trax_support_tickets'),2);const result=(await db.query('select * from trax_support_email_jobs where ticket_id=$1',[job.ticket_id])).rows[0];assert.equal(result.status,'failed');assert.ok(result.available_at);});
await test('uncertain emails stop before provider idempotency expiry',async()=>{await db.exec("update trax_support_email_jobs set first_attempt_at=now()-interval '24 hours'");assert.equal(await rpc('trax_support_email_claim'),null);assert.equal((await db.query("select count(*)::int n from trax_support_email_jobs where status='review'")).rows[0].n,2);});
await test('conversation permission changes do not orphan human tickets',async()=>{await db.query("update app_users set role='manager' where id=$1",[s1]);assert.equal((await call(user,'detail',{id:ticket.id})).ticket.id,ticket.id);await db.query("update app_users set role='admin' where id=$1",[s1]);});
await test('support records retain the existing 90/365 policy with production cleanup disabled',async()=>{const p=(await db.query('select * from trax_support_retention_policy')).rows[0];assert.equal(p.conversation_days,90);assert.equal(p.closed_ticket_days,365);assert.equal(p.cleanup_enabled,false);await assert.rejects(()=>rpc('trax_support_cleanup',[false]));});

let escalated;
await test('escalated first-message failure atomically rolls back ticket and outbox',async()=>{
 const state={id:id(100),issues:[{id:id(101),score:100,state:'needs_support',records:[]}]};
 await rpc('trax_support_save_conversation',[u1,s1,t1,scope,id(100),null,state]);
 const before=await count('trax_support_tickets');
 await assert.rejects(()=>rpc('trax_support_submit_message',[u1,s1,t1,scope,id(100),id(101),'Escalated issue',{recordReferences:[]},id(102),'']));
 assert.equal(await count('trax_support_tickets'),before);assert.equal(await count('trax_support_email_jobs'),2);
 assert.equal((await db.query('select revision from trax_support_conversations where id=$1',[id(100)])).rows[0].revision,1);
});
await test('escalation copies context and saves first message in the same transaction',async()=>{
 escalated=await rpc('trax_support_submit_message',[u1,s1,t1,scope,id(100),id(101),'Escalated issue',{recordReferences:[],reportedByUser:[{content:'Keys were returned'}],verifiedChecks:[]},id(102),'Please review the recorded checks.']);
 const result=await call(user,'detail',{id:escalated.id});assert.equal(result.messages.length,1);assert.equal(result.ticket.handoff.reportedByUser[0].content,'Keys were returned');
});
await test('an already submitted issue opens the existing conversation even with a new nonce',async()=>{
 const retry=await rpc('trax_support_submit_message',[u1,s1,t1,scope,id(100),id(101),'Edited summary',{recordReferences:[]},id(103),'Different first message']);
 assert.equal(retry.id,escalated.id);assert.equal((await call(user,'detail',{id:escalated.id})).messages.length,1);
});
await test('long conversations paginate in sequence without losing older messages',async()=>{
 for(let n=160;n<212;n++){if(n%10===0)await db.exec("update trax_support_messages set created_at=now()-interval '2 minutes'");await call(other,'send',{id:ticket2.id,nonce:id(n),body:'Page test '+n});}
 const latest=await call(other,'detail',{id:ticket2.id});assert.equal(latest.messages.length,50);assert.equal(latest.hasOlder,true);
 const older=await call(other,'detail',{id:ticket2.id,before:latest.messages[0].seq});assert.equal(older.hasOlder,false);assert.equal(older.messages.at(-1).seq,latest.messages[0].seq-1);
});
await test('deactivating a requester denies all subsequent conversation operations',async()=>{
 await db.query('update app_users set is_active=false where id=$1',[s1]);await assert.rejects(()=>call(user,'count'));await assert.rejects(()=>call(user,'detail',{id:ticket.id}));await db.query('update app_users set is_active=true where id=$1',[s1]);
});
await test('ticket cleanup cascades only its messages/read positions/email job; business tables and open tickets survive',async()=>{
 for(const table of ['vehicles','customers','payments'])await db.query(`insert into ${table} values($1,$2)`,[id(250),t1]);await db.query("insert into rentals values($1,$2,'Active')",[id(250),t1]);
 await call(admin,'read',{id:escalated.id,through:1});await call(admin,'status',{id:escalated.id,nonce:id(104),body:'Resolved by support.',status:'closed'});
 await db.query("update trax_support_tickets set closed_at=now()-interval '366 days' where id=$1",[escalated.id]);
 await db.exec("update trax_support_retention_policy set cleanup_enabled=true,cleanup_approved_at=now();update trax_support_conversations set last_activity_at=now()-interval '91 days'");
 const preview=await rpc('trax_support_cleanup',[true]);assert.equal(preview.closedTicketsEligible,1);await rpc('trax_support_cleanup',[false]);
 for(const table of ['trax_support_messages','trax_support_reads','trax_support_email_jobs'])assert.equal((await db.query(`select count(*)::int n from ${table} where ticket_id=$1`,[escalated.id])).rows[0].n,0);
 assert.equal(await count('trax_support_tickets'),2);for(const table of ['vehicles','customers','payments','rentals'])assert.equal(await count(table),1);
});
await test('a follow-up on a pre-messaging ticket does not create a new-ticket email',async()=>{
 const old=id(270);await db.query("insert into trax_support_tickets(id,tenant_id,user_id,scope,issue_id,summary,handoff,created_at) values($1,$2,$3,$4,$5,'Historical ticket','{}',now()-interval '10 days')",[old,t1,u1,scope,id(271)]);
 await call(user,'send',{id:old,nonce:id(272),body:'Following up on the older ticket.'});
 assert.equal((await db.query('select count(*)::int n from trax_support_email_jobs where ticket_id=$1',[old])).rows[0].n,0);
});
await db.close();

