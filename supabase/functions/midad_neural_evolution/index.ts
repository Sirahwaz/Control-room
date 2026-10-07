import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const H={"content-type":"application/json","access-control-allow-origin":"*","access-control-allow-methods":"POST,OPTIONS","access-control-allow-headers":"content-type,authorization,x-midad-autonomy-key,x-midad-ingest-key"};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const n=(v:any,d=0)=>{const x=Number(v);return Number.isFinite(x)?x:d};
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="POST")return json({ok:true,service:"midad_neural_evolution",version:1});
  const autoKey=Deno.env.get("MIDAD_AUTONOMY_KEY")||"",ingestKey=Deno.env.get("MIDAD_INGEST_KEY")||"";const s=req.headers.get("x-midad-autonomy-key")||req.headers.get("x-midad-ingest-key")||"";let vaultKey="";const sk0=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";try{const c=createClient(Deno.env.get("SUPABASE_URL")!,sk0);const v=await c.rpc("midad_get_autonomy_key");vaultKey=typeof v?.data==="string"?v.data:"";}catch(_){};if((autoKey||ingestKey||vaultKey)&&s!==autoKey&&s!==ingestKey&&s!==vaultKey)return json({ok:false,error:"forbidden"},403);
  try{
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [nodes,edges,hyp,learn,fb,runs,factoryLearn]=await Promise.all([
      admin.from("midad_knowledge_nodes").select("id,confidence,novelty_score,importance_score,freshness_score,evidence_count,last_evidence_at,updated_at").order("updated_at",{ascending:false}).limit(1000),
      admin.from("midad_knowledge_edges").select("id,weight,confidence").order("updated_at",{ascending:false}).limit(1000),
      admin.from("midad_hypotheses").select("status,confidence,novelty_score,falsification_score,created_at,updated_at").order("created_at",{ascending:false}).limit(500),
      admin.from("midad_learning_events").select("event_type,reward,confidence,created_at").order("created_at",{ascending:false}).limit(1000),
      admin.from("midad_model_feedback").select("signal_type,source,horizon_minutes,sample_size,hit_rate,recommended_weight,confidence,generated_at").order("generated_at",{ascending:false}).limit(200),
      admin.from("midad_factory_learning").select("scope,tenant_key,product_key,decision_key,evidence,chosen_action,alternatives,outcome,reward,confidence,sample_size,validity_until,created_at").order("updated_at",{ascending:false}).limit(2000),
      admin.from("midad_research_runs").select("id,status,source_count,finding_count,created_at").order("created_at",{ascending:false}).limit(100)
    ]);
    const now=Date.now();
    for(const r of (nodes.data||[])){
      const age=Math.max(0,now-Date.parse(String(r.last_evidence_at||r.updated_at||new Date().toISOString())))/3600000;
      const freshness=Math.exp(-age/336);
      await admin.from("midad_knowledge_nodes").update({freshness_score:Number(Math.max(.02,Math.min(1,freshness)).toFixed(6)),updated_at:new Date().toISOString()}).eq("id",r.id);
    }
    const hs=hyp.data||[];
    const supported=hs.filter((x:any)=>x.status==="SUPPORTED").length,rejected=hs.filter((x:any)=>x.status==="REJECTED").length,totalTested=supported+rejected+hs.filter((x:any)=>x.status==="WEAKENED").length;
    const noveltyYield=hs.length?hs.reduce((s:number,x:any)=>s+n(x.novelty_score),0)/hs.length:0;
    const contradictionRate=learn.data?.length?learn.data.filter((x:any)=>String(x.event_type).includes("contrad")).length/(learn.data.length||1):0;
    const researchSuccess=(runs.data||[]).filter((x:any)=>x.status==="completed").length/Math.max(1,(runs.data||[]).length);
    const avgEvidence=(runs.data||[]).length?(runs.data||[]).reduce((s:number,x:any)=>s+n(x.finding_count),0)/(runs.data||[]).length:0;
    const sourcePerformance=(fb.data||[]).reduce((m:any,x:any)=>{const k=String(x.source||"unknown");const a=m[k]||{samples:0,hit:0,w:0,conf:0};a.samples+=n(x.sample_size);a.hit+=n(x.hit_rate)*n(x.sample_size);a.w+=n(x.recommended_weight,.5);a.conf+=n(x.confidence,.5);m[k]=a;return m},{} as any);
    const factoryRows=factoryLearn.data||[];
    const factoryGroups:any={};
    for(const row of factoryRows){
      const key=String(row.decision_key||"unknown");
      const g=factoryGroups[key]||{samples:0,weighted_reward:0,weighted_confidence:0,actions:{}};
      const samples=Math.max(1,n(row.sample_size,1)), conf=Math.max(0,Math.min(1,n(row.confidence,.5))), reward=n(row.reward,0);
      g.samples+=samples;
      g.weighted_reward+=reward*samples*conf;
      g.weighted_confidence+=conf*samples;
      const ak=JSON.stringify(row.chosen_action||{});
      g.actions[ak]=(g.actions[ak]||0)+samples*conf;
      factoryGroups[key]=g;
    }
    const factoryDecisionPriors:any={};
    for(const [key,g] of Object.entries(factoryGroups) as any){
      const actions=Object.entries(g.actions as any).sort((a:any,b:any)=>b[1]-a[1]).slice(0,5);
      factoryDecisionPriors[key]={
        sample_size:g.samples,
        mean_reward:g.samples?Number((g.weighted_reward/g.samples).toFixed(6)):0,
        confidence:g.weighted_confidence?Number((g.weighted_confidence/g.samples).toFixed(6)):0,
        preferred_actions:actions.map(([action,weight]:any)=>({action:JSON.parse(action),weight:Number(weight.toFixed(4))}))
      };
    }
    const policy={
      research:{require_multiple_sources:true,min_source_count:3,prefer_primary_sources:true,refresh_window_hours:72},
      hypotheses:{test_before_promote:true,minimum_falsification_evidence:.5,novelty_focus:.65},
      memory:{freshness_half_life_hours:336,downweight_stale_nodes:true},
      transfer:{cross_domain_links_min_novelty:.55,min_confidence:.6},
      execution:{external_submission_requires_human_gate:true,financial_writes_requires_human_gate:true},
      factory:{decision_priors:factoryDecisionPriors,min_samples_before_global_rule:5,evidence_weighted:true,do_not_learn_secrets:true},
      source_performance:sourcePerformance
    };
    const confidence=Math.max(.1,Math.min(.99,(researchSuccess*.35)+((totalTested? supported/totalTested:.5)*.35)+(Math.min(1,avgEvidence/5)*.15)+((1-Math.min(1,contradictionRate))*.15)));
    await admin.from("midad_strategy_profiles").upsert({key:"neural_core",version:1,policy,evidence:[{at:new Date().toISOString(),nodes:(nodes.data||[]).length,edges:(edges.data||[]).length,hypotheses:hs.length,learning_events:(learn.data||[]).length,research_runs:(runs.data||[]).length,factory_learning_rows:factoryRows.length}],confidence:Number(confidence.toFixed(6)),last_evaluated_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"key"});
    await admin.from("midad_learning_events").insert({event_type:"meta_learning_cycle",trigger:"scheduled",before_state:{},action:{freshness_recalculated:true,policy_updated:true},after_state:{research_success:researchSuccess,supported_hypotheses:supported,rejected_hypotheses:rejected,novelty_yield:noveltyYield},reward:null,confidence:Number(confidence.toFixed(6)),metadata:{engine:"midad_neural_evolution_v2",factory_learning_rows:factoryRows.length,decision_priors:Object.keys(factoryDecisionPriors).length}});
    return json({ok:true,engine:"midad_neural_evolution",version:1,metrics:{nodes:(nodes.data||[]).length,edges:(edges.data||[]).length,hypotheses:hs.length,supported,rejected,novelty_yield:Number(noveltyYield.toFixed(4)),research_success:Number(researchSuccess.toFixed(4)),avg_evidence:Number(avgEvidence.toFixed(3)),confidence:Number(confidence.toFixed(4))},strategy:policy});
  }catch(e){return json({ok:false,error:String(e).slice(0,500)},500)}
});