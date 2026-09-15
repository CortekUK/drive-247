/** Offline UI fixture only. No production imports, credentials or real records. */
import { tenant, rental } from './operational-fixtures.mjs';
const payment='00000000-0000-4000-8000-000000000009',charge='00000000-0000-4000-8000-000000000010';
const money=(n,c='USD')=>({currency:c,minorUnits:n,display:`${c} ${(n/100).toFixed(2)}`});
export const finance={policy:{mappings:[]},reads:{
  // An own (Standard) test account connected before the payment, so routing is provable without a mapping.
  tenant:async()=>({id:tenant,currency_code:'USD',payment_provider:'stripe',payment_model:'own',stripe_mode:'test',stripe_account_id:null,stripe_onboarding_complete:true,own_stripe_account_id:null,own_stripe_test_account_id:'acct_offline',own_stripe_connected_at:'2026-01-20T00:00:00Z',timezone:'UTC'}),accountOwners:async()=>1,holdLinks:async()=>[],
  entries:async()=>[{id:charge,tenant_id:tenant,rental_id:rental,type:'Charge',category:'Rental',amount:250,remaining_amount:0}],
  applications:async()=>[{id:'00000000-0000-4000-8000-000000000011',tenant_id:tenant,payment_id:payment,charge_entry_id:charge,amount_applied:250}],
  payments:async()=>[{id:payment,tenant_id:tenant,rental_id:rental,amount:250,status:'Applied',capture_status:'captured',verification_status:'approved',payment_type:'Payment',payment_provider:'stripe',platform_account:'uae',stripe_payment_intent_id:'pi_offline',stripe_checkout_session_id:'cs_test_offline',refund_amount:0,refund_status:null,paid_at:'2026-09-10T12:00:00Z',created_at:'2026-09-10T11:59:00Z'}],
},stripe:{
  intent:async()=>({status:'succeeded',mode:'test',requested:money(25000),received:money(25000),capturable:money(0),refunded:money(5000),captured:true}),
  balance:async()=>({mode:'test',available:[money(12345),money(400,'GBP')],pending:[money(6789)]}),
  // Stripe shows a refund that the Drive247 record does not: an unresolved discrepancy.
  evidence:async(_route,refs)=>({intentId:refs.intentId,sessionId:refs.sessionId,livemode:false,sessionStatus:'complete',intentStatus:'succeeded',currency:'USD',requested:money(25000),received:money(25000),capturable:money(0),captured:true,capturedAmount:money(25000),refunded:money(5000),fullyRefunded:false,createdAt:Math.floor(Date.parse('2026-09-10T12:00:00Z')/1000),receiptUrl:'https://pay.stripe.com/receipts/payment/offline',ownership:'exclusive_account',platformFlow:false}),
}};
const call=(name,args)=>({content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const answer=text=>({content:JSON.stringify({answer:text,sourceIds:[],navigationIds:[]})});
export const model={name:'offline-scripted-finance',complete:async messages=>{
  const question=messages.filter(m=>m.role==='user').at(-1)?.content??'';
  const calls=messages.filter(m=>m.role==='assistant'&&m.tool_calls).map(m=>m.tool_calls[0].function.name);
  if(/balance/i.test(question))return calls.includes('get_stripe_account_summary')?answer('These are fresh test-mode account funds, separated by currency. They are not this rental’s balance.'):call('get_stripe_account_summary',{});
  if(!calls.includes('resolve_authorized_entity'))return call('resolve_authorized_entity',{kind:'rental',query:rental});
  if(!calls.includes('get_rental_payment_evidence'))return call('get_rental_payment_evidence',{rentalId:rental,offset:null});
  if(!calls.includes('investigate_rental_payment'))return call('investigate_rental_payment',{rentalId:rental,paymentId:payment});
  if(!calls.includes('request_support_handoff'))return call('request_support_handoff',{reason:'diagnostics_exhausted'});
  return answer('Stripe shows a refund that Drive247 has not recorded. Support should review it. No financial action was performed.');
}};
