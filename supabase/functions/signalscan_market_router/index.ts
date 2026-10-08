import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const H = {
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "access-control-allow-origin":"*",
  "access-control-allow-methods":"GET,OPTIONS",
  "access-control-allow-headers":"content-type,apikey,authorization,x-signalscan-device"
};

const out = (data:any, status=200, extra:Record<string,string>={}) =>
  new Response(JSON.stringify(data), { status, headers:{...H, ...extra} });

function auth(req:Request){
  const got = req.headers.get("apikey") ||
    (req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const raw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "";
  try{
    const keys = JSON.parse(raw);
    if(Object.values(keys).some((v:any)=>v && v===got)) return true;
  }catch{}
  const legacy = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return Boolean(legacy && legacy===got);
}

const BINANCE_HOSTS = [
  "api.binance.com","api-gcp.binance.com","api1.binance.com",
  "api2.binance.com","api3.binance.com","api4.binance.com"
];

const SRC = {
  bybit:"https://api.bybit.com",
  kucoin:"https://api.kucoin.com",
  kraken:"https://api.kraken.com",
  coingecko:"https://api.coingecko.com"
};

const BYBIT_INTERVAL:Record<string,string> = {
  "1m":"1","3m":"3","5m":"5","15m":"15","30m":"30",
  "1h":"60","2h":"120","4h":"240","6h":"360","8h":"480",
  "12h":"720","1d":"D","1w":"W"
};

const KUCOIN_INTERVAL:Record<string,string> = {
  "1m":"1min","3m":"3min","5m":"5min","15m":"15min","30m":"30min",
  "1h":"1hour","2h":"2hour","4h":"4hour","6h":"6hour","8h":"8hour",
  "12h":"12hour","1d":"1day","1w":"1week"
};

const KRAKEN_INTERVAL:Record<string,number> = {
  "1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440
};

const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms));

async function hit(url:string, timeoutMs=5200){
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const r = await fetch(url, {
      headers:{accept:"application/json","user-agent":"SignalScanAI/0.3.1"},
      signal:controller.signal,
      cache:"no-store"
    });
    const body = await r.text();
    if(!r.ok) throw new Error("HTTP "+r.status);
    return body;
  }finally{
    clearTimeout(timer);
  }
}

function validTicker(v:any){
  return Array.isArray(v) && v.length >= 5 &&
    v.some(x=>x && typeof x.symbol==="string" && Number(x.lastPrice)>0);
}

function validKlines(v:any){
  return Array.isArray(v) && v.length >= 20 &&
    v.every(x=>Array.isArray(x) && x.length>=6 && Number(x[0])>0 && Number(x[4])>0);
}

function validDepth(v:any){
  return v && Array.isArray(v.bids) && Array.isArray(v.asks) &&
    v.bids.length>0 && v.asks.length>0;
}

function normBybit(j:any){
  return (j?.result?.list||[])
    .filter((x:any)=>String(x.symbol).endsWith("USDT") && Number(x.lastPrice)>0)
    .map((x:any)=>({
      symbol:x.symbol,
      lastPrice:Number(x.lastPrice),
      openPrice:Number(x.lastPrice)/(1+Number(x.price24hPcnt||0)),
      highPrice:Number(x.highPrice24h),
      lowPrice:Number(x.lowPrice24h),
      priceChangePercent:Number(x.price24hPcnt||0)*100,
      quoteVolume:Number(x.turnover24h||0),
      volume:Number(x.volume24h||0)
    }));
}

function normKucoin(j:any){
  return (j?.data?.ticker||[])
    .filter((x:any)=>String(x.symbol).endsWith("-USDT") && Number(x.last)>0)
    .map((x:any)=>({
      symbol:String(x.symbol).replace("-",""),
      lastPrice:Number(x.last),
      openPrice:Number(x.last)/(1+Number(x.changeRate||0)),
      highPrice:Number(x.high),
      lowPrice:Number(x.low),
      priceChangePercent:Number(x.changeRate||0)*100,
      quoteVolume:Number(x.volValue||0),
      volume:Number(x.vol||0)
    }));
}

