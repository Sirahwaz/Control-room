import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import postgres from "npm:postgres@3.4.7";
async function sha256(s:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("");}
const CONTROL_ROOM_URL="https://sirahwaz.github.io/Control-room/?bot=aimidad&view=cockpit&v=20260930emergencypp2";
const AI_ROOM_PREVIEW_URL="https://sirahwaz.github.io/Control-room/ai-room.html";
const BOT_OPS_URL="https://sirahwaz.github.io/Control-room/?bot=aimidad&view=bots&v=20260930emergencypp2";
const DATABASE_URL=Deno.env.get("SUPABASE_DB_URL")||"";
const DB=DATABASE_URL?postgres(DATABASE_URL,{max:1,idle_timeout:5,connect_timeout:10,ssl:"require",prepare:false}):null;
function needDb(){if(!DB)throw new Error("supabase_db_url_missing");return DB;}
const TRADING_URL="https://sirahwaz.github.io/Control-room/?bot=viabtc&view=trading&v=20260930emergencypp2";
async function telegramApi(token:string,method:string,body:any){const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));return {ok:r.ok&&j?.ok===true,result:j?.result,error:j?.description||""};}
async function runGroundedTelegramAI(prompt:string){const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";if(!url||!sk||!ik)return {ok:false,error:"ai_router_not_configured"};const r=await fetch(url+"/functions/v1/midad_control_room",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({action:"ai_assist",prompt,ai_mode:"system"})});const text=await r.text();let j:any={};try{j=JSON.parse(text)}catch{j={raw:text}};if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("AI HTTP "+r.status)};return {ok:true,answer:j?.answer||j?.final||j?.message||""};}
async function runResearch(prompt:string){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk||!ik)return {ok:false,error:"research_router_not_configured",answer:""};
  const r=await fetch(url+"/functions/v1/midad_research_center",{
    method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},
    body:JSON.stringify({query:prompt,language:"ar"})
  });
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("Research HTTP "+r.status),answer:""};
  return {ok:true,answer:j?.answer||"",run_id:j?.run_id||null,sources:j?.sources||[],stats:j?.stats||{}};
}
async function runNeuralCore(prompt:string){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk||!ik)return {ok:false,error:"neural_core_not_configured"};
  const r=await fetch(url+"/functions/v1/midad_neural_core",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({query:prompt,mode:"full"})});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("Neural HTTP "+r.status)};
  return {ok:true,...j};
}
async function runNeuralStatus(){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  const r=await fetch(url+"/functions/v1/midad_neural_status",{method:"GET",headers:{"authorization":"Bearer "+sk,"x-midad-ingest-key":ik}});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("Status HTTP "+r.status)};
  return {ok:true,...j};
}
async function runHypothesisLab(){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ak=Deno.env.get("MIDAD_AUTONOMY_KEY")||"";
  const r=await fetch(url+"/functions/v1/midad_hypothesis_lab",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-autonomy-key":ak},body:"{}"});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  if(!r.ok||j?.ok===false)return {ok:false,error:j?.error||j?.message||("Lab HTTP "+r.status)};
  return {ok:true,...j};
}

async function runFinanceStatus(){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk)return {ok:false,error:"finance_station_not_configured"};
  const r=await fetch(url+"/functions/v1/midad_finance_station",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({action:"autonomy_status"})});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return r.ok?j:{ok:false,error:j?.error||"finance_station_http_"+r.status};
}
async function runNoncopyTradeTelegram(){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk)return {ok:false,error:"trade_engine_not_configured"};
  const r=await fetch(url+"/functions/v1/midad_noncopy_trading_engine",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify({mode:"run"})});
  const t=await r.text();let j:any={};try{j=JSON.parse(t)}catch{j={raw:t}};
  return r.ok?j:{ok:false,error:j?.error||"trade_http_"+r.status};
}

