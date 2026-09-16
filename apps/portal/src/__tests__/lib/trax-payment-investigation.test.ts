import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { authorize } from '../../../../../supabase/functions/trax-support/support/auth';
import type { FinanceToolContext } from '../../../../../supabase/functions/trax-support/support/finance-tools';
import { getRentalPaymentEvidence, investigateRentalPayment, resolvePaymentDashboardAction, paymentReferences } from '../../../../../supabase/functions/trax-support/support/payment-investigation';
import { resolvePaymentRoute, paymentActions, type RouteContext } from '../../../../../supabase/functions/trax-support/support/payment-routing';
import { createReadOnlyStripe, stripeMoney } from '../../../../../supabase/functions/trax-support/support/stripe-readonly';
import { handleStripeReadRequest } from '../../../../../supabase/functions/trax-support/support/stripe-read-function';
import { configuredReadOnlyStripe, createRemoteReadOnlyStripe } from '../../../../../supabase/functions/trax-support/support/stripe-remote';
import { createTicketStore } from '../../../../../supabase/functions/trax-support/support/support-store';
import type { FinancePayment, FinanceServices, FinanceTenant, HoldLink, PaymentRoute, StripePaymentEvidence } from '../../../../../supabase/functions/trax-support/support/finance-types';
import { SupportError, type SupportReads, type Staff, type Permission } from '../../../../../supabase/functions/trax-support/support/types';
import { handleSupportRequest, type Dependencies } from '../../../../../supabase/functions/trax-support/support/handler';
import { ModelUnavailable, type ModelReply, type SupportModel } from '../../../../../supabase/functions/trax-support/support/model';

// Offline fixtures only: no real tenant, Stripe account, credential, charge, transfer or refund.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantA=id(1),rentalA=id(2),paymentA=id(3),staffA=id(4),tenantB=id(11),rentalB=id(12),paymentB=id(13);
const now=Date.parse('2026-09-15T12:00:00Z');
const usd=(n:number)=>stripeMoney(n,'USD');
let reads:SupportReads,staff:Staff,permissions:Permission[],finance:FinanceServices,tenantRow:FinanceTenant,payments:FinancePayment[],holdLinks:HoldLink[];
const pay=(o:Partial<FinancePayment>={}):FinancePayment=>({id:paymentA,tenant_id:tenantA,rental_id:rentalA,amount:'250.00',status:'Applied',capture_status:'captured',verification_status:'approved',payment_type:'Payment',payment_provider:'stripe',platform_account:'uae',stripe_payment_intent_id:'pi_A1',stripe_checkout_session_id:'cs_live_A1',refund_amount:null,refund_status:null,paid_at:'2026-08-01T15:30:00Z',created_at:'2026-08-01T15:29:00Z',...o});
const ev=(o:Partial<StripePaymentEvidence>={}):StripePaymentEvidence=>({intentId:'pi_A1',sessionId:'cs_live_A1',livemode:true,sessionStatus:'complete',intentStatus:'succeeded',currency:'USD',requested:usd(25000),received:usd(25000),capturable:usd(0),captured:true,capturedAmount:usd(25000),refunded:usd(0),fullyRefunded:false,createdAt:Date.parse('2026-08-01T15:30:00Z')/1000,receiptUrl:'https://pay.stripe.com/receipts/payment/abc123',ownership:'exclusive_account',platformFlow:false,...o});
beforeEach(()=>{
  vi.restoreAllMocks();vi.stubGlobal('crypto',webcrypto);
  staff={id:staffA,auth_user_id:'offline-user',tenant_id:tenantA,role:'admin',is_active:true,is_super_admin:false};permissions=[];
  reads={authenticate:vi.fn(async()=>({id:'offline-user'})),staff:vi.fn(async()=>({...staff})),tenant:vi.fn(async(t:string)=>t===tenantA?{id:tenantA,slug:'northwind',status:'active'}:null),permissions:vi.fn(async()=>permissions),
    entity:vi.fn(async(kind:string,entity:string,t:string)=>kind==='rental'&&((entity===rentalA&&t===tenantA)||(entity===rentalB&&t===tenantB))?{id:entity,tenant_id:t}:null)} as unknown as SupportReads;
  tenantRow={id:tenantA,currency_code:'USD',payment_provider:'stripe',payment_model:'own',stripe_mode:'live',stripe_account_id:null,stripe_onboarding_complete:false,own_stripe_account_id:'acct_TestA1234',own_stripe_test_account_id:null,own_stripe_connected_at:'2026-07-01T00:00:00Z',timezone:'America/New_York'};
  payments=[pay()];holdLinks=[];
  finance={policy:{mappings:[]},reads:{
    tenant:vi.fn(async(t:string)=>t===tenantA?{...tenantRow}:null),
    entries:vi.fn(async()=>[]),applications:vi.fn(async()=>[]),
    payments:vi.fn(async(t:string,r:string)=>t===tenantA&&r===rentalA?payments.map(p=>({...p})):t===tenantB&&r===rentalB?[pay({id:paymentB,tenant_id:tenantB,rental_id:rentalB})]:[]),
    accountOwners:vi.fn(async()=>1),holdLinks:vi.fn(async()=>holdLinks.map(l=>({...l}))),
  },stripe:{intent:vi.fn(),balance:vi.fn(),evidence:vi.fn(async(_route:PaymentRoute,refs:{intentId:string|null;sessionId:string|null})=>ev({intentId:refs.intentId,sessionId:refs.sessionId}))}};
});
async function env():Promise<FinanceToolContext>{return {reads,auth:await authorize(reads,'offline',tenantA),finance,now,signal:new AbortController().signal};}
const ctx=(o:Partial<RouteContext>={}):RouteContext=>({tenant:tenantRow,mappings:[],holdLinks,owners:async()=>1,...o});
const cards=(r:{data?:Record<string,unknown>})=>r.data?.paymentCards as any[];