function normGecko(j:any){
  return (Array.isArray(j)?j:[])
    .filter((x:any)=>Number(x.current_price)>0)
    .map((x:any)=>({
      symbol:String(x.symbol).toUpperCase()+"USDT",
      lastPrice:Number(x.current_price),
      openPrice:Number(x.current_price)/(1+(Number(x.price_change_percentage_24h)||0)/100),
      highPrice:Number(x.high_24h||0),
      lowPrice:Number(x.low_24h||0),
      priceChangePercent:Number(x.price_change_percentage_24h||0),
      quoteVolume:Number(x.total_volume||0),
      volume:Number(x.total_volume||0)
    }));
}

function bybitK(j:any){
  return (j?.result?.list||[])
    .filter((x:any)=>Array.isArray(x)&&x.length>=6)
    .map((x:any)=>[+x[0],+x[1],+x[2],+x[3],+x[4],+x[5],+x[0]])
    .reverse();
}

function kucoinK(j:any){
  return (j?.data||[])
    .filter((x:any)=>Array.isArray(x)&&x.length>=6)
    .map((x:any)=>[+x[0]*1000,+x[1],+x[2],+x[3],+x[4],+x[5],+x[0]*1000])
    .reverse();
}

async function firstValid<T>(jobs:Array<Promise<{data:T,provider:string}>>){
  if(!jobs.length) throw new Error("no_provider_jobs");
  try{
    return await Promise.any(jobs);
  }catch{
    await sleep(1);
    throw new Error("all_providers_failed");
  }
}

async function ticker(){
  const jobs = BINANCE_HOSTS.map(host => (async()=>{
    const data = JSON.parse(await hit(`https://${host}/api/v3/ticker/24hr`));
    if(!validTicker(data)) throw new Error("invalid_binance_ticker");
    return {data,provider:"BINANCE"};
  })());

  jobs.push((async()=>{
    const data = normBybit(JSON.parse(await hit(SRC.bybit+"/v5/market/tickers?category=spot")));
    if(!validTicker(data)) throw new Error("invalid_bybit_ticker");
    return {data,provider:"BYBIT"};
  })());

  jobs.push((async()=>{
    const data = normKucoin(JSON.parse(await hit(SRC.kucoin+"/api/v1/market/allTickers")));
    if(!validTicker(data)) throw new Error("invalid_kucoin_ticker");
    return {data,provider:"KUCOIN"};
  })());

  jobs.push((async()=>{
    const data = normGecko(JSON.parse(await hit(
      SRC.coingecko+"/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false"
    )));
    if(!validTicker(data)) throw new Error("invalid_coingecko_ticker");
    return {data,provider:"COINGECKO"};
  })());

  return firstValid(jobs);
}

