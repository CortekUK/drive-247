import type { ModelTool } from './model.ts';
const str={type:'string'},nullable={type:['string','null']};
/*
 * The query shapes, declared once.
 *
 * generate_report takes the same dataset/metric/filters/period/groupBy/sort/limit
 * as query_business_data, but declared them all as `nullable` — string-or-null. With
 * strict schemas the model then CANNOT send an object for `period`, so every report
 * with a period failed, the parser answered "Invalid request.", and the model told
 * users the export was broken. Two declarations of one thing drifted; now there is
 * one declaration and they cannot.
 */
const PRESET_VALUES=['today','yesterday','this_week','last_week','this_month','last_month','this_year','last_year','last_7_days','last_30_days','last_90_days',null];
const FILTERS={type:['array','null'],items:{type:'object',additionalProperties:false,required:['field','op','value'],properties:{field:str,op:{type:'string',enum:['eq','neq','in','gt','gte','lt','lte','is_null','not_null','contains']},value:{type:['string','number','boolean','array','null'],items:str}}}};
const PERIOD={type:['object','null'],additionalProperties:false,required:['basis','preset','from','to'],properties:{basis:str,preset:{type:['string','null'],enum:PRESET_VALUES},from:nullable,to:nullable}};
const SORT={type:['object','null'],additionalProperties:false,required:['by','direction'],properties:{by:{type:'string',enum:['metric','group']},direction:{type:'string',enum:['asc','desc']}}};
const LIMIT={type:['integer','null']};
function tool(name:string,description:string,properties:Record<string,unknown>):ModelTool {
  return {type:'function',function:{name,description,strict:true,parameters:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}}};
}
export const MODEL_TOOLS:ModelTool[]=[
  tool('get_rental_payment_evidence','Payments linked to one resolved rental, each checked against its exactly linked Stripe transaction in the backend-verified account and environment. Returns payment cards (Drive247 and Stripe status, verified amount, account and mode), per-currency totals and permitted Open in Stripe or View receipt actions. Read-only; requires a finance grant.',{rentalId:str,offset:{type:['integer','null']}}),
  tool('investigate_rental_payment','Fresh investigation of one payment from the rental, for example when the user cannot find it in Stripe or asks which account received it: verified account and environment, charge and capture state, differences and evidence-based explanations. Read-only.',{rentalId:str,paymentId:str}),
  tool('resolve_payment_dashboard_action','Fresh, verified Open in Stripe or View receipt action for one payment from the rental, or the reason no dashboard link is available. Read-only; never creates links, logins or payments.',{rentalId:str,paymentId:str}),
  tool('get_stripe_account_summary','Fresh available/pending funds for the authorized tenant’s exclusive connected account. Separate currencies. Not a rental balance. Requires an explicit account-finance grant.',{}),
  tool('select_support_issue','Select the current issue before investigation. Reuse a matching issue for follow-ups; unrelated questions must use a separate topic/record. No score can be supplied.',{topic:{type:'string',enum:['vehicle_availability','fleet_counts','bookings','payments','workflow','other']},recordKind:{type:['string','null'],enum:['vehicle','rental','customer',null]},recordId:nullable}),
  tool('request_support_handoff','Ask the backend to assess whether safe options are exhausted or the user explicitly requested a person. This only offers Contact Support. It never creates a ticket.',{reason:{type:'string',enum:['human_requested','guidance_missing','diagnostics_exhausted']}}),
  /*
   * generate_report is WITHDRAWN from the model's tools.
   *
   * The writers, the storage and the job table all work and are still tested, but
   * end to end the feature never produced a file for a user. What it produced
   * instead was a sequence of confident offers followed by withdrawals — "I'll
   * generate that for you", then "that isn't supported" — which is worse than not
   * offering it, because each round cost the user a question and some trust.
   *
   * Withdrawing the tool is not deleting the work: report-tools.ts,
   * report-format.ts and report-store.ts are untouched and their tests still run,
   * so re-registering this entry is the whole of putting it back. It stays out
   * until a report demonstrably arrives as a file.
   */
  tool('list_business_records','The RECORDS themselves, not a count: which rentals, which cars, which customers, which payments — with their dates, status and the names of the customer and vehicle attached to each. Use whenever the question is "which ones", "show me", "list", "who", or asks for dates alongside names. Filters, period and fields work exactly as query_business_data describes them; discover_business_data lists which datasets can be listed and what each row shows. Returns one bounded page and says how many matched in total.',{
    dataset:str,
    filters:FILTERS,
    period:PERIOD,
    sort:{type:['object','null'],additionalProperties:false,required:['by','direction'],properties:{by:str,direction:{type:'string',enum:['asc','desc']}}},
    limit:LIMIT,
  }),
  tool('query_customer_balances','Who owes this account money, and how much: outstanding, unapplied credit and the net per customer, highest first. Use for \"who owes the most\", \"which customers are in arrears\" or one customer’s balance. Computed in the backend from the account’s own ledger, pay-as-you-go accruals and captured payments; never a bank or Stripe balance. Requires the finance permission.',{
    limit:nullable,minimumOwed:nullable,customerId:nullable,includeCredit:nullable}),
  tool('discover_business_data','What business data this account and role can actually be asked about: the datasets, their metrics and definitions, the fields that can be filtered or grouped, and which business date a period uses. Descriptions only — no records or figures. Call this before a data question you have not answered before in this conversation.',{dataset:nullable}),
  tool('query_business_data','Answer a data question from the tenant\u2019s own records: counts, totals, breakdowns, comparisons and rankings. Choose a dataset, a metric, filters, a period, a grouping and a sort from discover_business_data. Totals are computed in the backend, per currency, over the whole authorized dataset. Never a navigation answer; never SQL.',{
    dataset:str,
    metric:str,
    filters:FILTERS,
    period:PERIOD,
    groupBy:nullable,
    sort:SORT,
    limit:LIMIT,
  }),
  tool('get_account_counts','Exact total vehicles, customers and rentals for the authenticated tenant, independently permission checked. Includes historical records; not an availability calculation.',{kinds:{type:'array',items:{type:'string',enum:['vehicles','customers','rentals']}}}),
  tool('list_account_bookings','List active/out-on-hire recorded states or upcoming reservations using the current tenant timezone. Booking totals are separate from unique vehicles. Follow nextOffset when partial; do not infer bookability.',{view:{type:'string',enum:['active','upcoming','out_now']},offset:{type:['integer','null']}}),
  tool('find_available_vehicles','Check a bounded page of vehicles with the authoritative V2 date rules. Requires actual dates and customer timezone. Partial pages are never a complete fleet availability total.',{startDate:nullable,endDate:nullable,customerTimezone:nullable,pickupLocationId:nullable,offset:{type:['integer','null']}}),
  tool('search_application_knowledge','Retrieve up to three reviewed sections by their exact IDs from the authorized catalog. These are guidance, not live facts.',{sectionIds:{type:'array',items:str}}),
  tool('resolve_navigation_target','Resolve an authorized destination from the navigation catalog; for record destinations use only an ID returned by a tool or validated page context.',{target:str,entityId:nullable}),
  tool('resolve_authorized_entity','Resolve an exact vehicle UUID/registration, rental UUID/number, or the exact pickup location name shown in the website selector. A short vehicle make or model can return ambiguous matches. Ask the user to choose; never guess.',{kind:{type:'string',enum:['vehicle','rental','pickup_location']},query:str}),
  tool('get_rental_support_context','Read one authorized rental and its receiving handovers. Does not close or repair it. No customer or finance fields.',{rentalId:str}),
  tool('diagnose_vehicle_availability','Fresh V2 website/checkout read-only diagnostic for ONE vehicle. First clarify actual failed operation. For date_availability obtain actual dates and customer browser timezone. No invented date window. Checkout is partial precheck only, not write-time validation.',{vehicleId:str,operation:{type:'string',enum:['website_visibility','date_availability','booking_rejection']},startDate:nullable,endDate:nullable,customerTimezone:nullable,pickupLocationId:nullable}),
];
