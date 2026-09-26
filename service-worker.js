const CACHE="midad-command-v16-20260926b";
const CORE=["./","./index.html","./midad-control-v16.css","./midad-control-v16.js","./midad-control-v16-interactions.js","./manifest.webmanifest","./midad-pwa-icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",e=>{
 const u=new URL(e.request.url);
 if(u.origin!==location.origin||e.request.method!=="GET")return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const clone=r.clone();caches.open(CACHE).then(c=>c.put(e.request,clone)).catch(()=>{})}return r}).catch(()=>caches.match(e.request)));
});