describe('payment routing uses recorded evidence and never guesses an account',()=>{
  it('routes to the tenant’s own Standard account only when it was connected before the payment',async()=>{
    expect(await resolvePaymentRoute(pay(),ctx())).toEqual({ok:true,route:{platform:'uae',mode:'live',accountId:'acct_TestA1234',accountType:'standard',basis:'connected_before_payment',exclusive:true,strictOwnership:false}});
  });
  it('never searches an older payment under a newly connected account',async()=>{
    tenantRow.own_stripe_connected_at='2026-09-01T00:00:00Z';
    expect(await resolvePaymentRoute(pay(),ctx())).toEqual({ok:false,reason:'account_unproven'});
  });
  it('reports platform-era payments instead of searching the connected account',async()=>{
    expect(await resolvePaymentRoute(pay({created_at:'2025-12-30T10:00:00Z',paid_at:'2025-12-30T10:00:00Z'}),ctx())).toEqual({ok:false,reason:'platform_era'});
  });
  it('takes the environment only from the recorded checkout prefix or an exact hold record',async()=>{
    expect(await resolvePaymentRoute(pay({stripe_checkout_session_id:null}),ctx())).toEqual({ok:false,reason:'environment_unrecorded'});
    holdLinks=[{tenant_id:tenantA,rental_id:rentalA,platform_account:'uae',stripe_mode:'live',connect_account_id:'acct_HoldHistoric',payment_intent_id:'pi_A1',created_at:'2026-08-01T15:00:00Z'}];
    expect(await resolvePaymentRoute(pay({stripe_checkout_session_id:null}),ctx({holdLinks,owners:async()=>0}))).toMatchObject({ok:true,route:{accountId:'acct_HoldHistoric',basis:'hold_record',mode:'live',exclusive:false,strictOwnership:true}});
  });
  it('treats portal placeholder IDs and non-Stripe payments as having no Stripe transaction',async()=>{
    expect(await resolvePaymentRoute(pay({stripe_payment_intent_id:'portal-admin-123',stripe_checkout_session_id:null}),ctx())).toEqual({ok:false,reason:'no_stripe_reference'});
    expect(await resolvePaymentRoute(pay({payment_provider:'square'}),ctx())).toEqual({ok:false,reason:'not_stripe'});
  });
  it('does not treat Drive247’s shared test account as the tenant’s account',async()=>{
    expect(await resolvePaymentRoute(pay({stripe_checkout_session_id:'cs_test_A1'}),ctx())).toEqual({ok:false,reason:'shared_test_account'});
    expect(await resolvePaymentRoute(pay({platform_account:'uk',stripe_checkout_session_id:'cs_test_A1'}),ctx())).toEqual({ok:false,reason:'shared_test_account'});
    expect(await resolvePaymentRoute(pay(),ctx({sharedTestAccountId:'acct_TestA1234'}))).toEqual({ok:false,reason:'shared_test_account'});
  });
  it('accepts a managed account only with complete, unchanged live hold history starting before the payment',async()=>{
    tenantRow={...tenantRow,payment_model:'managed',stripe_account_id:'acct_Express99'};
    const uk=pay({platform_account:'uk'});
    expect(await resolvePaymentRoute(uk,ctx())).toEqual({ok:false,reason:'account_unproven'});
    holdLinks=[{tenant_id:tenantA,rental_id:rentalA,platform_account:'uk',stripe_mode:'live',connect_account_id:'acct_Express99',payment_intent_id:'pi_other',created_at:'2026-02-01T00:00:00Z'}];
    expect(await resolvePaymentRoute(uk,ctx({tenant:tenantRow,holdLinks}))).toMatchObject({ok:true,route:{accountType:'express',basis:'hold_history_continuity'}});
    holdLinks.push({...holdLinks[0],connect_account_id:'acct_EarlierAccount'});
    expect(await resolvePaymentRoute(uk,ctx({tenant:tenantRow,holdLinks}))).toEqual({ok:false,reason:'account_unproven'});
    expect(await resolvePaymentRoute(uk,ctx({tenant:tenantRow,holdLinks:Array.from({length:1001},()=>holdLinks[0])}))).toEqual({ok:false,reason:'account_unproven'});
  });
  it('refuses accounts linked to more than one Drive247 business',async()=>{
    expect(await resolvePaymentRoute(pay(),ctx({owners:async()=>2}))).toEqual({ok:false,reason:'account_not_exclusive'});
  });
  it('prefers a reviewed mapping and rejects one that contradicts the recorded platform or environment',async()=>{
    const mapping={tenantId:tenantA,paymentId:paymentA,platform:'uae' as const,mode:'live' as const,accountId:'acct_Reviewed1',currency:'USD',verifiedAt:'2026-09-01'};
    expect(await resolvePaymentRoute(pay({created_at:'2025-12-01T00:00:00Z'}),ctx({mappings:[mapping]}))).toMatchObject({ok:true,route:{accountId:'acct_Reviewed1',basis:'reviewed_mapping'}});
    expect(await resolvePaymentRoute(pay(),ctx({mappings:[{...mapping,platform:'uk'}]}))).toEqual({ok:false,reason:'mapping_conflict'});
    expect(await resolvePaymentRoute(pay(),ctx({mappings:[{...mapping,mode:'test'}]}))).toEqual({ok:false,reason:'mapping_conflict'});
  });
});

