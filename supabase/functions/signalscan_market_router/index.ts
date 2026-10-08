import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const H={"content-type":"application/json; charset=utf-8","cache-control":"no-store","access-control-allow-origin":"*","access-control-allow-methods":"GET,OPTIONS","access-control-allow-headers":"content-type,apikey,authorization,x-signalscan-device"};
const out=(x,s=200,e={})=>new Response(JSON.stringify(x),{status:s,headers:{...H,...e}});
function auth(req){const got=req.headers.get("apikey")||(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""),raw=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"";try{const k=JSON.parse(raw);if(Object.values(k).some(v=>v===got))return true}catch{}return Boolean(Deno.env.get("SUPABASE_ANON_KEY")&&Deno.env.get("SUPABASE_ANON_KEY")===got)}
const SP=["api.binance.com","api-gcp.binance.com","api1.binance.com","api2.binance.com","api3.binance.com","api4.binance.com"];
const srcs={bybit:"https://api.bybit.com",kucoin:"https://api.kucoin.com",kraken:"https://api.kraken.com"};
async function hit(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),6500);try{const r=await fetch(url,{headers:{accept:"application/json","user-agent":"SignalScanAI/0.3"},signal:c.signal}),b=await r.text();if(!r.ok)throw Error("HTTP "+r.status);return b}finally{clearTimeout(t)}}
function normBybit(j){return (j?.result?.list||[]).filter(x=>String(x.symbol).endsWith("USDT")).map(x=>({symbol:x.symbol,lastPrice:Number(x.lastPrice),openPrice:Number(x.lastPrice)/(1+Number(x.price24hPcnt||0)),highPrice:Number(x.highPrice24h),lowPrice:Number(x.lowPrice24h),priceChangePercent:Number(x.price24hPcnt||0)*100,quoteVolume:Number(x.turnover24h||0),volume:Number(x.volume24h||0)}))}
function normKu(j){return (j?.data?.ticker||[]).filter(x=>String(x.symbol).endsWith("-USDT")).map(x=>({symbol:x.symbol.replace("-",""),lastPrice:Number(x.last),openPrice:Number(x.last)/(1+Number(x.changeRate||0)),highPrice:Number(x.high),lowPrice:Number(x.low),priceChangePercent:Number(x.changeRate||0)*100,quoteVolume:Number(x.volValue||0),volume:Number(x.vol||0)}))}
function gecko(j){return (Array.isArray(j)?j:[]).filter(x=>x.current_price).map(x=>({symbol:String(x.symbol).toUpperCase()+"USDT",lastPrice:+x.current_price,openPrice:+x.current_price/(1+(+x.price_change_percentage_24h||0)/100),highPrice:+(x.high_24h||0),lowPrice:+(x.low_24h||0),priceChangePercent:+(x.price_change_percentage_24h||0),quoteVolume:+(x.total_volume||0),volume:+(x.total_volume||0)}))}
function bybitK(j){return (j?.result?.list||[]).map(x=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[5],+x[0]]).reverse()}
function kuK(j){return (j?.data||[]).map(x=>[+x[0]*1000,+x[1],+x[2],+x[3],+x[4],+x[5],+x[0]*1000]).reverse()}
const bInt={"1m":"1","3m":"3","5m":"5","15m":"15","30m":"30","1h":"60","2h":"120","4h":"240","6h":"360","8h":"480","12h":"720","1d":"D","1w":"W"};
const kType={"1m":"1min","3m":"3min","5m":"5min","15m":"15min","30m":"30min","1h":"1hour","2h":"2hour","4h":"4hour","6h":"6hour","8h":"8hour","12h":"12hour","1d":"1day","1w":"1week"};
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method!=="GET")return out({ok:false,error:"method_not_allowed"},405);
  if(!auth(req))return out({ok:false,error:"publishable_key_required"},401);
  try{
    const u=new URL(req.url),kind=u.searchParams.get("kind")||"ticker",symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase(),interval=u.searchParams.get("interval")||"1h",limit=Math.min(240,Math.max(20,+u.searchParams.get("limit")||140));
    if(kind==="ticker"){
      for(const h of SP){try{return new Response(await hit("https://"+h+"/api/v3/ticker/24hr"),{headers:{...H,"x-signalscan-provider":"BINANCE"}})}catch{}}
      try{return out(normBybit(JSON.parse(await hit(srcs.bybit+"/v5/market/tickers?category=spot"))),200,{"x-signalscan-provider":"BYBIT"})}catch{}
      try{return out(normKu(JSON.parse(await hit(srcs.kucoin+"/api/v1/market/allTickers"))),200,{"x-signalscan-provider":"KUCOIN"})}catch{}
      return out(gecko(JSON.parse(await hit("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false"))),200,{"x-signalscan-provider":"COINGECKO"});
    }
    if(kind==="kline"){
      for(const h of SP){try{return new Response(await hit("https://"+h+"/api/v3/klines?symbol="+symbol+"&interval="+interval+"&limit="+limit),{headers:{...H,"x-signalscan-provider":"BINANCE"}})}catch{}}
      try{const a=bybitK(JSON.parse(await hit(srcs.bybit+"/v5/market/kline?category=spot&symbol="+symbol+"&interval="+(bInt[interval]||"60")+"&limit="+limit)));if(a.length)return out(a,200,{"x-signalscan-provider":"BYBIT"})}catch{}
      try{const type=kType[interval];if(type){const base=symbol.replace(/USDT$/,""),end=Math.floor(Date.now()/1000),start=end-(limit+10)*3600,a=kuK(JSON.parse(await hit(srcs.kucoin+"/api/v1/market/candles?symbol="+base+"-USDT&type="+type+"&startAt="+start+"&endAt="+end)));if(a.length)return out(a.slice(-limit),200,{"x-signalscan-provider":"KUCOIN"})}}catch{}
      const kp={BTCUSDT:"XBTUSD",ETHUSDT:"ETHUSD",SOLUSDT:"SOLUSD"}[symbol],mins=interval==="1h"?60:interval==="4h"?240:interval==="1d"?1440:15;
      if(kp)try{const j=JSON.parse(await hit(srcs.kraken+"/0/public/OHLC?pair="+kp+"&interval="+mins)),r=j?.result||{},key=Object.keys(r).find(x=>x!=="last"),a=key?(r[key]||[]).map(x=>[+x[0]*1000,+x[1],+x[2],+x[3],+x[4],+x[6],+x[0]*1000]):[];if(a.length)return out(a.slice(-limit),200,{"x-signalscan-provider":"KRAKEN"})}catch{}
      throw Error("all_kline_sources_failed");
    }
    if(kind==="depth"){
      const q="/api/v3/depth?symbol="+symbol+"&limit="+Math.min(50,limit);for(const h of SP){try{return new Response(await hit("https://"+h+q),{headers:{...H,"x-signalscan-provider":"BINANCE"}})}catch{}}
      const j=JSON.parse(await hit(srcs.bybit+"/v5/market/orderbook?category=spot&symbol="+symbol+"&limit="+Math.min(50,limit)));return out({lastUpdateId:+(j?.result?.u||0),bids:j?.result?.b||[],asks:j?.result?.a||[]},200,{"x-signalscan-provider":"BYBIT"});
    }
    throw Error("unsupported_kind");
  }catch(e){return out({ok:false,state:"FAILED",error:"all_market_sources_failed",detail:String(e).slice(0,700)},502)}
});