const CACHE='app-v3';
self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ns=>Promise.all(ns.filter(n=>n!==CACHE).map(n=>caches.delete(n)))));});
self.addEventListener('fetch',e=>{e.respondWith(fetch(e.request).then(r=>{let c=r.clone();caches.open(CACHE).then(ch=>ch.put(e.request,c));return r;}).catch(()=>caches.match(e.request)));});
