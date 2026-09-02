/**
 * turo-read-contract.test.js — behavioural tests for the Turo read contract.
 *
 * No framework and no build step, deliberately: the extension is plain script
 * loaded unpacked, and these must be runnable by anyone with node and no setup.
 *
 *     node turo-bridge-poc/extension/turo-read-contract.test.js
 *
 * The assertions that matter most are the ones about what must NOT happen:
 * a display-string date must not become a booking, a full page with no
 * next-link must not read as complete, an empty body must not read as "no
 * trips", and an absence must not release a block.
 */

require('/home/haseeb-raza/Desktop/drive-247/turo-bridge-poc/extension/turo-read-contract.js');
require('/home/haseeb-raza/Desktop/drive-247/turo-bridge-poc/extension/fixture.js');
const R=globalThis.__d247TuroRead, O=R.OUTCOME;
let fails=0;
const ok=(n,c,x)=>{ if(!c){fails++;console.log('FAIL',n,JSON.stringify(x));} else console.log('ok  ',n); };

// --- 1. fixture normalises
const nz = R.normalizeRecord(globalThis.D247_TURO_FIXTURE.raw);
ok('fixture -> record', !!nz.record, nz.rejected);
ok('fixture id', nz.record && nz.record.reservationId==='R-900000001', nz.record&&nz.record.reservationId);
ok('fixture dates', nz.record && nz.record.startsAt==='2026-09-12T15:00:00.000Z', nz.record&&nz.record.startsAt);
ok('fixture holdUntil = end+48h', nz.record && nz.record.holdUntil==='2026-09-18T11:00:00.000Z', nz.record&&nz.record.holdUntil);
ok('fixture vehicle plate', nz.record && nz.record.vehicle.plateNormalised==='SAMPLE001', nz.record&&nz.record.vehicle);
ok('fixture vehicle bound by turo id', nz.record && nz.record.vehicle.evidence==='turo_vehicle_id', nz.record&&nz.record.vehicle.evidence);
ok('fixture overflow keeps unmapped keys', nz.record && '__drive247_fixture' in nz.record.rawOverflow, nz.record&&Object.keys(nz.record.rawOverflow));
ok('fixture reports missing tz as unknown', nz.record && nz.record.unknowns.some(u=>u.field==='timezone'), nz.record&&nz.record.unknowns);
ok('lifecycle BOOKED -> upcoming', nz.record && nz.record.lifecycle==='upcoming', nz.record&&nz.record.lifecycle);

// --- 2. renamed date field -> REJECTED, not guessed
const renamed = JSON.parse(JSON.stringify(globalThis.D247_TURO_FIXTURE.raw));
renamed.tripEndTs = renamed.return.dateTime; delete renamed.return;
const rn = R.normalizeRecord(renamed);
ok('renamed end field -> rejected', rn.record===null && rn.rejected.reason==='missing_dates', rn.rejected);
ok('rejection lists observed keys', rn.rejected.observedKeys.includes('tripEndTs'), rn.rejected.observedKeys);

// --- 3. display-string date REFUSED
const disp = JSON.parse(JSON.stringify(globalThis.D247_TURO_FIXTURE.raw));
disp.pickup={dateTime:'Sep 14'}; disp.return={dateTime:'Sep 18'};
ok('display date refused', R.normalizeRecord(disp).record===null, R.normalizeRecord(disp).record);

// --- 4. extractItems: empty container vs unknown envelope
ok('empty named container is FOUND', R.extractItems({trips:[]}).found===true);
ok('unknown envelope NOT found', R.extractItems({foo:1,bar:'x'}).found===false);
ok('root array found', R.extractItems([]).found===true);

