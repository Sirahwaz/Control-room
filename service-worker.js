/* Version bump retires stale cache and activates the non-blocking fast-boot login path. */
const CACHE="midad-control-v23-20261113-outreach-v1";
const CORE=["./","./index.html","./midad-control-v2.css","./midad-control-v2.js?v=20261113-outreach-v1","./trust-wallet-link.html","./reown-wallet-connect.html","./midad-cockpit.js","./midad-human-bridge-control.js","./midad-fix-v1.css","./midad-fix-v1.js","./iaitrader.html","./iaitrader.css","./iaitrader.js","./meme-scout.html","./manifest.webmanifest","./midad-pwa-icon.svg","./midad-network-access.html","./midad-network-access.css","./midad-network-access.js"];
// Runtime caching is restricted to the same static asset paths already used by precache.
// API routes, personalized responses, and arbitrary navigations are never added to CacheStorage.
const STATIC_ASSETS=new Set(CORE.map(asset=>new URL(asset,self.registration.scope).pathname));
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||event.request.method!=="GET"||!STATIC_ASSETS.has(url.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
    return response;
  }).catch(()=>caches.match(event.request)));
});
