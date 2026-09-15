import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTraxSupport } from '@/hooks/use-trax-support';
import * as rollout from '@/lib/v2';

// Use React's own renderer: this checkout lacks @testing-library/dom, a peer
// of the installed Testing Library. These tests exercise the real hook/effects.
const roots: Root[] = [];
function renderHook<T>(hook: () => T) {
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node); roots.push(root);
  const result = { current: undefined as T };
  function Harness() { result.current = hook(); return null; }
  const rerender = () => act(() => root.render(createElement(Harness)));
  rerender(); return { result, rerender };
}
async function waitFor(assertion: () => void) {
  const deadline = Date.now() + 1500; let failure: unknown;
  do {
    try { assertion(); return; } catch (error) { failure = error; }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  } while (Date.now() < deadline);
  throw failure;
}
function cleanup() { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); }

const mocks=vi.hoisted(()=>({
  tenant:{id:'tenant-a',slug:'northwind'},user:{id:'user-a'},appUser:{id:'staff-a',auth_user_id:'user-a',role:'admin',is_active:true,is_super_admin:false},
  v2:true,permissions:[] as {tab_key:string;access_level:string}[],push:vi.fn(),getSession:vi.fn(),fetch:vi.fn(),
}));
vi.mock('@/lib/v2-context',()=>({useV2:()=>mocks.v2}));
vi.mock('next/navigation',()=>({usePathname:()=>'/rentals',useRouter:()=>({push:mocks.push})}));
vi.mock('@/contexts/TenantContext',()=>({useTenant:()=>({tenant:mocks.tenant})}));
vi.mock('@/stores/auth-store',()=>({useAuthStore:()=>({user:mocks.user,appUser:mocks.appUser})}));
vi.mock('@/hooks/use-manager-permissions',()=>({useManagerPermissions:()=>({permissions:mocks.permissions})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getSession:mocks.getSession},channel:()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;},removeChannel:vi.fn()}}));
const provenance={kind:'application_guidance',liveDataChecked:false,productionReleaseVerified:false,knowledgeVersion:'test',sourceCommit:'test',verifiedAt:'2026-09-12',conversationStorage:'browser_memory_only'};
function reply(scope='scope-a',extra:Record<string,unknown>={}) {return new Response(JSON.stringify({response:'Documented guidance only.',conversationId:'signed-context',contextScope:scope,sources:[],navigation:[],provenance,...extra}),{status:200,headers:{'Content-Type':'application/json'}});}
beforeEach(()=>{
  vi.restoreAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://offline.invalid');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();mocks.v2=true;mocks.tenant={id:'tenant-a',slug:'northwind'};mocks.appUser={id:'staff-a',auth_user_id:'user-a',role:'admin',is_active:true,is_super_admin:false};mocks.permissions=[];
  mocks.getSession.mockResolvedValue({data:{session:{access_token:'offline-test-token',user:{id:'user-a'}}}});
  mocks.fetch.mockImplementation(async()=>reply(mocks.tenant.id==='tenant-a'?'scope-a':'scope-b'));vi.stubGlobal('fetch',mocks.fetch);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('useTraxSupport Phase 1',()=>{
  it('accepts only the new operational protocol and sends a server-held recheck',async()=>{
    mocks.fetch.mockImplementation(async(_url,init)=>{
      const body=JSON.parse(init.body);
      return body.type==='context'?reply('scope-a',{capabilities:{modelReady:true,operationalChecks:true,finance:false}}):reply('scope-a',{response:'Verified operational check.',provenance:{...provenance,kind:'operational_support',protocolVersion:2,engine:'model',liveDataChecked:true},sources:[{table:'vehicles',id:'vehicle-ref'}],evidence:[{status:'verified',observedAt:'2026-09-15T00:00:00Z',findings:[],checks:['website_visibility'],limitations:[]}],canRecheck:true});
    });
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
    expect(result.current.capabilities?.modelReady).toBe(true);
    await act(()=>result.current.sendMessage('Check this vehicle'));
    expect(result.current.messages.at(-1)?.canRecheck).toBe(true);
    await act(()=>result.current.checkAgain!());
    const body=JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body);
    expect(body).toMatchObject({type:'recheck',conversationId:'signed-context'});expect(body.diagnostic).toBeUndefined();
  });
  it('rejects financial sources even when an endpoint claims the operational protocol',async()=>{
    mocks.fetch.mockImplementation(async()=>reply('scope-a',{provenance:{...provenance,kind:'operational_support',protocolVersion:2,engine:'model',liveDataChecked:true},sources:[{table:'payments',id:'private'}],evidence:[]}));
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.error).toContain('not available'));expect(result.current.messages).toEqual([]);
  });
  describe('payment evidence cards',()=>{
    const operational={...provenance,kind:'operational_support',protocolVersion:2,engine:'model',liveDataChecked:true};
    const card=(actions:unknown[],stripe='pi_Verified1')=>({paymentId:'00000000-0000-4000-8000-000000000003',reference:{internal:'00000000',stripe},amount:{display:'USD 250.00 captured',basis:'stripe'},date:null,drive247Status:'Applied · captured',stripeStatus:'Succeeded (captured)',account:{label:'your Stripe account ending 1234',mode:'live'},verification:{result:'verified',reason:'stripe_confirmed',detail:'Verified.'},actions,limitation:null});
    const evidenceReply=(finance:boolean,actions:unknown[],stripe?:string)=>async(_url:unknown,init:any)=>{
      const body=JSON.parse(init.body);
      if(body.type==='context')return reply('scope-a',{capabilities:{modelReady:true,operationalChecks:true,finance}});
      return reply('scope-a',{response:'Here are the rental payments.',provenance:operational,capabilities:{modelReady:true,operationalChecks:true,finance},sources:[{table:'payment_evidence',id:'payment_evidence:rental'}],evidence:[{status:'verified',observedAt:'2026-09-15T00:00:00Z',findings:[],checks:['stripe_linked_transactions'],limitations:[],data:{paymentCards:[card(actions,stripe)]}}]});
    };
    it('accepts a dashboard link for the card’s own verified PaymentIntent and a Stripe receipt',async()=>{
      mocks.fetch.mockImplementation(evidenceReply(true,[{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://dashboard.stripe.com/payments/pi_Verified1',note:'Sign in.'},{kind:'receipt',label:'View receipt',href:'https://pay.stripe.com/receipts/payment/abc',note:'Receipt.'}]));
      const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
      await act(()=>result.current.sendMessage('Show me the payments for rental R-1234X'));
      expect(result.current.error).toBeNull();
      expect(result.current.messages.at(-1)?.evidence?.[0].data?.paymentCards?.[0].actions).toHaveLength(2);
    });
    it.each([
      ['a dashboard link to a different payment',[{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://dashboard.stripe.com/payments/pi_Other',note:''}]],
      ['a non-Stripe destination',[{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://evil.invalid/payments/pi_Verified1',note:''}]],
      ['a platform connected-account page',[{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://dashboard.stripe.com/connect/accounts/acct_1/payments/pi_Verified1',note:''}]],
      ['a receipt mislabeled as a dashboard page',[{kind:'receipt',label:'Open in Stripe',href:'https://pay.stripe.com/receipts/payment/abc',note:''}]],
      ['a newly created checkout page',[{kind:'stripe_dashboard',label:'Open in Stripe',href:'https://checkout.stripe.com/c/pay/cs_live_new',note:''}]],
    ])('rejects %s',async(_name,actions)=>{
      mocks.fetch.mockImplementation(evidenceReply(true,actions));
      const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
      await act(()=>result.current.sendMessage('Give me the Stripe link'));
      expect(result.current.error).toContain('could not be verified');expect(result.current.messages).toEqual([]);
    });
    it('rejects payment cards when the account has no finance capability',async()=>{
      mocks.fetch.mockImplementation(evidenceReply(false,[]));
      const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
      await act(()=>result.current.sendMessage('Show payments'));
      expect(result.current.messages).toEqual([]);
    });
  });
  it('uses the same-origin backend in local development',async()=>{
    vi.stubEnv('NODE_ENV','development');
    const {result}=renderHook(()=>useTraxSupport());
    await waitFor(()=>expect(result.current.isLoading).toBe(false));
    await act(()=>result.current.sendMessage('rentals'));
    expect(mocks.fetch.mock.calls.every(([url])=>url==='/api/trax-support')).toBe(true);
  });
  it('keeps production requests on the configured edge endpoint',async()=>{
    vi.stubEnv('NODE_ENV','production');
    const {result}=renderHook(()=>useTraxSupport());
    await waitFor(()=>expect(result.current.isLoading).toBe(false));
    expect(mocks.fetch.mock.calls.every(([url])=>url==='https://offline.invalid/functions/v1/trax-support')).toBe(true);
  });
  it('supports a future tenant enabled for the V2 layout without a Northwind name check',async()=>{
    mocks.tenant={id:'tenant-a',slug:'offline-future-v2'};
    const existingGate=rollout.isV2;
    vi.spyOn(rollout,'isV2').mockImplementation((area,slug)=>area==='chrome'&&slug==='offline-future-v2'||existingGate(area,slug));
    const {result}=renderHook(()=>useTraxSupport());
    await waitFor(()=>expect(result.current.isLoading).toBe(false));
    await act(()=>result.current.sendMessage('rentals'));
    expect(result.current.messages).toHaveLength(2);
    expect(mocks.fetch).toHaveBeenCalled();
  });
  it.each(['offline-other',''])('never contacts support for another or unknown tenant: %s',async(slug)=>{
    mocks.tenant={id:'tenant-a',slug};
    const {result}=renderHook(()=>useTraxSupport());
    await act(()=>result.current.sendMessage('rentals'));
    await act(()=>result.current.navigate({target:'rentals',label:'Open Rentals'}));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });
  it('never contacts support from a V1 layout, even with a Northwind tenant',async()=>{
    mocks.v2=false;
    const {result}=renderHook(()=>useTraxSupport());
    await act(()=>result.current.sendMessage('rentals'));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('fails closed when the environment has no configured support service',async()=>{
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','');
    const {result}=renderHook(()=>useTraxSupport());
    await waitFor(()=>expect(result.current.error).toContain('not configured'));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('does not check access or send requests while the dialog is closed',()=>{renderHook(()=>useTraxSupport(false));expect(mocks.fetch).not.toHaveBeenCalled();});
  it('checks server context before sending and displays a documented answer',async()=>{
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
    await act(()=>result.current.sendMessage('How do returns work?'));
    expect(result.current.messages).toHaveLength(2);
    const bodies=mocks.fetch.mock.calls.map(([,opts])=>JSON.parse(opts.body));
    expect(mocks.fetch.mock.calls.every(([url])=>url==='https://offline.invalid/functions/v1/trax-support')).toBe(true);
    expect(bodies[0].type).toBe('context');expect(bodies[1].contextScope).toBe('scope-a');expect(bodies[1].tenantId).toBe('tenant-a');
    expect(bodies[1].history).toBeUndefined();expect(result.current.messages[1].provenance?.liveDataChecked).toBe(false);
  });
  it('discards a delayed old-tenant response even when fetch ignores AbortSignal',async()=>{
    let resolveAnswer!:(value:Response)=>void;let answerSignal:AbortSignal|undefined;
    mocks.fetch.mockImplementation(async(_url,options)=>JSON.parse(options.body).type==='context'?reply(mocks.tenant.id==='tenant-a'?'scope-a':'scope-b'):new Promise<Response>((resolve)=>{resolveAnswer=resolve;answerSignal=options.signal;}));
    const {result,rerender}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
    let sending!:Promise<void>;act(()=>{sending=result.current.sendMessage('rentals');});
    await waitFor(()=>expect(resolveAnswer).toBeDefined());
    mocks.tenant={id:'tenant-b',slug:'offline-other'};rerender();expect(result.current.messages).toEqual([]);expect(answerSignal?.aborted).toBe(true);
    await act(async()=>{resolveAnswer(reply('scope-a',{response:'OLD_TENANT_SENTINEL'}));await sending;});
    await waitFor(()=>expect(result.current.isLoading).toBe(false));expect(result.current.messages).toEqual([]);
  });
  it('clears old messages synchronously when client permissions change',async()=>{
    const {result,rerender}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));await act(()=>result.current.sendMessage('rentals'));
    mocks.permissions=[{tab_key:'vehicles',access_level:'viewer'}];mocks.appUser={...mocks.appUser,role:'manager'};rerender();
    expect(result.current.messages).toEqual([]);expect(result.current.conversationId).toBeNull();
  });
  it('clears evidence when server permission scope changes on focus',async()=>{
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));await act(()=>result.current.sendMessage('rentals'));
    mocks.fetch.mockResolvedValue(reply('new-server-permissions'));act(()=>{window.dispatchEvent(new Event('focus'));});
    expect(result.current.messages).toEqual([]);await waitFor(()=>expect(result.current.isLoading).toBe(false));expect(result.current.messages).toEqual([]);
  });
  it('does not allow a legacy RAG response to bypass the boundary',async()=>{
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
    mocks.fetch.mockResolvedValue(reply('scope-a',{sources:[{table:'payments',id:'private'}],response:'LEGACY_BALANCE_SENTINEL'}));
    await act(()=>result.current.sendMessage('balance'));expect(result.current.messages).toEqual([]);expect(result.current.error).toContain('not available in this environment');
  });
  it('revalidates navigation before routing and refuses an unsafe returned URL',async()=>{
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));
    mocks.fetch.mockResolvedValue(reply('scope-a',{href:'//evil.invalid'}));
    await act(()=>result.current.navigate({target:'rentals',label:'Open Rentals'}));expect(mocks.push).not.toHaveBeenCalled();
    expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).type).toBe('navigate');
  });
  it('does not call the legacy business action endpoint',async()=>{
    const {result}=renderHook(()=>useTraxSupport());await waitFor(()=>expect(result.current.isLoading).toBe(false));const calls=mocks.fetch.mock.calls.length;
    await act(()=>result.current.confirmAction('old-action'));expect(mocks.fetch).toHaveBeenCalledTimes(calls);expect(result.current.error).toContain('Business actions');
  });
});