// --- 5. classifyBody
const cb=(o)=>R.classifyBody(Object.assign({status:200,contentType:'application/json',body:'{}',finalUrl:'/api/v2/feeds/upcoming-trips'},o));
ok('401 -> NOT_LOGGED_IN', cb({status:401}).outcome===O.NOT_LOGGED_IN);
ok('429 -> RATE_LIMITED', cb({status:429}).outcome===O.RATE_LIMITED);
ok('200 HTML challenge -> BOT_BLOCKED', cb({contentType:'text/html',body:'<html>Just a moment... cf-chl</html>'}).outcome===O.BOT_BLOCKED);
ok('200 JSON challenge -> BOT_BLOCKED', cb({body:'{"_pxCaptcha":"x"}'}).outcome===O.BOT_BLOCKED);
ok('login redirect -> NOT_LOGGED_IN', cb({finalUrl:'https://turo.com/login'}).outcome===O.NOT_LOGGED_IN);
ok('cut JSON -> TRUNCATED', cb({body:'{"trips":[{"id":1'}).outcome===O.TRUNCATED);
ok('clean JSON -> OK', cb({body:'{"trips":[]}'}).outcome===O.OK);

// --- 6. pagination detection
const items200=Array.from({length:200},(_,i)=>({reservationId:'r'+i,startsAt:'2026-01-01T00:00:00Z',endsAt:'2026-01-02T00:00:00Z'}));
let d=R.detectPagination({trips:items200,nextCursor:'abc'},items200,null);
ok('cursor style', d.plan.style==='cursor' && d.nextToken==='abc', d.plan);
d=R.detectPagination({trips:items200,offset:0,limit:200,total:450},items200,null);
ok('offset style', d.plan.style==='offset' && d.nextToken.offset===200, d);
ok('declaredTotal captured', d.plan.declaredTotal===450, d.plan);
d=R.detectPagination({trips:items200,page:1,totalPages:3},items200,null);
ok('page style', d.plan.style==='page' && d.nextToken.page===2, d);
d=R.detectPagination({trips:items200,links:{next:'https://turo.com/api/v2/feeds/upcoming-trips?appMode=HOST&cursor=z'}},items200,null);
ok('next-url style', d.nextUrl==='/api/v2/feeds/upcoming-trips?appMode=HOST&cursor=z', d.nextUrl);
ok('off-origin next-url refused', R.detectPagination({trips:items200,links:{next:'https://evil.example/x'}},items200,null).nextUrl===null);
// THE BIG ONE: full page, no affordance -> "unknown", never "none"
d=R.detectPagination({trips:items200},items200,null);
ok('FULL page no affordance -> unknown', d.plan.style==='unknown', d.plan);
const items3=items200.slice(0,3);
d=R.detectPagination({trips:items3},items3,null);
ok('short page no affordance -> none', d.plan.style==='none', d.plan);
ok('hasMore:false -> explicitEnd', R.detectPagination({trips:items3,hasMore:false},items3,null).explicitEnd===true);
ok('isLastPage:true -> explicitEnd', R.detectPagination({trips:items3,isLastPage:true},items3,null).explicitEnd===true);

// --- 7. buildNextRequest
const nr=R.buildNextRequest('/api/v2/feeds/upcoming-trips?appMode=HOST',R.detectPagination({trips:items200,offset:0,limit:200},items200,null),0);
ok('offset next path', nr.path==='/api/v2/feeds/upcoming-trips?appMode=HOST&offset=200&limit=200', nr.path);

// --- 8. coverage
const cv=(s)=>R.coverageVerdict(Object.assign({pagesRead:1,recordsSeen:8,maxPages:60,plan:{style:'none',declaredTotal:null},lastPageShort:true,explicitEnd:false,pageFailed:false,stalled:false},s));
ok('single short page -> complete', cv({}).complete===true, cv({}));
ok('explicit terminator -> complete', cv({explicitEnd:true}).complete===true);
ok('full page no affordance -> INCOMPLETE', cv({plan:{style:'unknown',declaredTotal:null},lastPageShort:false}).complete===false);
ok('page failed -> INCOMPLETE', cv({pageFailed:true}).complete===false);
ok('declaredTotal match alone -> INCOMPLETE', cv({lastPageShort:false,plan:{style:'cursor',declaredTotal:8}}).complete===false, cv({lastPageShort:false,plan:{style:'cursor',declaredTotal:8}}));
ok('incomplete display never says N of N', cv({pageFailed:true}).display.indexOf(' of ')===-1, cv({pageFailed:true}).display);
console.log('   display(complete)  :', cv({}).display);
console.log('   display(incomplete):', cv({pageFailed:true}).display);

