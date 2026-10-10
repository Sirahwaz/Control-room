/* Version bump is deliberate: retire old cached Control Room assets after the mobile UI repair. */
const CACHE="midad-control-v5-20261011-fix1";
const CORE=["./","./index.html","./midad-control-v2.css","./midad-control-v2.js","./midad-human-bridge-control.js","./midad-fix-v1.css","./midad-fix-v1.js","./iaitrader.html","./iaitrader.css","./iaitrader.js","./manifest.webmanifest","./midad-pwa-icon.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(event.request)));
});
