(function(root,factory){
  const api=factory(root);
  if(typeof module==="object"&&module.exports) module.exports=api;
  else root.MIDADCheckoutOrderKey=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(root){
  "use strict";
  const ORDER_KEY_RE=/^store-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STORAGE_KEY="midadRevenueOrderKeysV2";

  function createManager(options){
    options=options||{};
    let storage=Object.prototype.hasOwnProperty.call(options,"storage")?options.storage:null;
    if(!Object.prototype.hasOwnProperty.call(options,"storage")){
      try{storage=root.localStorage;}catch{storage=null;}
    }
    const cryptoApi=options.cryptoApi||root.crypto;
    const now=typeof options.now==="function"?options.now:()=>Date.now();
    let memory={};

    async function fingerprint(input){
      const normalized=JSON.stringify([
        String(input?.product||""),
        String(input?.name||"").trim(),
        String(input?.email||"").trim().toLowerCase(),
        String(input?.requirements||"").trim()
      ]);
      if(!cryptoApi?.subtle?.digest) throw new Error("checkout_key_crypto_unavailable");
      const digest=await cryptoApi.subtle.digest("SHA-256",new TextEncoder().encode(normalized));
      return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,"0")).join("");
    }
    function readMap(){
      if(!storage)return {...memory};
      try{
        const raw=storage.getItem(STORAGE_KEY);
        if(!raw)return {...memory};
        const value=JSON.parse(raw);
        return value&&typeof value==="object"&&!Array.isArray(value)?value:{...memory};
      }catch{return {...memory};}
    }
    function writeMap(map){
      memory=map;
      if(storage){try{storage.setItem(STORAGE_KEY,JSON.stringify(map));}catch{}}
    }
    function uuidV4(){
      if(typeof cryptoApi?.randomUUID==="function")return cryptoApi.randomUUID();
      if(typeof cryptoApi?.getRandomValues!=="function")throw new Error("checkout_key_random_unavailable");
      const bytes=new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      bytes[6]=(bytes[6]&0x0f)|0x40;
      bytes[8]=(bytes[8]&0x3f)|0x80;
      const h=Array.from(bytes).map(x=>x.toString(16).padStart(2,"0")).join("");
      return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);
    }
    function trimMap(map){
      const keys=Object.keys(map);
      if(keys.length<=50)return map;
      keys.sort((a,b)=>(Date.parse(map[a]?.createdAt||"")||0)-(Date.parse(map[b]?.createdAt||"")||0));
      for(const key of keys.slice(0,keys.length-50))delete map[key];
      return map;
    }
    async function getKey(input){
      const fp=await fingerprint(input);
      const map=readMap();
      const entry=map[fp];
      const nowMs=Number(now());
      const expiresAt=entry?.expiresAt?Date.parse(entry.expiresAt):NaN;
      if(entry&&ORDER_KEY_RE.test(String(entry.key||""))&&
        (!entry.expiresAt||(Number.isFinite(expiresAt)&&nowMs<expiresAt)))return entry.key;
      const key="store-"+uuidV4();
      map[fp]={key,expiresAt:null,createdAt:new Date(nowMs).toISOString()};
      writeMap(trimMap(map));
      return key;
    }
    async function rememberExpiry(input,key,expiresAt){
      if(!ORDER_KEY_RE.test(String(key||"")))return false;
      const expiry=Date.parse(String(expiresAt||""));
      if(!Number.isFinite(expiry))return false;
      const fp=await fingerprint(input);
      const map=readMap();
      if(!map[fp]||map[fp].key!==key)return false;
      map[fp].expiresAt=new Date(expiry).toISOString();
      writeMap(map);
      return true;
    }
    return {getKey,rememberExpiry};
  }
  return {ORDER_KEY_RE,STORAGE_KEY,createManager};
});