// --- 9. session probe
ok('vehicles nonempty -> live', R.buildSessionProbe({outcome:O.OK,items:[{}]},false).liveSession===true);
ok('vehicles EMPTY -> NOT live', R.buildSessionProbe({outcome:O.OK,items:[]},false).liveSession===false);
ok('vehicles blocked -> NOT live', R.buildSessionProbe({outcome:O.BOT_BLOCKED,items:[]},false).liveSession===false);
ok('trips seen -> live', R.buildSessionProbe(null,true).liveSession===true);

// --- 10. the gates
const mk=(o,c,s)=>R.finaliseRun({outcome:o,coverage:{complete:c,evidence:'short_final_page'},session:{liveSession:s}});
ok('OK+complete+live -> mayRelease', mk(O.OK,true,true).mayRelease===true);
ok('OK+truncated -> NO release', mk(O.OK,false,true).mayRelease===false);
ok('OK+uncorroborated -> NO release', mk(O.OK,true,false).mayRelease===false);
ok('OK+truncated STILL writes', mk(O.OK,false,true).mayWrite===true);
ok('EMPTY_UNCONFIRMED -> no write, no release', mk(O.EMPTY_UNCONFIRMED,true,true).mayWrite===false && mk(O.EMPTY_UNCONFIRMED,true,true).mayRelease===false);
ok('NO_TRIPS_CONFIRMED+complete+live -> release', mk(O.NO_TRIPS_CONFIRMED,true,true).mayRelease===true);
ok('legacy NO_TRIPS never releases', mk(O.NO_TRIPS,true,true).mayRelease===false);
ok('BOT_BLOCKED -> no write', mk(O.BOT_BLOCKED,true,true).mayWrite===false);
console.log('   gateReason(truncated):', mk(O.OK,false,true).gateReason);

// --- 11. absence ledger
const prev={seenReservationIds:['a','b','c'],finishedAt:'2026-09-01T00:00:00Z',absentRunCounts:{b:2}};
let dis=R.diffAbsences(prev,{reservations:[{reservationId:'a',lifecycle:'upcoming',supersedesReservationId:null}],mayRelease:true});
ok('absent_only never releases', dis.every(d=>d.evidence!=='absent_only'||d.releaseAllowed===false), dis);
ok('absent count increments', dis.find(d=>d.reservationId==='b').consecutiveAbsentRuns===3, dis);
dis=R.diffAbsences(prev,{reservations:[{reservationId:'b',lifecycle:'cancelled',supersedesReservationId:null}],mayRelease:true});
ok('explicit cancel releases', dis.find(d=>d.reservationId==='b').releaseAllowed===true, dis);
dis=R.diffAbsences(prev,{reservations:[{reservationId:'b',lifecycle:'cancelled',supersedesReservationId:null}],mayRelease:false});
ok('cancel does NOT release when run gate is shut', dis.find(d=>d.reservationId==='b').releaseAllowed===false);
dis=R.diffAbsences(prev,{reservations:[{reservationId:'zz',lifecycle:'upcoming',supersedesReservationId:'c'}],mayRelease:true});
ok('superseded -> not a release', dis.find(d=>d.reservationId==='c').evidence==='superseded' && dis.find(d=>d.reservationId==='c').releaseAllowed===false);