async function botSnapshot(){
  const d=needDb();
  const [signals,opps,tasks,approvals,money,recovery,mining]=await Promise.all([
    d`select count(*)::int as n from public.signal_events`,
    d`select count(*)::int as n from public.opportunities where status <> 'test'`,
    d`select id,title,status from public.midad_human_tasks where status in ('OPEN','ACKNOWLEDGED') order by priority desc limit 5`,
    d`select count(*)::int as n from public.midad_approvals where status='pending'`,
    d`select id,title,source_slug,amount_usd,score,status,url from public.midad_income_discoveries where status <> 'test' order by score desc limit 5`,
    d`select id,original_title,trigger_state,trigger_reason,recovery_state,original_expected_value_usd from public.midad_recovery_cases where recovery_state <> 'CLOSED' order by updated_at desc limit 5`,
    d`select id,provider,coin,label,status,read_only,last_hashrate_ths,last_worker_count,last_snapshot_at from public.midad_mining_accounts order by updated_at desc limit 8`
  ]);
  return {
    signals:Number(signals[0]?.n||0),opportunities:Number(opps[0]?.n||0),
    open_tasks:tasks||[],pending_approvals:Number(approvals[0]?.n||0),
    money:money||[],recovery:recovery||[],mining:mining||[]
  };
}
async function runForge(a,p){const u=Deno.env.get('SUPABASE_URL')||'',k=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',i=Deno.env.get('MIDAD_INGEST_KEY')||'';if(!u||!k||!i)return {ok:false,error:'forge_router_not_configured'};const r=await fetch(u+'/functions/v1/midad_forge',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+k,'x-midad-ingest-key':i},body:JSON.stringify(Object.assign({action:a},p||{}))});const t=await r.text();let j={};try{j=JSON.parse(t)}catch(_){j={raw:t}}if(!r.ok||j.ok===false)return {ok:false,error:j.error||j.message||('Forge HTTP '+r.status)};return Object.assign({ok:true},j)}

async function runForgeCoordinator(payload){
  const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",ik=Deno.env.get("MIDAD_INGEST_KEY")||"";
  if(!url||!sk||!ik)return {ok:false,error:"forge_coordinator_not_configured"};
  const r=await fetch(url+"/functions/v1/midad_forge_coordinator",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+sk,"x-midad-ingest-key":ik},body:JSON.stringify(payload||{})});
  const t=await r.text();let j={};try{j=JSON.parse(t)}catch(_){j={raw:t}}
  if(!r.ok||j.ok===false)return {ok:false,error:j.error||j.message||("Coordinator HTTP "+r.status)};
  return Object.assign({ok:true},j);
}
async function configureTelegramControl(token:string,botId:string,webhookSecret:string|undefined){const commands=[{command:"start",description:"فتح مركز تحكم MIDAD"},
{command:"airoom",description:"غرفة الذكاء المتعدد (معاينة)"},{command:"menu",description:"القائمة الرئيسية"},{command:"bots",description:"شبكة البوتات"},{command:"status",description:"حالة النظام"},{command:"money",description:"مسار الدخل"},{command:"recovery",description:"استرداد الإيرادات"},{command:"radar",description:"الرادار والإشارات"},{command:"opportunities",description:"الفرص الحالية"},{command:"revenue",description:"مركز الإيرادات"},{command:"mining",description:"حالة التعدين"},{command:"osint",description:"تشغيل OSINT"},{command:"automation",description:"الأتمتة والوكلاء"},{command:"wallets",description:"المحافظ"},{command:"health",description:"صحة النظام"},{command:"research",description:"مركز البحوث"},{command:"neural",description:"Neural Core"},{command:"curiosity",description:"محرك الفضول"},{command:"lab",description:"مختبر الفرضيات"},{command:"ask",description:"اسأل MIDAD"},{command:"forge",description:"مصنع البناء والبرمجة"},{command:"forge_status",description:"حالة مصنع البناء"},{command:"forge_queue",description:"طابور البناء"},{command:"control",description:"فتح غرفة التحكم"},{command:"keys",description:"إدارة MIDADKeys"},{command:"ugig",description:"Worker / uGig"},{command:"trade",description:"Trading Lab غير تقليدي"},{command:"mysun",description:"MYSUN evidence mode"},{command:"botops",description:"إدارة البوتات"}];const menu=await telegramApi(token,"setMyCommands",{commands});const button=await telegramApi(token,"setChatMenuButton",{menu_button:{type:"web_app",text:"MIDAD Control Room",web_app:{url:CONTROL_ROOM_URL}}});const webhookEnabled=Deno.env.get("TELEGRAM_ENABLE_WEBHOOK")==="true";const webhook=webhookEnabled?await telegramApi(token,"setWebhook",{url:Deno.env.get("SUPABASE_URL")+"/functions/v1/telegram_bot?bot_id="+encodeURIComponent(botId),allowed_updates:["message","callback_query"],...(webhookSecret?{secret_token:webhookSecret}:{})}):{ok:true,skipped:true};return {commands_ok:menu.ok,menu_button_ok:button.ok,webhook_ok:webhook.ok,webhook_enabled:webhookEnabled};}
Deno.serve(async(req:Request)=>{try{if(req.method!=="POST"&&!(req.method==="GET"&&["setup","repair_webhook","repair_miniapp"].includes(new URL(req.url).searchParams.get("action")||"")))return new Response("ok",{status:200});const u=new URL(req.url),botId=u.searchParams.get("bot_id");if(!botId)return new Response(JSON.stringify({error:"Missing bot_id"}),{status:400});const webhookSecret=Deno.env.get("TELEGRAM_WEBHOOK_SECRET");const isRepair=["repair_webhook","repair_miniapp"].includes(u.searchParams.get("action")||"");if(!isRepair&&webhookSecret&&req.headers.get("x-telegram-bot-api-secret-token")!==webhookSecret)return new Response("forbidden",{status:403});const url=Deno.env.get("SUPABASE_URL")||"",sk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",telegramToken=(Deno.env.get("AIMIDAD_BOT_TOKEN")||Deno.env.get("TELEGRAM_BOT_TOKEN")||"").trim();const d=needDb();const botRows=await d`select id,business_name,telegram_bot_token,dialect,tone,business_context,active,platform from public.bot_configs where id=${botId}::uuid and active=true and platform='telegram' limit 1`;const bot=botRows[0]||null;if(!bot)return new Response(JSON.stringify({error:"Bot not found or inactive"}),{status:404});if(u.searchParams.get("action")==="diagnose"){const supplied=req.headers.get("x-midad-autonomy-key")||"";const keyRows=await d`select decrypted_secret from vault.decrypted_secrets where name='midad_autonomy_key' order by updated_at desc limit 1`;const expected=String(keyRows[0]?.decrypted_secret||"");if(!supplied||!expected||(await sha256(supplied))!==(await sha256(expected)))return new Response(JSON.stringify({ok:false,error:"unauthorized"}),{status:401,headers:{"content-type":"application/json"}});const testToken=String(bot.telegram_bot_token||telegramToken||"").trim();if(!testToken)return new Response(JSON.stringify({ok:false,service:"telegram_bot",version:97,database_connected:true,bot_id:bot.id,token_present:false,error:"telegram_token_missing"}),{status:503,headers:{"content-type":"application/json"}});const identity=await telegramApi(testToken,"getMe",{});return new Response(JSON.stringify({ok:identity.ok,service:"telegram_bot",version:97,database_connected:true,bot_id:bot.id,business_name:bot.business_name,token_source:bot.telegram_bot_token?"bot_configs":(Deno.env.get("AIMIDAD_BOT_TOKEN")?"AIMIDAD_BOT_TOKEN":"TELEGRAM_BOT_TOKEN"),token_present:true,token_valid:identity.ok,telegram_username:identity.result?.username||null,telegram_error:identity.ok?null:(identity.error||"getMe_failed")}),{status:identity.ok?200:502,headers:{"content-type":"application/json"}});}const setupKey=req.headers.get("x-midad-control-key")||u.searchParams.get("access_hash");if(isRepair){if(!setupKey)return new Response("forbidden",{status:403});const kh=setupKey.length===64?setupKey:await sha256(setupKey);const accessRows=await needDb()`select id from public.control_room_access where key_hash=${kh} and active=true limit 1`;if(!accessRows.length)return new Response("forbidden",{status:403});const activeTelegramToken=telegramToken||bot.telegram_bot_token;if(!activeTelegramToken)return new Response(JSON.stringify({ok:false,error:"telegram token missing"}),{status:503,headers:{"content-type":"application/json"}});const configured=await configureTelegramControl(activeTelegramToken,botId,webhookSecret);return new Response(JSON.stringify({ok:!!(configured.commands_ok&&configured.menu_button_ok&&configured.webhook_ok),repair:"miniapp",menu_url:CONTROL_ROOM_URL,...configured}),{headers:{"content-type":"application/json"}});}const update=await req.json(),msg=update?.message,callback=update?.callback_query;const chatId=msg?.chat?.id||callback?.message?.chat?.id;const activeTelegramToken=bot.telegram_bot_token||telegramToken;if(activeTelegramToken){try{await configureTelegramControl(activeTelegramToken,botId,webhookSecret);}catch(_){} }let userText=typeof msg?.text==="string"?msg.text.trim():"";if(callback){userText=typeof callback.data==="string"?callback.data:"";try{await telegramApi(activeTelegramToken,"answerCallbackQuery",{callback_query_id:callback.id});}catch(_){}}const webData=typeof msg?.web_app_data?.data==="string"?msg.web_app_data.data:"";if(!chatId)return new Response("ok",{status:200});
const ownerRows=await needDb()`select id from public.control_room_access where telegram_user_id=${String(chatId)} and active=true limit 1`;
if(!ownerRows.length){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"🔒 هذا البوت خاص بمشغّل MIDAD ولا يتيح وصولًا عامًا.",disable_web_page_preview:true});return new Response("ok",{status:200});}if(userText==="menu:money"){
  const s=await botSnapshot();
  const out=s.money.length
    ?"💰 Money Hunter\n\n"+s.money.map((x:any,i:number)=>(i+1)+") "+String(x.title||"Opportunity")+" · score "+String(x.score??"—")+" · "+String(x.source_slug||"source")).join("\n")
    :"لا توجد اكتشافات دخل محفوظة حاليًا.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:neural"){
  const s=await runNeuralStatus();
  const out=s.ok
    ?"🧠 Neural Core\n\nالذاكرة: "+String(s.memory?.knowledge_nodes||0)+" عقد / "+String(s.memory?.knowledge_edges||0)+" روابط\nالفرضيات: "+String(s.hypothesis_lab?.proposed||0)+" مقترحة · "+String(s.hypothesis_lab?.testing||0)+" قيد الاختبار · "+String(s.hypothesis_lab?.supported||0)+" مدعومة"
    :"تعذر قراءة Neural Core: "+String(s.error||"unknown");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:radar"||userText==="/radar"||userText==="/osint"){
  const ai=await runGroundedTelegramAI("افحص الرصد وOSINT في MIDAD الآن. اذكر فقط الإشارات/الحالات المثبتة، ما الذي يعنيه ذلك، وما الخطوة التالية للتحقق.");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:ai.ok&&ai.answer?ai.answer:"تعذر تشغيل ملخص الرصد: "+(ai.error||"unknown"),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:opps"){
  const s=await botSnapshot();
  const out=s.money.length
    ?"🎯 أعلى الفرص/الاكتشافات الحالية:\n\n"+s.money.map((x:any,i:number)=>(i+1)+") "+String(x.title||"Opportunity")+" · score "+String(x.score??"—")+" · "+String(x.source_slug||"source")).join("\n")
    :"لا توجد اكتشافات محفوظة حاليًا.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:revenue"){
  const s=await botSnapshot();
  const out=s.recovery.length
    ?"♻️ Revenue Recovery: "+s.recovery.length+" حالة مفتوحة.\n\n"+s.recovery.slice(0,5).map((x:any,i:number)=>(i+1)+") "+String(x.original_title||"Case")+" · "+String(x.recovery_state||"—")).join("\n")
    :"💰 لا توجد حالات استرداد مفتوحة حاليًا.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:mining"){
  const s=await botSnapshot();
  const out=s.mining.length
    ?"₿ ViaBTC Monitor\n\n"+s.mining.slice(0,6).map((x:any)=>
      "• "+String(x.label||x.provider||"account")+" · "+String(x.status||"—")+" · "+
      (x.last_hashrate_ths!=null?String(x.last_hashrate_ths)+" TH/s":"hashrate —")
    ).join("\n")
    :"لا توجد حسابات تعدين مسجلة.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="menu:research"){
  const research=await runResearch("ما أهم موضوع بحثي تشغيلي يمكن أن يحسن دخل MIDAD الآن؟");
  const out=research.ok&&research.answer?String(research.answer):"تعذر تشغيل مركز البحوث: "+String(research.error||"unknown");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="forge:help"){
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"🧰 MIDAD Forge\n\n/forge وصف المهمة — إدخال طلب بناء\n/forge_status RUN_ID — حالة البناء\n/forge_queue — الطابور\n\nأي تغيير خارجي أو نشر حساس يبقى خاضعًا لبوابات MIDAD.",disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/wallets"){
  const ai=await runGroundedTelegramAI("ما هي حالة المحافظ والتسوية في MIDAD الآن؟ افصل بوضوح بين الرصد والاستلام وأي إجراء يحتاج موافقة بشرية.");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:ai.ok&&ai.answer?ai.answer:"تعذر فحص المحافظ: "+(ai.error||"unknown"),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText.split("@")[0]==="/airoom"){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"🧠 MIDAD AI Room — معاينة آمنة\n\nواجهة اختبار منفصلة. الاتصال الحي اختياري ويتطلب حساب Telegram مخوّلاً؛ البيانات المعروضة مجمّعة للقراءة فقط ولا توجد أوامر كتابة أو عمليات مالية.",reply_markup:{inline_keyboard:[[{text:"🧠 فتح AI Room (Preview)",web_app:{url:AI_ROOM_PREVIEW_URL}}]]},disable_web_page_preview:true});return new Response("ok",{status:200});}if(userText==="/start"||userText==="/menu"||userText==="/control"){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"🤖 MIDAD Control Center\n\nافتح غرفة التحكم من الزر أدناه.",reply_markup:{inline_keyboard:[[{text:"🚀 فتح MIDAD Control Room",web_app:{url:CONTROL_ROOM_URL}}],[{text:"📡 الرادار",callback_data:"menu:radar"},{text:"🎯 الفرص",callback_data:"menu:opps"}],[{text:"💰 المال",callback_data:"menu:money"},{text:"♻️ الإيرادات",callback_data:"menu:revenue"}],[{text:"⛏ التعدين",callback_data:"menu:mining"},{text:"♟️ Trading Lab",web_app:{url:TRADING_URL}}],[{text:"⬡ Bot Ops",web_app:{url:BOT_OPS_URL}},{text:"🧠 Neural",callback_data:"menu:neural"}],[{text:"🧪 البحث",callback_data:"menu:research"},{text:"🧰 Forge",callback_data:"forge:help"}],[{text:"🛡 MIDADKeys",web_app:{url:"https://froegigfmpmvtecztfb.supabase.co/functions/v1/midad_keys_bot?webapp=addkey&v=1"}}]]},disable_web_page_preview:true});return new Response("ok",{status:200});}
