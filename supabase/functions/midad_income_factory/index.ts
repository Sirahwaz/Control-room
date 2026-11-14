import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const H = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"POST,OPTIONS",
  "access-control-allow-headers":"content-type,x-midad-client"
};

function json(v:any,status=200){ return new Response(JSON.stringify(v),{status,headers:H}); }
function clean(v:any,n=500){ return String(v??"").trim().slice(0,n); }
function n(v:any){ const x=Number(v); return Number.isFinite(x)?x:0; }

async function sha256(s:string){
  const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function authorize(token:string,req?:Request){
  const auth=req?.headers.get("authorization")||"";
  if(auth==="Bearer "+SERVICE_KEY) return true;
  const internal=req?.headers.get("x-midad-autonomy-key")||"";
  if(internal){
    const {data}=await db.rpc("midad_get_autonomy_key");
    if(data && internal===String(data)) return true;
  }
  if(!token) return false;
  const th=await sha256(token);
  const {data,error}=await db.from("control_room_sessions")
    .select("id,active,created_at")
    .eq("token_hash",th).eq("active",true).maybeSingle();
  if(error||!data) return false;
  const age=Date.now()-new Date(data.created_at).getTime();
  if(!Number.isFinite(age)||age>30*24*60*60*1000) return false;
  await db.from("control_room_sessions").update({last_used_at:new Date().toISOString()}).eq("id",data.id);
  return true;
}

function classify(title:string,desc:string){
  const s=(title+" "+desc).toLowerCase();
  if(/lead|crm|follow.?up|review.?request/.test(s)) return "automation";
  if(/openapi|api documentation|swagger|fastapi|flask/.test(s)) return "api_docs";
  if(/python|desktop|gui|script/.test(s)) return "python";
  if(/ai.?read|content audit|readability|seo/.test(s)) return "audit";
  if(/research|brief|analysis|report/.test(s)) return "research";
  return "connector";
}

function blueprintFor(o:any,a:any,caps:any[]){
  const kind=classify(o.title||"",o.description||"");
  const commonQA=[
    "اختبار مسار النجاح الأساسي",
    "اختبار حالة فشل/مدخل غير صالح",
    "تسجيل ما تم التحقق منه وما لم يتم التحقق منه",
    "تأكيد قابلية إعادة التشغيل دون تكرار غير مقصود"
  ];
  const packs:any = {
    automation:{
      deliverables:["workflow عامل","تكاملات API المطلوبة","معالجة أخطاء وإعادة المحاولة","مجموعة اختبار صغيرة","تعليمات تسليم"],
      acceptance:["المسار الأساسي يعمل","المدخل الخاطئ لا يكسر النظام","الأخطاء قابلة للتشخيص","لا توجد عمليات حساسة غير مصرح بها"],
      sequence:["ثبّت المتطلبات والمدخلات","ابنِ المسار الأصغر القابل للتجربة","اختبر الحالات الأساسية","وثّق التسليم","نفّذ قبول العميل"],
      buyer:"عميل أتمتة / وكالة / سوق مهام",
      questions:["ما نقطة البداية؟","ما الأنظمة/واجهات API المتاحة؟","ما شرط النجاح القابل للقياس؟"],
      proof:["demo flow","test cases","execution log"]
    },
    api_docs:{
      deliverables:["ملف OpenAPI منظم","ملاحظات lint/اتساق","أمثلة request/response","قائمة QA"],
      acceptance:["المخطط صالح للتحليل","النقاط الأساسية موثقة","التناقضات المهمة موضحة","الأمثلة قابلة لإعادة الإنتاج"],
      sequence:["استلام المواصفات/الكود","بناء المخطط","تشغيل فحوص الاتساق","إضافة الأمثلة","تسليم changelog"],
      buyer:"فريق تطوير / وكالة برمجية",
      questions:["ما المصدر المرجعي للـAPI؟","هل توجد نسخة OpenAPI حالية؟","ما الأجزاء خارج النطاق؟"],
      proof:["lint output","sample requests","change log"]
    },
    python:{
      deliverables:["أداة Python قابلة للتشغيل","README","اختبارات smoke/edge","تعليمات إعداد"],
      acceptance:["تشغيل ناجح على البيئة المتفق عليها","المخرجات تطابق العينة","الحالات الحدية مغطاة","التشغيل قابل للتكرار"],
      sequence:["تثبيت inputs/outputs","تنفيذ أصغر نسخة","اختبار","تقوية الحالات الحدية","تسليم"],
      buyer:"عميل أتمتة/بيانات/تطوير",
      questions:["ما المدخلات؟","ما المخرج المطلوب؟","هل توجد قيود بيئة/نظام تشغيل؟"],
      proof:["working demo","test output","README"]
    },
    audit:{
      deliverables:["تقرير تدقيق","أولويات إصلاح","أمثلة قبل/بعد","قائمة تحقق للتحقق"],
      acceptance:["كل توصية مرتبطة بدليل","وضوح ما هو مؤكد وما هو تقديري","أمثلة قابلة للمراجعة"],
      sequence:["تحديد العينة","جمع الأدلة","تصنيف المشكلات","اقتراح الإصلاحات","مراجعة نهائية"],
      buyer:"مالك موقع/محتوى/وكالة",
      questions:["ما الصفحات/المخرجات المستهدفة؟","ما معيار النجاح؟","هل توجد قيود نشر؟"],
      proof:["sample audit","scored checklist","before/after examples"]
    },
    research:{
      deliverables:["خريطة مصادر","ملخص تنفيذي","جدول أدلة","مذكرة خطوة تالية"],
      acceptance:["المعلومات حديثة بما يكفي للسياق","المصادر قابلة للمراجعة","الشكوك مفصولة عن الحقائق"],
      sequence:["تحديد السؤال","جمع المصادر","cross-check","صياغة الخلاصة","مراجعة القيود"],
      buyer:"عميل بحث/استراتيجية/محتوى",
      questions:["ما القرار الذي سيُستخدم له البحث؟","ما الفترة الزمنية؟","ما المصادر غير المقبولة؟"],
      proof:["source map","cross-check notes","uncertainty log"]
    },
    connector:{
      deliverables:["تكامل أو connector","mapping specification","معالجة أخطاء","اختبارات idempotency"],
      acceptance:["البيانات تنتقل بالشكل المتفق عليه","الأخطاء قابلة للتشخيص","إعادة التشغيل لا تسبب تكرارًا غير مقصود"],
      sequence:["تعريف العقد","mapping","تنفيذ المسار","اختبار الفشل","تسليم"],
      buyer:"شركة/وكالة تحتاج ربط أنظمة",
      questions:["ما النظامان؟","ما schema المدخل/المخرج؟","ما حدود المعدل والصلاحيات؟"],
      proof:["contract tests","failure simulation","idempotency check"]
    }
  };
  const p=packs[kind];
  const hours=n(a?.estimated_hours)||12;
  const net=n(a?.estimated_net_after_reserve_usd)||n(o.expected_value);
  const eff=hours>0?Number((net/hours).toFixed(2)):0;
  const blockers=Array.isArray(a?.blocking_reasons)?a.blocking_reasons.slice(0,8):[];
  blockers.push("القبول أو الدفع الخارجي ليس مضمونًا؛ يجب التحقق من شروط المصدر قبل بدء العمل.");
  const title=clean(o.title,220);
  const proposal =
    "أستطيع تنفيذ «"+title+"» بنطاق واضح وتسليم قابل للتحقق. سأبدأ بتثبيت المتطلبات، ثم أقدم نسخة صغيرة قابلة للاختبار، وبعدها أوثق الاختبارات والنتيجة. قبل بدء عمل ذي تكلفة زمنية كبيرة، نثبت النطاق وشروط القبول والدفع.";
  return {
    title,
    money_thesis:"الفرصة اجتازت بوابة الجاهزية الحالية، لذلك الأفضل تحويلها من رابط إلى حزمة تنفيذ قصيرة ومثبتة بدل البدء مباشرة في عمل مفتوح.",
    buyer_or_market:p.buyer,
    action_url:(o.offer?.url||o.offer?.action_url||o.evidence?.url||o.metadata?.url||o.metadata?.action_url||null),
    estimated_net_usd:net,
    estimated_hours:hours,
    efficiency_usd_per_hour:eff,
    deliverables:p.deliverables,
    acceptance_tests:[...p.acceptance,...commonQA],
    blockers,
    proof_points:[...p.proof,...caps.map((c:any)=>c.name||c.slug).filter(Boolean).slice(0,4)],
    work_sequence:p.sequence,
    payment_plan:{
      recommended:["تثبيت النطاق","تأكيد شرط القبول","تأكيد وسيلة الدفع","بدء التنفيذ","تسليم + إثبات"],
      crypto_first:true,
      direct_client_deposit:"مستحسن عند العقود المباشرة، بحسب اتفاق الطرفين",
      note:"هذا تنظيم للدفع وليس ضمانًا للدفع."
    },
    proposal_draft:proposal,
    client_questions:p.questions,
    qa_checklist:commonQA,
    metadata:{builder:"miae_income_factory_v1",kind,source:o.source,opportunity_score:n(o.score),delivery_confidence:n(a?.delivery_confidence)}
  };
}

async function blueprint(opportunityId:string){
  const {data:o,error:oe}=await db.from("opportunities")
    .select("id,user_id,source,title,score,status,opportunity_type,description,confidence,expected_value,evidence,offer,metadata")
    .eq("id",opportunityId).maybeSingle();
  if(oe||!o) return {ok:false,error:"opportunity_not_found"};
  const {data:a}=await db.from("midad_work_assessments")
    .select("id,execution_decision,delivery_confidence,estimated_hours,estimated_net_after_reserve_usd,blocking_reasons,matched_capabilities")
    .eq("opportunity_id",opportunityId).order("assessed_at",{ascending:false}).limit(1).maybeSingle();
  if(a?.execution_decision!=="ELIGIBLE" || n(a?.delivery_confidence)<0.75 || n(a?.estimated_hours)>12)
    return {ok:false,error:"opportunity_not_fast_cash_eligible",gate:a||null};
  const {data:caps}=await db.from("midad_capabilities").select("slug,name,active").eq("active",true).limit(20);
  const b=blueprintFor(o,a,caps||[]);
  const {data:saved,error:se}=await db.from("midad_income_blueprints")
    .upsert({user_id:o.user_id,opportunity_id:opportunityId,assessment_id:a?.id||null,state:"READY",...b,updated_at:new Date().toISOString()},{onConflict:"opportunity_id"})
    .select("*").single();
  if(se) return {ok:false,error:"blueprint_persist_failed",detail:se.message};
  return {ok:true,blueprint:saved};
}

async function playbooks(){
  const {data,error}=await db.from("midad_revenue_playbooks").select("*").eq("active",true).order("target_price_max_usd",{ascending:false});
  return {ok:!error,playbooks:data||[],error:error?.message||null};
}

Deno.serve(async(req:Request)=>{
  try{
    if(req.method==="OPTIONS") return json(null,204);
    if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
    const body=await req.json().catch(()=>({}));
    if(!(await authorize(clean(body?.token,300),req))) return json({ok:false,error:"session_expired"},401);
    const action=clean(body?.action||body?.operation,60);
    if(action==="prepare_blueprint") return json(await blueprint(clean(body?.opportunity_id,100)));
    if(action==="playbooks") return json(await playbooks());
    return json({ok:false,error:"unsupported_action",action},400);
  }catch(e){ return json({ok:false,error:"income_factory_unexpected_error",detail:String(e).slice(0,300)},500); }
});