async function kline(symbol:string, interval:string, limit:number){
  const jobs = BINANCE_HOSTS.map(host => (async()=>{
    const data = JSON.parse(await hit(
      `https://${host}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`
    ));
    if(!validKlines(data)) throw new Error("invalid_binance_kline");
    return {data,provider:"BINANCE"};
  })());

  jobs.push((async()=>{
    const data = bybitK(JSON.parse(await hit(
      SRC.bybit+"/v5/market/kline?category=spot&symbol="+encodeURIComponent(symbol)+
      "&interval="+encodeURIComponent(BYBIT_INTERVAL[interval]||"60")+"&limit="+limit
    )));
    if(!validKlines(data)) throw new Error("invalid_bybit_kline");
    return {data,provider:"BYBIT"};
  })());

  jobs.push((async()=>{
    const type=KUCOIN_INTERVAL[interval];
    if(!type) throw new Error("kucoin_interval_unsupported");
    const mins=({
      "1m":1,"3m":3,"5m":5,"15m":15,"30m":30,"1h":60,"2h":120,
      "4h":240,"6h":360,"8h":480,"12h":720,"1d":1440,"1w":10080
    } as Record<string,number>)[interval]||60;
    const end=Math.floor(Date.now()/1000);
    const start=end-Math.ceil((limit+10)*mins*60);
    const base=symbol.replace(/USDT$/,"");
    const data=kucoinK(JSON.parse(await hit(
      SRC.kucoin+"/api/v1/market/candles?symbol="+encodeURIComponent(base+"-USDT")+
      "&type="+encodeURIComponent(type)+"&startAt="+start+"&endAt="+end
    ))).slice(-limit);
    if(!validKlines(data)) throw new Error("invalid_kucoin_kline");
    return {data,provider:"KUCOIN"};
  })());

  jobs.push((async()=>{
    const pair=({BTCUSDT:"XBTUSD",ETHUSDT:"ETHUSD",SOLUSDT:"SOLUSD"} as Record<string,string>)[symbol];
    const minutes=KRAKEN_INTERVAL[interval];
    if(!pair||!minutes) throw new Error("kraken_pair_or_interval_unsupported");
    const j=JSON.parse(await hit(SRC.kraken+"/0/public/OHLC?pair="+pair+"&interval="+minutes));
    const result=j?.result||{};
    const key=Object.keys(result).find(x=>x!=="last");
    const data=key ? (result[key]||[]).map((x:any)=>[
      +x[0]*1000,+x[1],+x[2],+x[3],+x[4],+x[6],+x[0]*1000
    ]).slice(-limit) : [];
    if(!validKlines(data)) throw new Error("invalid_kraken_kline");
    return {data,provider:"KRAKEN"};
  })());

  return firstValid(jobs);
}

async function depth(symbol:string, limit:number){
  const n=Math.min(50,Math.max(5,limit));
  const jobs=BINANCE_HOSTS.map(host => (async()=>{
    const data=JSON.parse(await hit(
      `https://${host}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${n}`
    ));
    if(!validDepth(data)) throw new Error("invalid_binance_depth");
    return {data,provider:"BINANCE"};
  })());

  jobs.push((async()=>{
    const j=JSON.parse(await hit(
      SRC.bybit+"/v5/market/orderbook?category=spot&symbol="+encodeURIComponent(symbol)+"&limit="+n
    ));
    const data={
      lastUpdateId:Number(j?.result?.u||0),
      bids:j?.result?.b||[],
      asks:j?.result?.a||[]
    };
    if(!validDepth(data)) throw new Error("invalid_bybit_depth");
    return {data,provider:"BYBIT"};
  })());

  return firstValid(jobs);
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers:H});
  if(req.method!=="GET") return out({ok:false,state:"FAILED",error:"method_not_allowed"},405);
  if(!auth(req)) return out({ok:false,state:"BLOCKED",error:"publishable_key_required"},401);

  try{
    const u=new URL(req.url);
    const kind=u.searchParams.get("kind")||"ticker";
    const symbol=(u.searchParams.get("symbol")||"BTCUSDT").toUpperCase();
    const interval=u.searchParams.get("interval")||"1h";
    const limit=Math.min(240,Math.max(20,Number(u.searchParams.get("limit")||140)));

    if(kind==="health"){
      const r=await ticker();
      return out({
        ok:true,state:"VERIFIED",kind:"health",ticker_samples:r.data.length,
        provider:r.provider,generated_at:new Date().toISOString()
      },200,{"x-signalscan-provider":r.provider});
    }

    let r:any;
    if(kind==="ticker") r=await ticker();
    else if(kind==="kline") r=await kline(symbol,interval,limit);
    else if(kind==="depth") r=await depth(symbol,limit);
    else return out({ok:false,state:"FAILED",error:"unsupported_kind"},400);

    return out(r.data,200,{"x-signalscan-provider":r.provider});
  }catch(e){
    return out({
      ok:false,state:"FAILED",error:"all_market_sources_failed",
      detail:String(e?.message||e).slice(0,700),generated_at:new Date().toISOString()
    },502);
  }
});