if(userText==="/forge"||userText.startsWith("/forge ")||userText==="/build"||userText.startsWith("/build ")){const q=userText.startsWith("/forge")?userText.slice(6).trim():userText.slice(6).trim();if(!q){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"MIDAD Forge: اكتب طلب البناء بعد /forge",disable_web_page_preview:true});return new Response("ok",{status:200});}const f=await runForgeCoordinator({prompt:q,goal:q,mode:"research_build",requested_by:String(chatId)});const m=f.ok?"تم إدخال المهمة إلى MIDAD Forge. ID: "+String(f.run_id):"تعذر إدخال المهمة: "+String(f.error||"unknown");await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:m,disable_web_page_preview:true});return new Response("ok",{status:200});}

if(userText.startsWith("/forge_status ")){
  const id=userText.slice(14).trim();
  const f=await runForge("status",{run_id:id});
  let m="🧰 Forge Status\n";
  if(!f.ok)m+="Error: "+String(f.error||"unknown");
  else{const x=f.run||{};m+="ID: "+String(x.id)+"\nStatus: "+String(x.status)+"\nApp: "+String((x.spec&&x.spec.app_name)||x.goal||"-");if(x.pr_url)m+="\nPR: "+String(x.pr_url);if(x.error)m+="\nError: "+String(x.error);}
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:m.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/forge_queue"){
  const f=await runForge("queue",{});
  let m="🧰 Forge Queue\n";
  if(!f.ok)m+="Error: "+String(f.error||"unknown");
  else{const a=Array.isArray(f.runs)?f.runs.slice(0,6):[];if(!a.length)m+="Empty";else for(let i=0;i<a.length;i++){m+=(i+1)+") "+String(a[i].status)+" | "+String(a[i].mode)+"\n"+String(a[i].prompt||"").slice(0,140)+"\nID: "+String(a[i].id)+"\n";}}
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:m.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}