// --- 12. resumability / tenant guard
const cur=R.newCursor('run1','TENANT_A',{pageKey:'p0',path:'/x',index:0});
ok('same tenant -> resume', R.resumeDecision(cur,{tokenFingerprint:'TENANT_A'}).resume===true);
const bad=R.resumeDecision(cur,{tokenFingerprint:'TENANT_B'});
ok('DIFFERENT tenant -> abandon', bad.resume===false && bad.restart===true && bad.reason==='tenant_changed', bad);
const withTuro=R.advanceCursor(cur,{turoAccountFingerprint:'HOST1'});
ok('different turo account -> abandon', R.resumeDecision(withTuro,{tokenFingerprint:'TENANT_A',turoAccountFingerprint:'HOST2'}).reason==='turo_account_changed');
const stale=R.advanceCursor(cur,{startedAt:new Date(Date.now()-30*3600*1000).toISOString()});
ok('stale cursor -> restart', R.resumeDecision(stale,{tokenFingerprint:'TENANT_A'}).reason==='stale');
const cooling=R.advanceCursor(cur,{nextAllowedAt:new Date(Date.now()+60000).toISOString()});
ok('cooling down -> wait', R.resumeDecision(cooling,{tokenFingerprint:'TENANT_A'}).wait===true);
const c2=R.commitReceipt(cur,{pageKey:'p0',index:0},['a','b']);
ok('receipt bumps seq + clears pending', c2.seq===cur.seq+1 && c2.pending===null && c2.receipts.length===1);
ok('flushedIds accumulate', c2.flushedIds.join()==='a,b');

// --- 13. rate discipline
ok('bot challenge -> park immediately', R.throttleDecision(O.BOT_BLOCKED,0,null).action==='park');
ok('429 -> retry with backoff', R.throttleDecision(O.RATE_LIMITED,0,null).action==='retry');
ok('Retry-After wins when larger', R.throttleDecision(O.RATE_LIMITED,0,120).waitMs===120000);
ok('429 x4 -> park', R.throttleDecision(O.RATE_LIMITED,3,null).action==='park');

// --- 14. worst-outcome reduction
ok('worst of [OK,TRUNCATED] = TRUNCATED', R.worstOutcome([O.OK,O.TRUNCATED])===O.TRUNCATED);
ok('worst of [OK,BOT_BLOCKED,TRUNCATED] = BOT_BLOCKED', R.worstOutcome([O.OK,O.BOT_BLOCKED,O.TRUNCATED])===O.BOT_BLOCKED);

// --- 15. legacy display-string vehicle
const legacy=R.readVehicle({label:'Owner 1 Wagoneer (Jon) (CA #9DUC203)'},null);
ok('legacy label -> plate parsed', legacy.plateNormalised==='9DUC203' && legacy.evidence==='label_plate_parsed', legacy);
ok('legacy label requires review', legacy.requiresReview===true);
const vinOnly=R.readVehicle({vin:'1HGCM82633A004352'},null);
ok('vin never high confidence', vinOnly.confidence==='medium' && vinOnly.requiresReview===true, vinOnly);


// --- 16. pagination stall + merge -----------------------------------------
ok('repeat cursor -> stall', R.detectStall({pageKey:'cursor:abc'},['cursor:abc'],['x'],[]).stalled===true);
ok('all-dup page -> stall', R.detectStall({pageKey:'cursor:z'},['cursor:abc'],['a','b'],['a','b','c']).stalled===true);
ok('some fresh -> no stall', R.detectStall({pageKey:'cursor:z'},['cursor:abc'],['a','d'],['a','b']).stalled===false);
ok('first page -> no stall', R.detectStall({pageKey:'cursor:z'},[],['a','b'],[]).stalled===false);
const into=[{reservationId:'a',v:1}];
let m=R.mergeRecords(into,[{reservationId:'a',v:2},{reservationId:'b',v:1}]);
ok('dedupe on id', into.length===2 && m.duplicates===1 && m.added.join()==='b', {into,m});
ok('last write wins', into[0].v===2);

console.log(fails? ('\n'+fails+' FAILURES') : '\nALL PASS');
process.exit(fails?1:0);
