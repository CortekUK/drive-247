/** Stateless Responses API adapter. Provider output items stay in the bounded
 * request loop; no provider conversation or tenant-wide context is stored. */
export interface ModelMessage { role:'system'|'user'|'assistant'|'tool'; content:string|null; tool_call_id?:string; tool_calls?:ToolCall[]; responseItems?:Record<string,unknown>[] }
export interface ToolCall { id:string; type:'function'; function:{name:string;arguments:string} }
export interface ModelTool { type:'function'; function:{name:string;description:string;strict:true;parameters:Record<string,unknown>} }
export interface ModelReply { content:string|null; tool_calls?:ToolCall[]; responseItems?:Record<string,unknown>[] }
export interface SupportModel { name:string; complete(messages:ModelMessage[],tools:ModelTool[],signal:AbortSignal):Promise<ModelReply> }
export class ModelUnavailable extends Error { constructor(){super('The AI model is unavailable. No model answer was verified.');} }
export const ANSWER_SCHEMA={type:'object',additionalProperties:false,required:['answer','sourceIds','navigationIds'],properties:{answer:{type:'string'},sourceIds:{type:'array',items:{type:'string'}},navigationIds:{type:'array',items:{type:'string'}}}};
export const MODEL_POLICY='minimal-operational-v1';
/** Characters, not tokens: a ceiling on a runaway payload, far below any model's limit. */
export const MAX_PROMPT_CHARS=400_000;
/**
 * The response is read into memory, so it needs a ceiling — but 24,000 bytes was
 * below what an ordinary answer returns once `include: reasoning.encrypted_content`
 * is requested, and every overrun surfaced as "no AI model answer" with no way to
 * tell it from an unconfigured key.
 */
export const RESPONSE_BYTE_LIMIT=2_000_000;
export function responsesInput(messages:ModelMessage[]):Record<string,unknown>[] {
  return messages.flatMap(message=>{
    if(message.responseItems)return message.responseItems;
    if(message.role==='tool')return [{type:'function_call_output',call_id:message.tool_call_id,output:message.content??''}];
    if(message.tool_calls)return message.tool_calls.map(call=>({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments}));
    return [{role:message.role,content:message.content??''}];
  });
}
export function configuredModel(env:(key:string)=>string|undefined):SupportModel|undefined {
  const key=env('OPENAI_API_KEY');const name=env('TRAX_MODEL');const policy=env('TRAX_MODEL_DATA_POLICY');
  /*
   * Say WHICH condition failed.
   *
   * Returning undefined silently surfaces as "TRAX is not connected to an AI model"
   * — a dead end that sent us checking an API key, a model name and a policy string
   * that were all correct, while the real cause stayed invisible. Four conditions
   * produce one indistinguishable symptom, so the server names the failing ones.
   * Variable NAMES only: no key, no value, nothing about a prompt.
   */
  const missing=[
    !key&&'OPENAI_API_KEY',
    !name&&'TRAX_MODEL',
    !!name&&!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(name)&&'TRAX_MODEL(rejected by the name pattern)',
    policy!==MODEL_POLICY&&(policy==null?'TRAX_MODEL_DATA_POLICY(absent)':'TRAX_MODEL_DATA_POLICY(present but not the accepted policy)'),
  ].filter(Boolean);
  // Outbound private context requires an explicit server-side policy approval.
  if(missing.length){console.warn(JSON.stringify({event:'trax_model_unconfigured',missing}));return undefined;}
  return {name,async complete(messages,tools,signal){
    /*
     * A runaway-payload guard, not a context limit.
     *
     * 48,000 characters is roughly 12k tokens — a small fraction of what the
     * configured models accept, and the assembled prompt (instructions, the guide
     * and navigation catalogs, retrieved guidance, then the conversation) passed it
     * in ordinary use. It threw before the request, so nothing counted a model call
     * and the only symptom was "TRAX is not connected to an AI model", which sent
     * people looking at credentials that were fine.
     *
     * The ceiling is here to stop an unbounded payload, so it is set where that is
     * what it catches. The size is reported so a future breach is diagnosable
     * instead of silent; it is a character count, never prompt content.
     */
    const size=JSON.stringify(messages).length;
    if(size>MAX_PROMPT_CHARS){
      console.warn(JSON.stringify({event:'trax_prompt_too_large',chars:size,limit:MAX_PROMPT_CHARS}));
      throw new ModelUnavailable();
    }
    try {
      const response=await fetch('https://api.openai.com/v1/responses',{
        method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
        signal:AbortSignal.any([signal,AbortSignal.timeout(18_000)]),
        body:JSON.stringify({model:name,input:responsesInput(messages),tools:tools.map(tool=>({type:'function',...tool.function})),parallel_tool_calls:false,store:false,max_output_tokens:2400,
          include:['reasoning.encrypted_content'],text:{format:{type:'json_schema',name:'trax_support_answer',strict:true,schema:ANSWER_SCHEMA}}}),
      });
      /*
       * Say which failure happened.
       *
       * Every path below raises the same ModelUnavailable, and the user sees one
       * sentence about prepared guidance for all of them. Five indistinguishable
       * causes behind one symptom is how an evening goes into checking a working
       * API key. Labels only — never a response body, provider message, header,
       * prompt or credential; a status code and a byte count are not content.
       */
      const give=(reason:string,detail:Record<string,unknown>={})=>{
        console.warn(JSON.stringify({event:'trax_model_failed',reason,...detail}));
        return new ModelUnavailable();
      };
      if(!response.ok)throw give('provider_rejected',{status:response.status});
      const reader=response.body?.getReader();if(!reader)throw give('no_response_body');
      const chunks:Uint8Array[]=[];let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>RESPONSE_BYTE_LIMIT){await reader.cancel();throw give('response_too_large',{bytes:size,limit:RESPONSE_BYTE_LIMIT});}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const text=new TextDecoder().decode(bytes);
      const body=JSON.parse(text);
      if(body.status!=='completed'||!Array.isArray(body.output)||body.output.length>12)throw give('unusable_response',{status:body.status??null,outputItems:Array.isArray(body.output)?body.output.length:null});
      const calls=body.output.filter((item:Record<string,unknown>)=>item.type==='function_call');
      const content=body.output.filter((item:Record<string,unknown>)=>item.type==='message').flatMap((item:{content:Record<string,unknown>[]})=>item.content??[]);
      if(calls.length>1)throw give('parallel_tool_calls',{calls:calls.length});
      if(content.some((item:Record<string,unknown>)=>item.type==='refusal'))throw give('model_refused');
      const tool_calls=calls.length?calls.map((call:{call_id:string;name:string;arguments:string})=>({id:call.call_id,type:'function' as const,function:{name:call.name,arguments:call.arguments}})):undefined;
      return {content:content.filter((item:Record<string,unknown>)=>item.type==='output_text').map((item:Record<string,unknown>)=>item.text).join('')||null,tool_calls,responseItems:body.output};
    }catch {throw new ModelUnavailable();}
  }};
}