describe('verified dashboard and receipt actions',()=>{
  const route:PaymentRoute={platform:'uae',mode:'live',accountId:'acct_TestA1234',accountType:'standard',basis:'connected_before_payment',exclusive:true,strictOwnership:false};
  it('links to the exact verified PaymentIntent in the correct environment, never an account ID',()=>{
    const live=paymentActions(route,ev());
    expect(live.actions).toEqual([{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://dashboard.stripe.com/payments/pi_A1',note:'Sign in to your Stripe account ending 1234.'},{kind:'receipt',label:'View receipt',href:'https://pay.stripe.com/receipts/payment/abc123',note:expect.stringContaining('not the dashboard')}]);
    expect(paymentActions({...route,mode:'test'},ev({livemode:false})).actions[0].href).toBe('https://dashboard.stripe.com/test/payments/pi_A1');
    expect(JSON.stringify(live)).not.toContain('acct_');
  });
  it('explains Express, non-exclusive, platform-flow and incomplete checkouts instead of linking',()=>{
    for(const [r,e] of [[{...route,accountType:'express' as const},ev()],[{...route,exclusive:false},ev()],[route,ev({platformFlow:true})],[route,ev({intentId:null,receiptUrl:null})]] as const){
      const result=paymentActions(r,e);expect(result.actions.some(a=>a.kind==='stripe_dashboard')).toBe(false);expect(result.limitation).toBeTruthy();
    }
  });
});

describe('rental payment evidence tool',()=>{
  it('rejects another tenant’s rental and an ungranted role before any financial read',async()=>{
    await expect(getRentalPaymentEvidence({rentalId:rentalB,offset:null},await env())).rejects.toMatchObject({code:'record_unavailable'});
    staff.role='ops';await expect(getRentalPaymentEvidence({rentalId:rentalA},await env())).rejects.toMatchObject({code:'finance_restricted'});
    expect(finance.reads.payments).not.toHaveBeenCalled();expect(finance.stripe.evidence).not.toHaveBeenCalled();
  });
  it('checks every linked payment, keeps holds, failures, refunds and offline entries distinct, and totals per currency',async()=>{
    payments=[pay(),pay({id:id(21),stripe_payment_intent_id:'pi_Hold',stripe_checkout_session_id:null,capture_status:'requires_capture',status:'Pending',created_at:'2026-08-02T10:00:00Z'}),
      pay({id:id(22),stripe_payment_intent_id:'pi_Failed',stripe_checkout_session_id:'cs_live_Failed',status:'Pending',capture_status:null,created_at:'2026-08-03T10:00:00Z'}),
      pay({id:id(23),payment_provider:'square',stripe_payment_intent_id:null,stripe_checkout_session_id:null,created_at:'2026-08-04T10:00:00Z'}),
      pay({id:id(24),stripe_payment_intent_id:null,stripe_checkout_session_id:null,created_at:'2026-08-05T10:00:00Z'}),
      pay({id:id(25),stripe_payment_intent_id:'pi_Gbp',stripe_checkout_session_id:'cs_live_Gbp',amount:'40.00',created_at:'2026-08-06T10:00:00Z'})];
    holdLinks=[{tenant_id:tenantA,rental_id:rentalA,platform_account:'uae',stripe_mode:'live',connect_account_id:'acct_TestA1234',payment_intent_id:'pi_Hold',created_at:'2026-08-02T09:59:00Z'}];
    finance.stripe.evidence=vi.fn(async(_r:PaymentRoute,refs:{intentId:string|null;sessionId:string|null})=>refs.intentId==='pi_Hold'?ev({intentId:'pi_Hold',sessionId:null,intentStatus:'requires_capture',received:usd(0),capturable:usd(10000),captured:false,capturedAmount:usd(0),receiptUrl:null})
      :refs.intentId==='pi_Failed'?ev({intentId:'pi_Failed',sessionId:'cs_live_Failed',intentStatus:'requires_payment_method',received:usd(0),captured:null,capturedAmount:null,refunded:null,receiptUrl:null})
      :refs.intentId==='pi_Gbp'?ev({intentId:'pi_Gbp',sessionId:'cs_live_Gbp',currency:'GBP',requested:stripeMoney(4000,'GBP'),received:stripeMoney(4000,'GBP'),capturable:stripeMoney(0,'GBP'),capturedAmount:stripeMoney(4000,'GBP'),refunded:stripeMoney(0,'GBP')})
      :ev({refunded:usd(5000)}));
    const r=await getRentalPaymentEvidence({rentalId:rentalA,offset:null},await env());
    const byId=Object.fromEntries(cards(r).map((c:any)=>[c.paymentId,c]));
    expect(byId[paymentA]).toMatchObject({verification:{result:'verified'},stripeStatus:'Succeeded, partially refunded',amount:{display:'USD 250.00 captured · USD 50.00 refunded',basis:'stripe'},date:{display:'01 Aug 2026, 11:30 (America/New_York)'}});
    expect(byId[id(21)]).toMatchObject({stripeStatus:'Authorized, not captured (hold)',amount:{display:'USD 100.00 authorized, not captured'}});
    expect(byId[id(22)]).toMatchObject({stripeStatus:'Not completed (failed or abandoned attempt)'});
    expect(byId[id(23)].verification).toMatchObject({result:'offline',reason:'not_stripe'});
    expect(byId[id(24)].verification).toMatchObject({result:'unable',reason:'no_stripe_reference'});
    expect(r.data?.totals).toEqual([{currency:'GBP',captured:'GBP 40.00',refunded:'GBP 0.00',heldNotCaptured:'GBP 0.00'},{currency:'USD',captured:'USD 250.00',refunded:'USD 50.00',heldNotCaptured:'USD 100.00'}]);
    expect(r.data?.coverage).toBe('all_linked_payments');
    expect(finance.stripe.evidence).toHaveBeenCalledTimes(4);
  });
  it('reports a discrepancy without changing either system',async()=>{
    payments=[pay({amount:'260.00'})];
    const r=await getRentalPaymentEvidence({rentalId:rentalA},await env());
    expect(cards(r)[0].verification).toMatchObject({result:'discrepancy'});expect(cards(r)[0].verification.detail).toContain('amount: Drive247 USD 260.00, Stripe USD 250.00');
    expect(r.findings.some(f=>f.code==='payment_conflict')).toBe(true);expect(r.status).toBe('partial');
  });
  it('distinguishes “not found in the recorded account” from a failed Stripe read and from no payments',async()=>{
    finance.stripe.evidence=vi.fn(async()=>{throw new SupportError('stripe_mapping_missing','missing',503);});
    let r=await getRentalPaymentEvidence({rentalId:rentalA},await env());
    expect(cards(r)[0].verification).toMatchObject({result:'unable',reason:'not_found_in_account'});expect(cards(r)[0].verification.detail).toContain('have not confirmed receipt');expect(cards(r)[0].actions).toEqual([]);expect(r.status).toBe('partial');
    finance.stripe.evidence=vi.fn(async()=>{throw new Error('socket hang up with private details');});
    r=await getRentalPaymentEvidence({rentalId:rentalA},await env());
    expect(cards(r)[0].verification.reason).toBe('stripe_unreachable');expect(r.status).toBe('error');expect(JSON.stringify(r)).not.toContain('private details');
    payments=[];r=await getRentalPaymentEvidence({rentalId:rentalA},await env());
    expect(r.findings[0].summary).toBe('Drive247 has no payment records linked to this rental.');expect(r.status).toBe('verified');
  });
  it('declares partial coverage instead of claiming an exhaustive result',async()=>{
    payments=Array.from({length:10},(_,n)=>pay({id:id(100+n),stripe_payment_intent_id:`pi_P${n}`,stripe_checkout_session_id:`cs_live_P${n}`,created_at:`2026-08-${String(10+n)}T10:00:00Z`}));
    const r=await getRentalPaymentEvidence({rentalId:rentalA,offset:null},await env());
    expect(cards(r)).toHaveLength(8);expect(r.data).toMatchObject({totalLinkedPayments:10,nextOffset:8,coverage:'this_page_only'});expect(r.status).toBe('partial');expect(r.limitations.join(' ')).toContain('Only 8 of 10');
  });
  it('discards provider results if the linked payment records change during the check',async()=>{
    finance.stripe.evidence=vi.fn(async()=>{payments[0]={...payments[0],status:'Reversed'};return ev();});
    await expect(getRentalPaymentEvidence({rentalId:rentalA},await env())).rejects.toMatchObject({code:'finance_context_changed'});
  });
  it('investigates only payments that belong to the authorized rental',async()=>{
    await expect(investigateRentalPayment({rentalId:rentalA,paymentId:paymentB},await env())).rejects.toMatchObject({code:'record_unavailable'});
    expect(finance.stripe.evidence).not.toHaveBeenCalled();
  });
  it('separates verified facts from suggestions and offers the exact link',async()=>{
    const r=await investigateRentalPayment({rentalId:rentalA,paymentId:paymentA},await env());
    const explanations=r.data?.explanations as {kind:string;text:string}[];
    expect(explanations[0]).toEqual({kind:'evidence',text:'I verified this transaction in your Stripe account ending 1234 in Stripe live mode.'});
    expect(explanations.filter(e=>e.kind==='suggestion').map(e=>e.text).join(' ')).toContain('TRAX cannot see your Stripe screen');
    expect(JSON.stringify(explanations)).not.toMatch(/money is safe|definitely arrived|release it shortly|charge .* again/i);
    const link=await resolvePaymentDashboardAction({rentalId:rentalA,paymentId:paymentA},await env());
    expect(cards(link)[0].actions[0]).toMatchObject({kind:'stripe_dashboard',href:'https://dashboard.stripe.com/payments/pi_A1'});
  });
  it('builds support references without links, amounts or credentials',async()=>{
    const r=await getRentalPaymentEvidence({rentalId:rentalA},await env());
    const refs=paymentReferences(r);
    expect(refs).toEqual([{paymentId:paymentA,stripeReference:'pi_A1',mode:'live',account:'your Stripe account ending 1234',verification:'verified',reason:'stripe_confirmed',observedAt:r.observedAt}]);
    const rpc=vi.fn(async()=>({data:{id:'ticket'},error:null}));
    const store=createTicketStore({from:()=>({select:()=>({})}),rpc} as never);
    const issue={id:id(40),topic:'payments',summary:'Missing payment',score:100,state:'needs_support',events:[],checks:[],records:[{kind:'rental',id:rentalA}],unknowns:[],excerpts:[],paymentReferences:refs} as never;
    await store.submit({userId:'offline-user',staffId:staffA,tenant:{id:tenantA},scope:'scope'} as never,{id:id(41),expires:now} as never,issue,{subject:'Payment not in Stripe',body:'I cannot find it',nonce:id(42)});
    const handoff=(rpc.mock.calls[0] as unknown as [string,{p_handoff:Record<string,unknown>}])[1].p_handoff;
    expect(handoff.paymentReferences).toEqual(refs);expect(JSON.stringify(handoff)).not.toMatch(/dashboard\.stripe\.com|pay\.stripe\.com|rk_|sk_|USD/);
  });
});

describe('read-only Stripe evidence adapter',()=>{
  const route:PaymentRoute={platform:'uae',mode:'live',accountId:'acct_TestA1234',accountType:'standard',basis:'connected_before_payment',exclusive:true,strictOwnership:false};
  const session=(o:Record<string,unknown>={})=>({object:'checkout.session',id:'cs_live_A1',livemode:true,status:'complete',payment_intent:'pi_A1',metadata:{tenant_id:tenantA,rental_id:rentalA},client_secret:'cs_secret_must_not_escape',...o});
  const intent=(o:Record<string,unknown>={})=>({object:'payment_intent',id:'pi_A1',livemode:true,currency:'usd',status:'succeeded',amount:25000,amount_received:25000,amount_capturable:0,created:1754062140,metadata:{},client_secret:'pi_secret_must_not_escape',
    latest_charge:{object:'charge',payment_intent:'pi_A1',currency:'usd',livemode:true,captured:true,refunded:false,amount_captured:25000,amount_refunded:5000,created:1754062141,receipt_url:'https://pay.stripe.com/receipts/payment/abc123',payment_method_details:{card:{last4:'4242'}},billing_details:{email:'renter@example.com'}},...o});
  const adapter=(bodies:{session?:unknown;intent?:unknown},key='rk_live_offline')=>{
    const fetcher=vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('checkout/sessions')?bodies.session:bodies.intent),{status:200}));
    return {fetcher,stripe:createReadOnlyStripe(k=>k==='TRAX_STRIPE_READ_UAE_LIVE_KEY'?key:undefined,fetcher as unknown as typeof fetch)};
  };
  const expectOwner={tenantId:tenantA,rentalId:rentalA};
  it('uses fixed GETs in the backend-derived account and strips secrets, card and personal data',async()=>{
    const {stripe,fetcher}=adapter({session:session(),intent:intent()});
    const r=await stripe.evidence!(route,{intentId:'pi_A1',sessionId:'cs_live_A1'},expectOwner,new AbortController().signal);
    expect(fetcher.mock.calls.map(c=>(c as unknown as [string])[0])).toEqual(['https://api.stripe.com/v1/checkout/sessions/cs_live_A1','https://api.stripe.com/v1/payment_intents/pi_A1?expand%5B%5D=latest_charge']);
    for(const call of fetcher.mock.calls){const init=(call as unknown as [string,RequestInit])[1];expect(init.method).toBe('GET');expect(init.headers).toMatchObject({'Stripe-Account':'acct_TestA1234',Authorization:'Bearer rk_live_offline'});}
    expect(r).toMatchObject({intentStatus:'succeeded',ownership:'metadata',capturedAmount:{display:'USD 250.00'},refunded:{display:'USD 50.00'},receiptUrl:'https://pay.stripe.com/receipts/payment/abc123',platformFlow:false});
    expect(JSON.stringify(r)).not.toMatch(/secret|4242|renter@example/);
    expect(Object.keys(stripe).sort()).toEqual(['balance','evidence','intent']);
  });
  it('uses the checkout’s linked PaymentIntent when Drive247 stored only the checkout',async()=>{
    const {stripe,fetcher}=adapter({session:session(),intent:intent()});
    expect((await stripe.evidence!(route,{intentId:null,sessionId:'cs_live_A1'},expectOwner,new AbortController().signal)).intentId).toBe('pi_A1');expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['another tenant’s checkout',{session:session({metadata:{tenant_id:tenantB}})},'stripe_ownership_conflict',1],
    ['another rental’s checkout',{session:session({metadata:{tenant_id:tenantA,rental_id:rentalB}})},'stripe_ownership_conflict',1],
    ['a checkout linked to a different PaymentIntent',{session:session({payment_intent:'pi_Other'})},'stripe_mapping_conflict',1],
    ['a live/test mismatch',{session:session({livemode:false})},'stripe_mapping_conflict',1],
  ])('refuses %s',async(_name,bodies,code,calls)=>{
    const {stripe,fetcher}=adapter({...bodies,intent:intent()});
    await expect(stripe.evidence!(route,{intentId:'pi_A1',sessionId:'cs_live_A1'},expectOwner,new AbortController().signal)).rejects.toMatchObject({code});
    expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('requires record-level ownership when the account is not exclusively this tenant’s',async()=>{
    const {stripe}=adapter({intent:intent()});
    await expect(stripe.evidence!({...route,exclusive:false,strictOwnership:true},{intentId:'pi_A1',sessionId:null},expectOwner,new AbortController().signal)).rejects.toMatchObject({code:'stripe_ownership_unverified'});
  });
  it('drops receipt URLs that are not Stripe-hosted receipts and refuses unrestricted keys',async()=>{
    const {stripe}=adapter({intent:intent({latest_charge:{...intent().latest_charge,receipt_url:'https://evil.invalid/receipt'}})});
    expect((await stripe.evidence!(route,{intentId:'pi_A1',sessionId:null},expectOwner,new AbortController().signal)).receiptUrl).toBeNull();
    const unrestricted=adapter({intent:intent()},'sk_live_offline');
    await expect(unrestricted.stripe.evidence!(route,{intentId:'pi_A1',sessionId:null},expectOwner,new AbortController().signal)).rejects.toMatchObject({code:'stripe_configuration_required'});
    expect(unrestricted.fetcher).not.toHaveBeenCalled();
  });
});

describe('Supabase secret bridge (trax-stripe-read)',()=>{
  const route:PaymentRoute={platform:'uae',mode:'live',accountId:'acct_TestA1234',accountType:'standard',basis:'connected_before_payment',exclusive:true,strictOwnership:false};
  const serviceKey='service-role-offline',endpoint='https://project.offline/functions/v1/trax-stripe-read',signal=new AbortController().signal;
  const secrets:Record<string,string>={SUPABASE_SERVICE_ROLE_KEY:serviceKey,STRIPE_UAE_LIVE_SECRET_KEY:'sk_live_offline'};
  const session={object:'checkout.session',id:'cs_live_A1',livemode:true,status:'complete',payment_intent:'pi_A1',metadata:{tenant_id:tenantA,rental_id:rentalA}};
  const intent=(metadata:Record<string,string>={tenant_id:tenantA})=>({object:'payment_intent',id:'pi_A1',livemode:true,currency:'usd',status:'succeeded',amount:25000,amount_received:25000,amount_capturable:0,created:1754062140,metadata,client_secret:'pi_secret_must_not_escape',
    latest_charge:{object:'charge',payment_intent:'pi_A1',currency:'usd',livemode:true,captured:true,refunded:false,amount_captured:25000,amount_refunded:0,created:1754062141}});
  const setup=(intentBody=intent())=>{
    const stripeCalls:[string,RequestInit][]=[],portalBodies:string[]=[];
    const stripeFetch=vi.fn(async(url:string,init:RequestInit)=>{stripeCalls.push([url,init]);return new Response(JSON.stringify(url.includes('checkout/sessions')?session:intentBody),{status:200});});
    const bridge=vi.fn(async(url:string,init:RequestInit)=>{
      const res=await handleStripeReadRequest(new Request(url,{method:init.method,headers:init.headers,body:init.body}),k=>secrets[k],stripeFetch as unknown as typeof fetch);
      portalBodies.push(await res.clone().text());return res;
    });
    return {stripeCalls,portalBodies,bridge,remote:createRemoteReadOnlyStripe('https://project.offline/',serviceKey,bridge as unknown as typeof fetch)};
  };
  it('reads the Stripe secret by name inside Supabase; the portal receives only the sanitized result',async()=>{
    const {stripeCalls,portalBodies,bridge,remote}=setup();
    const r=await remote.evidence!(route,{intentId:'pi_A1',sessionId:'cs_live_A1'},{tenantId:tenantA,rentalId:rentalA},signal);
    expect(r).toMatchObject({intentStatus:'succeeded',ownership:'metadata',capturedAmount:{display:'USD 250.00'}});
    expect((bridge.mock.calls[0] as unknown as [string])[0]).toBe(endpoint);
    expect(stripeCalls.map(c=>c[1].method)).toEqual(['GET','GET']);
    for(const [,init] of stripeCalls)expect(init.headers).toMatchObject({Authorization:'Bearer sk_live_offline','Stripe-Account':'acct_TestA1234'});
    expect(portalBodies.join()).not.toMatch(/sk_live_offline|pi_secret_must_not_escape/);
    expect(String((bridge.mock.calls[0] as unknown as [string,RequestInit])[1].body)).not.toMatch(/sk_/);
  });
  it('passes TRAX refusal codes back unchanged',async()=>{
    const {remote}=setup();
    await expect(remote.evidence!(route,{intentId:'pi_A1',sessionId:'cs_live_A1'},{tenantId:tenantB,rentalId:rentalA},signal)).rejects.toMatchObject({code:'stripe_ownership_conflict'});
  });
  it('fails closed when the route ownership flags are missing',async()=>{
    const {remote}=setup(intent({}));
    const {exclusive:_e,strictOwnership:_s,...partialRoute}=route;
    await expect(remote.evidence!(partialRoute as PaymentRoute,{intentId:'pi_A1',sessionId:null},{tenantId:tenantA,rentalId:rentalA},signal)).rejects.toMatchObject({code:'stripe_ownership_unverified'});
  });
  it.each([['no credential',{}],['a wrong credential',{Authorization:'Bearer wrong'}]])('refuses %s without contacting Stripe',async(_name,headers)=>{
    const stripeFetch=vi.fn();
    const res=await handleStripeReadRequest(new Request(endpoint,{method:'POST',headers,body:JSON.stringify({op:'balance',mapping:{platform:'uae',mode:'live',accountId:'acct_TestA1234'}})}),k=>secrets[k],stripeFetch as unknown as typeof fetch);
    expect(res.status).toBe(403);expect(stripeFetch).not.toHaveBeenCalled();
  });
  it('accepts only POST with a known read operation',async()=>{
    const stripeFetch=vi.fn(),headers={Authorization:`Bearer ${serviceKey}`};
    expect((await handleStripeReadRequest(new Request(endpoint,{method:'GET',headers}),k=>secrets[k],stripeFetch as unknown as typeof fetch)).status).toBe(404);
    expect((await handleStripeReadRequest(new Request(endpoint,{method:'POST',headers,body:JSON.stringify({op:'refund',mapping:{}})}),k=>secrets[k],stripeFetch as unknown as typeof fetch)).status).toBe(400);
    expect(stripeFetch).not.toHaveBeenCalled();
  });
  it('uses the direct reader inside Supabase and the bridge elsewhere',async()=>{
    const bridged=vi.fn(async(_url:string)=>new Response(JSON.stringify({ok:true,result:{mode:'live',available:[],pending:[]}}),{status:200}));
    await configuredReadOnlyStripe(k=>({NEXT_PUBLIC_SUPABASE_URL:'https://project.offline',SUPABASE_SERVICE_ROLE_KEY:serviceKey} as Record<string,string>)[k],bridged as unknown as typeof fetch).balance({platform:'uae',mode:'live',accountId:'acct_TestA1234'},signal);
    expect(bridged.mock.calls[0][0]).toBe(endpoint);
    const direct=vi.fn(async(_url:string)=>new Response(JSON.stringify({object:'balance',livemode:true,available:[],pending:[]}),{status:200}));
    await configuredReadOnlyStripe(k=>secrets[k],direct as unknown as typeof fetch).balance({platform:'uae',mode:'live',accountId:'acct_TestA1234'},signal);
    expect(direct.mock.calls[0][0]).toBe('https://api.stripe.com/v1/balance');
  });
  it('reports an unavailable function as configuration, not as a Stripe fact',async()=>{
    const remote=createRemoteReadOnlyStripe('https://project.offline',serviceKey,vi.fn(async()=>new Response('Not found',{status:404})) as unknown as typeof fetch);
    await expect(remote.balance({platform:'uae',mode:'live',accountId:'acct_TestA1234'},signal)).rejects.toMatchObject({code:'stripe_configuration_required'});
  });
});

describe('payment conversation through the real handler',()=>{
  const call=(name:string,args:unknown):ModelReply=>({content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
  const answer=(text:string):ModelReply=>({content:JSON.stringify({answer:text,sourceIds:[],navigationIds:[]})});
  const scripted=(...replies:ModelReply[]):SupportModel=>({name:'offline-model',complete:vi.fn(async()=>{const next=replies.shift();if(!next)throw new ModelUnavailable();return next;})});
  const rentalRecord=(tenant:string,rental:string)=>({id:rental,tenant_id:tenant,vehicle_id:null,rental_number:'R-1234X',status:'Active',start_date:'2026-08-01',end_date:'2026-08-10',return_time:null,is_pay_as_you_go:false,payg_closed_at:null});
  let operational:any;
  const deps=(model:SupportModel):Dependencies=>({reads,finance,model,signingSecret:'offline-only',now:()=>now,operational,clock:{} as Dependencies['clock']});
  async function request(d:Dependencies,body:Record<string,unknown>){const r=await handleSupportRequest(new Request('http://offline.test',{method:'POST',headers:{Authorization:'Bearer offline'},body:JSON.stringify(body)}),d);return {status:r.status,body:await r.json()};}
  beforeEach(()=>{
    // Both tenants use the same-looking rental number; lookups are always tenant-scoped.
    operational={findRentals:vi.fn(async(t:string,q:string)=>q==='R-1234X'?[rentalRecord(t,t===tenantA?rentalA:rentalB)]:[]),rental:vi.fn(async(t:string,r:string)=>r===rentalA&&t===tenantA?rentalRecord(tenantA,rentalA):null),findVehicles:vi.fn(async()=>[])};
  });
  it('shows payments, investigates “cannot find it in Stripe”, gives the link and checks again without asking for the rental again',async()=>{
    const first=scripted(call('resolve_authorized_entity',{kind:'rental',query:'R-1234X'}),call('get_rental_payment_evidence',{rentalId:rentalA,offset:null}),answer('Here are the payments for this rental.'));
    const one=await request(deps(first),{message:'What payments do I have for #R-1234X?'});
    expect(one.status).toBe(200);expect(operational.findRentals).toHaveBeenCalledWith(tenantA,'R-1234X');
    const evidence=one.body.evidence.find((e:any)=>e.data?.paymentCards);
    expect(evidence.data.paymentCards[0].actions[0].href).toBe('https://dashboard.stripe.com/payments/pi_A1');
    const toolMessages=(vi.mocked(first.complete).mock.calls.at(-1) as any)[0].filter((m:any)=>m.role==='tool').map((m:any)=>m.content).join(' ');
    expect(toolMessages).not.toMatch(/dashboard\.stripe\.com|pay\.stripe\.com|acct_/);expect(one.body.canRecheck).toBe(true);
    const continued=(r:{body:any},message:string,extra:Record<string,unknown>={})=>({message,conversationId:r.body.conversationId,contextScope:r.body.contextScope,...extra});
    const two=await request(deps(scripted(call('investigate_rental_payment',{rentalId:rentalA,paymentId:paymentA}),answer('I verified it in your Stripe account; use Open in Stripe while signed in to it.'))),continued(one,'Yeh payment Stripe mein nahi mil rahi'));
    expect(two.status).toBe(200);
    expect(two.body.evidence.find((e:any)=>e.data?.explanations).data.explanations[0].text).toContain('I verified this transaction');
    const three=await request(deps(scripted(call('resolve_payment_dashboard_action',{rentalId:rentalA,paymentId:paymentA}),answer('Use the Open in Stripe button.'))),continued(two,'Is wali payment ka Stripe link do'));
    expect(three.body.evidence.find((e:any)=>e.data?.paymentCards).data.paymentCards[0].actions[0]).toMatchObject({label:'Open in Stripe',href:'https://dashboard.stripe.com/payments/pi_A1'});
    expect(three.body.ticket).toBeUndefined();expect(three.body.issues.find((i:any)=>i.topic==='payments').state).toBe('investigating');
    const before=vi.mocked(finance.stripe.evidence!).mock.calls.length;
    const four=await request(deps(scripted(answer('I checked it again with fresh records.'))),continued(three,'Check again',{type:'recheck'}));
    expect(four.status).toBe(200);expect(vi.mocked(finance.stripe.evidence!).mock.calls.length).toBe(before+1);expect(operational.findRentals).toHaveBeenCalledTimes(1);
  });
  it('lets a follow-up name a checked payment by its short reference, without inventing access',async()=>{
    const one=await request(deps(scripted(call('resolve_authorized_entity',{kind:'rental',query:'R-1234X'}),call('get_rental_payment_evidence',{rentalId:rentalA,offset:null}),answer('Here are the payments.'))),{message:'Show me the payments for #R-1234X'});
    const followUp=scripted(call('investigate_rental_payment',{rentalId:rentalA,paymentId:paymentA.slice(0,8)}),answer('I verified it in your Stripe account.'));
    const two=await request(deps(followUp),{message:'I cannot find that payment in Stripe',conversationId:one.body.conversationId,contextScope:one.body.contextScope});
    const context=(vi.mocked(followUp.complete).mock.calls[0] as any)[0].filter((m:any)=>m.role==='system').map((m:any)=>m.content).join(' ');
    expect(context).toContain('Payments checked earlier in this conversation');expect(context).toContain(paymentA);expect(context).not.toMatch(/dashboard\.stripe\.com|acct_/);
    expect(two.body.evidence.find((e:any)=>e.data?.explanations).data.paymentCards[0].paymentId).toBe(paymentA);
    const before=vi.mocked(finance.stripe.evidence!).mock.calls.length;
    const three=await request(deps(scripted(call('investigate_rental_payment',{rentalId:rentalA,paymentId:'deadbeef'}),answer('Which payment do you mean?'))),{message:'And the other one?',conversationId:two.body.conversationId,contextScope:two.body.contextScope});
    expect(three.status).toBe(200);expect(vi.mocked(finance.stripe.evidence!).mock.calls.length).toBe(before);
  });
  it('escalates only an unresolved discrepancy, and writes no ticket while support submission is unconfigured',async()=>{
    finance.stripe.evidence=vi.fn(async()=>{throw new SupportError('stripe_mapping_missing','missing',503);});
    const r=await request(deps(scripted(call('get_rental_payment_evidence',{rentalId:rentalA,offset:null}),call('request_support_handoff',{reason:'diagnostics_exhausted'}),answer('I could not verify it; you can contact support.'))),{message:'These payments show in Drive247 but not in Stripe',pageContext:{kind:'rental',id:rentalA}});
    expect(r.body.issues.find((i:any)=>i.topic==='payments')).toMatchObject({state:'needs_support'});expect(r.body.ticket).toBeUndefined();
  });
  it('does not expose the payment tools to a role without payment access',async()=>{
    staff.role='viewer';const model=scripted(call('get_rental_payment_evidence',{rentalId:rentalA,offset:null}),answer('Payment checks are unavailable.'));
    const r=await request(deps(model),{message:'Show me the Stripe payments for R-1234X'});
    expect(r.body.capabilities.finance).toBe(false);expect(finance.stripe.evidence).not.toHaveBeenCalled();
  });
});