if(userText==="/keys"){
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"🛡 MIDADKeys\n\nGateway الإدارة متاح، بينما Bot Token غير متاح في مسار poller الحالي. افتح الواجهة لفحص الهويات والقدرات دون عرض الأسرار.",reply_markup:{inline_keyboard:[[{text:"🛡 فتح MIDADKeys",web_app:{url:"https://froegigfmpmvtecztfb.supabase.co/functions/v1/midad_keys_bot?webapp=addkey&v=1"}}]]},disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/trade"||userText==="/mysun"){
  const j=await runNoncopyTradeTelegram();
  if(!j?.ok){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"♟️ Trading Lab blocked: "+String(j?.error||"unknown"),disable_web_page_preview:true});return new Response("ok",{status:200});}
  const s=j.signal||{},r=j.risk||{},m=j.mining||{},e=j.evidence||{};
  const prefix=userText==="/mysun"?"🏴‍☠️♾️👿 MYSUN EVIDENCE MODE\n\n":"♟️ NON-COPY TRADE INTELLIGENCE\n\n";
  const out=prefix+
    "BTC: "+String(s.direction||"NEUTRAL")+" · Confidence "+(Number(s.confidence||0)*100).toFixed(1)+"%\n"+
    "Entry: "+String(s.entry??"—")+" · Stop: "+String(s.stop??"—")+" · TP: "+String(s.take_profit??"—")+"\n"+
    "Risk: "+String(r.class||"—")+" · Gate: "+String(r.gate_decision||"—")+"\n"+
    "Mining: "+String(m.state||"—")+"\n"+
    "Sources: "+String((e.market_sources||[]).map((x:any)=>x.source).join(", ")||"—")+"\n"+
    "Paper: "+(j.paper_trade?String(j.paper_trade.status):"NOT_CREATED")+"\n\n"+
    "No copy-trading. No live orders.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/botops"){
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"⬡ Bot Operations\n\nإدارة @ahwazai_bot و @aimidad_bot و @viabtc_monitor من غرفة واحدة.\n\nافتح Bot Ops لإدارة السياقات والتشخيص.",reply_markup:{inline_keyboard:[[{text:"⬡ فتح Bot Ops",web_app:{url:BOT_OPS_URL}}]]},disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/ugig"){
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"◎ uGig Worker\n\nProfile · applications · invoices · notifications عبر MIDAD Gateway. افتح Control Room لإدارة المسار ومراجعة الجاهزية.",reply_markup:{inline_keyboard:[[{text:"◎ فتح Control Room",web_app:{url:CONTROL_ROOM_URL}}]]},disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/help"){
  const out="🤖 MIDAD Help\n\n"+
    "/start أو /menu — مركز التحكم\n"+
    "/bots — شبكة البوتات\n"+
    "/finance — Finance Station / Governor / Decision Ledger\n"+
    "/status أو /health — الحالة التشغيلية\n"+
    "/money أو /opportunities — مسار الدخل\n"+
    "/revenue أو /recovery — الاسترداد والإيرادات\n"+
    "/radar أو /osint — الرصد\n"+
    "/mining — ViaBTC\n"+
    "/research — بحث موثق\n"+
    "/neural /curiosity /lab — طبقة الذكاء\n"+
    "/ask سؤال — اسأل Neural++\n"+
    "/forge وصف — طلب بناء\n"+
    "/forge_status ID — حالة البناء\n"+
    "/forge_queue — طابور البناء\n\n"+
    "كل الأفعال الحساسة تبقى خلف بوابات MIDAD والموافقة البشرية عند الحاجة.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/bots"){
  const s=await botSnapshot();
  const lines=[
    "🤖 MIDAD Bot Fabric",
    "",
    "🧠 Neural Core / Research / Curiosity / Lab",
    "💰 Money Hunter / Income Factory / Recovery",
    "🛡 MIDADKeys / Identity & leases",
    "◎ uGig Worker / applications / invoices",
    "₿ ViaBTC Monitor / telemetry",
    "✦ Forge / build queue / status",
    "",
    "الحالة: "+(chatId?"OWNER VERIFIED":"UNKNOWN"),
    "الإشارات: "+s.signals+" · الفرص: "+s.opportunities,
    "مهامك المفتوحة: "+s.open_tasks.length+" · موافقات: "+s.pending_approvals,
    "استخدم /help أو /menu لاستدعاء الواجهات."
  ];
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:lines.join("\n"),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/finance"){
  const s=await runFinanceStatus();
  if(!s?.ok){await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:"💥 Finance Station unavailable: "+String(s?.error||"unknown"),disable_web_page_preview:true});return new Response("ok",{status:200});}
  const g=s.governor||{}, latest=(Array.isArray(s.cycles)?s.cycles:[])[0]||{};
  const ledger=Array.isArray(s.ledger)?s.ledger:[], outbox=Array.isArray(s.outbox)?s.outbox:[];
  const msg="₿ <b>MIDAD Finance Station</b>\n\n"+
    "Mode: <b>"+String(g.mode||"paper")+"</b>\n"+
    "Governor: "+(g.enabled?"ON":"OFF")+" · Kill Switch: "+(g.kill_switch?"ON":"OFF")+"\n"+
    "Max Order: $"+String(g.max_order_usd??"—")+" · Daily Loss: $"+String(g.max_daily_loss_usd??"—")+"\n"+
    "Principal Floor: $"+String(g.principal_floor_usd??"—")+"\n\n"+
    "Latest Signal: "+String(latest.signal_direction||"—")+" · "+(Number(latest.signal_confidence||0)*100).toFixed(1)+"%\n"+
    "Decision: "+String(latest.decision||"—")+"\n"+
    "Cycles: "+(Array.isArray(s.cycles)?s.cycles.length:0)+" · Ledger: "+ledger.length+"\n"+
    "Outbox: "+outbox.filter((x:any)=>x.delivery_status==="queued").length+" queued · "+outbox.filter((x:any)=>x.delivery_status==="sent").length+" sent\n\n"+
    "🔒 Live execution remains closed.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:msg.slice(0,3900),parse_mode:"HTML",disable_web_page_preview:true});
  return new Response("ok");
}
if(userText==="/status"||userText==="/health"){
  const s=await botSnapshot();
  const top=s.open_tasks.slice(0,3).map((x:any,i:number)=>(i+1)+") "+String(x.title||"Task")).join("\n");
  let out="🩺 MIDAD System Status\n\n";
  out+="Signals: "+s.signals+"\nOpportunities: "+s.opportunities+"\nOpen human tasks: "+s.open_tasks.length+"\nPending approvals: "+s.pending_approvals+"\n";
  out+="Money discoveries: "+s.money.length+" shown\nRecovery cases: "+s.recovery.length+" open\nLive mining records: "+s.mining.filter((x:any)=>x.status==="connected").length+"\n";
  if(top)out+="\n👤 أهم التدخلات:\n"+top;
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/money"||userText.startsWith("/money ")){
  const s=await botSnapshot();
  let out="💰 MIDAD Money Hunter\n\n";
  if(!s.money.length) out+="لا توجد اكتشافات دخل محفوظة حاليًا.";
  else out+=s.money.map((x:any,i:number)=>(i+1)+") "+String(x.title||"Untitled")+"\n   "+String(x.source_slug||"source")+" · score "+String(x.score??"—")+" · "+(x.amount_usd!=null?"$"+String(x.amount_usd):"قيمة غير مثبتة")+"\n   "+String(x.status||"discovered")).join("\n");
  out+="\n\nتنبيه: الاكتشاف لا يعني قبولًا أو تقديمًا.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/mining"){
  const s=await botSnapshot();
  let out="₿ ViaBTC Monitor\n\n";
  if(!s.mining.length) out+="لا توجد حسابات تعدين مسجلة.";
  else out+=s.mining.slice(0,6).map((x:any)=>
    "• "+String(x.label||x.provider||"account")+" · "+String(x.status||"—")+" · "+
    (x.last_hashrate_ths!=null?String(x.last_hashrate_ths)+" TH/s":"hashrate غير متوفر")+" · workers "+String(x.last_worker_count??"—")
  ).join("\n");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/recovery"||userText==="/revenue"){
  const s=await botSnapshot();
  let out="♻️ MIDAD Revenue Recovery / Revenue\n\n";
  if(!s.recovery.length) out+="لا توجد حالات استرداد مفتوحة.";
  else out+=s.recovery.map((x:any,i:number)=>(i+1)+") "+String(x.original_title||"Case")+"\n   state="+String(x.recovery_state||"—")+" · trigger="+String(x.trigger_state||"—")+"\n   "+String(x.trigger_reason||"")).join("\n");
  out+="\n\nالتحصيل والتنفيذ الخارجيان يبقيان خلف بوابة الموافقة.";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/opportunities"){
  const s=await botSnapshot();
  let out="🎯 Opportunities\n\n";
  if(!s.money.length) out+="لا توجد نتائج دخل مكتشفة محفوظة هنا.";
  else out+=s.money.map((x:any,i:number)=>(i+1)+") "+String(x.title||"Opportunity")+" · "+String(x.source_slug||"source")+" · score "+String(x.score??"—")).join("\n");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/automation"){
  const ai=await runGroundedTelegramAI("ما حالة الأتمتة والوكلاء في MIDAD الآن؟ اذكر فقط ما هو مثبت، العوائق، والخطوة البشرية التالية.");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:ai.ok&&ai.answer?ai.answer:"تعذر فحص الأتمتة: "+(ai.error||"unknown"),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/research"||userText.startsWith("/research ")){
  const q=userText.replace(/^\/research\s*/i,"").trim()||"ما أهم الفرص الحالية القابلة للتحول إلى دخل، وما الأدلة والخطوات العملية للتحقق منها؟";
  const research=await runNeuralCore(q);
  const header=research.ok?"🧠 MIDAD Research Center × Neural Core\n\n":"⚠️ Research Center\n\n";
  let body="";
  if(research.ok){
    body=String(research.executive_summary||"تمت الجولة البحثية دون خلاصة قابلة للعرض.");
    const hs=Array.isArray(research.hypotheses)?research.hypotheses.slice(0,3):[];
    if(hs.length) body+="\n\n🧪 فرضيات للاختبار:\n"+hs.map((h:any,i:number)=>(i+1)+") "+String(h.statement||"")+
      " [N:"+Number(h.novelty||0).toFixed(2)+", C:"+Number(h.confidence||0).toFixed(2)+"]").join("\n");
    const links=Array.isArray(research.cross_domain_links)?research.cross_domain_links.slice(0,3):[];
    if(links.length) body+="\n\n🧬 وصلات عابرة للمجالات:\n"+links.map((l:any)=>String(l.from)+" → "+String(l.to)+" | "+String(l.relation||"link")).join("\n");
  }else body="تعذر تشغيل مركز البحوث العصبي: "+(research.error||"unknown");
  const tail=research.ok&&Array.isArray(research.sources)&&research.sources.length?"\n\n📚 المصادر: "+research.sources.slice(0,8).map((s:any,i:number)=>"["+String(s.key||("S"+(i+1)))+"] "+String(s.title||s.domain||"source")).join(" · "):"";
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:(header+body+tail).slice(0,4000),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}if(userText==="/neural"){
  const s=await runNeuralStatus();
  let textOut="🧠 MIDAD Neural Core\n\n";
  if(!s.ok) textOut+="تعذر قراءة الحالة: "+(s.error||"unknown");
  else {
    textOut+="📚 الذاكرة: "+String(s.memory?.knowledge_nodes||0)+" عقد / "+String(s.memory?.knowledge_edges||0)+" روابط\n";
    textOut+="🧪 الفرضيات: "+String(s.hypothesis_lab?.proposed||0)+" مقترحة · "+String(s.hypothesis_lab?.testing||0)+" قيد الاختبار · "+String(s.hypothesis_lab?.supported||0)+" مدعومة · "+String(s.hypothesis_lab?.rejected||0)+" مرفوضة\n";
    textOut+="♻️ آخر تعلّم فوقي: "+String(s.evolution?.profile?.last_evaluated_at||"غير متوفر");
  }
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:textOut.slice(0,3900),disable_web_page_preview:true});return new Response("ok",{status:200});
}
if(userText==="/curiosity"){
  const s=await runNeuralStatus();
  let out="🔭 MIDAD Curiosity Engine\n\n";
  if(!s.ok) out+="تعذر قراءة الحالة: "+(s.error||"unknown");
  else {
    out+="أسئلة بانتظار البحث: "+String(s.curiosity?.queued||0)+"\n";
    out+="دورات قيد التشغيل: "+String(s.curiosity?.running||0)+"\n\n";
    const top=Array.isArray(s.curiosity?.top)?s.curiosity.top.slice(0,3):[];
    if(top.length) out+="🎯 أعلى 3 أسئلة:\n"+top.map((x:any,i:number)=>(i+1)+") "+String(x.query||"")).join("\n");
    else out+="لا توجد أسئلة جديدة في الطابور حاليًا.";
  }
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:out.slice(0,3900),disable_web_page_preview:true});
  return new Response("ok",{status:200});
}
if(userText==="/lab"){
  const l=await runHypothesisLab();
  const textOut=l.ok
    ?"🧪 Hypothesis Lab\n\nالحالة: "+String(l.status)+"\nالثقة: "+String(l.confidence)+"\nقوة محاولة الدحض: "+String(l.falsification)+"\n\n"+String(l.counterevidence||l.reasoning||"تم الاختبار.")
    :"تعذر تشغيل المختبر: "+(l.error||"unknown");
  await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:textOut.slice(0,3900),disable_web_page_preview:true});return new Response("ok",{status:200});
}
if(userText==="/ask"||userText.startsWith("/ask ")){const q=userText.replace(/^\/ask\s*/i,"").trim()||"ما هي الحالة التشغيلية الحالية وما الذي يحتاج تدخلي الآن؟";const ai=await runGroundedTelegramAI(q);await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:ai.ok&&ai.answer?ai.answer:"تعذر تشغيل Neural++ الآن: "+(ai.error||"unknown"),disable_web_page_preview:true});return new Response("ok",{status:200});}if(webData)return new Response("ok",{status:200});const ai=await runGroundedTelegramAI(userText);await telegramApi(activeTelegramToken,"sendMessage",{chat_id:chatId,text:ai.ok&&ai.answer?ai.answer:"Neural++ لم تتمكن من الإجابة الآن.",disable_web_page_preview:true});return new Response("ok",{status:200});}catch(_){return new Response("ok",{status:200})}});