import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { prepare, staleSources } from '../../../../../scripts/trax-knowledge.mjs';
import ts from 'typescript';
import { RENTAL_COLUMNS, VEHICLE_COLUMNS } from '../../../../../supabase/functions/trax-support/support/operational-reads';
import { FINANCE_PAYMENT_COLUMNS } from '../../../../../supabase/functions/trax-support/support/finance-reads';
const ROOT=resolve(__dirname,'../../../../..');

describe('TRAX maintained knowledge',()=>{
  it('selects only columns that exist in the checked-in database schema',()=>{
    const schema=ts.createSourceFile('types.ts',readFileSync(resolve(ROOT,'apps/portal/src/integrations/supabase/types.ts'),'utf8'),ts.ScriptTarget.Latest,true);
    const database=schema.statements.find((node):node is ts.TypeAliasDeclaration=>ts.isTypeAliasDeclaration(node)&&node.name.text==='Database')!;
    const member=(type:ts.TypeNode,name:string):ts.TypeNode=>{
      if(!ts.isTypeLiteralNode(type))throw new Error(`Expected a type literal for ${name}`);
      const field=type.members.find((node)=>ts.isPropertySignature(node)&&node.name.getText(schema)===name) as ts.PropertySignature|undefined;
      if(!field?.type)throw new Error(`Missing schema member: ${name}`);
      return field.type;
    };
    const tables=member(member(database.type,'public'),'Tables');
    const entry=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/reads.ts'),'utf8');
    const selections=[...entry.matchAll(/\.from\('([^']+)'\)\.select\('([^']+)'\)/g)].map((match)=>[match[1],match[2]]);
    expect(selections).toHaveLength(3);
    const operational=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/operational-reads.ts'),'utf8');
    selections.push(...[...operational.matchAll(/\.from\('([^']+)'\)\.select\('([^']+)'\)/g)].map((match)=>[match[1],match[2]]));
    selections.push(['vehicles',VEHICLE_COLUMNS],['rentals',RENTAL_COLUMNS]);
    const finance=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/finance-reads.ts'),'utf8');
    selections.push(...[...finance.matchAll(/\.from\('([^']+)'\)\.select\('([^']+)'\)/g)].map(match=>[match[1],match[2]]),['payments',FINANCE_PAYMENT_COLUMNS]);
    for(const table of ['rentals','vehicles','customers'])selections.push([table,'id,tenant_id']);
    for(const [table,fields] of selections)for(const field of fields.split(','))expect(()=>member(member(tables,table),'Row')&&member(member(member(tables,table),'Row'),field)).not.toThrow();
  });
  it('matches its sources, portal route inventory and permission coverage',async()=>{
    await expect(prepare(true)).resolves.toMatchObject({verified:6,partially_documented:21,unsupported:1,requiring_confirmation:13});
  },60_000); // Hashes every catalogued source; can exceed the 5s default when the machine is busy.
  it('detects changes and deleted sources without normalizing business text away',async()=>{
    const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
    const hashes={same:sha('a\nb\n'),changed:sha('old'),deleted:sha('old')};
    const read=async(path:string)=>{if(path==='deleted')throw new Error('missing');return path==='same'?'a\r\nb\r\n':'new';};
    expect(await staleSources(hashes,read)).toEqual(['changed','deleted']);
  });
  it('keeps private knowledge, old embeddings and write dispatch outside the handler',()=>{
    const entry=readFileSync(resolve(ROOT,'supabase/functions/trax-support/index.ts'),'utf8')+readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/reads.ts'),'utf8')+readFileSync(resolve(ROOT,'apps/portal/src/app/api/trax-support/route.ts'),'utf8');
    const handler=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/handler.ts'),'utf8');
    expect(entry).not.toMatch(/\.rpc\(|generateEmbedding\(|chatCompletion\(|\.insert\(|\.update\(|\.delete\(|actions\/registry/);
    expect(handler).not.toMatch(/\.rpc\(|generateEmbedding\(|chatCompletion\(|\.insert\(|\.delete\(|actions\/registry/);
    const storage=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/support-store.ts'),'utf8');
    expect([...storage.matchAll(/db\.from\('([^']+)'\)/g)].map(m=>m[1])).toEqual(['trax_support_conversations','trax_support_conversations']);
    expect(handler).toContain("type==='submit_ticket'");
    expect(entry).toContain("select('id,tenant_id')");
    const prepared=readFileSync(resolve(ROOT,'supabase/functions/trax-support/support/knowledge.generated.ts'),'utf8');
    expect(prepared).not.toContain('net_at_stripe');expect(prepared).not.toContain('licence_number');
  });
  it('keeps the deferred legacy remediation outside deployable migrations',()=>{
    const sql=readFileSync(resolve(ROOT,'docs/trax/deferred/restrict-legacy-retrieval.sql'),'utf8');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    for(const name of ['match_documents','get_chat_history','get_rag_metrics','rag_documents','chat_messages'])expect(sql).toContain(name);
    expect(sql).not.toMatch(/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP FUNCTION)\b/i);
  });
  it('preserves the original V1 chat and indexing paths exactly',()=>{
    const baseline=JSON.parse(readFileSync(resolve(ROOT,'tests/trax/v1-baseline.json'),'utf8'));
    for(const [path,expected] of Object.entries(baseline.files)){
      const text=readFileSync(resolve(ROOT,path),'utf8').replace(/\r\n/g,'\n');
      expect(createHash('sha256').update(text).digest('hex'),path).toBe(expected);
    }
  });
});
