import { timestamp, files, shell } from '@sapper/service-worker';

const ASSETS = `cache${timestamp}`;
const toCache = shell.concat(files);
const staticAssets = new Set(toCache);
self.addEventListener('install', event => {
    event.waitUntil(caches.open(ASSETS).then(cache => cache.addAll(toCache)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(async keys => {
        for (const key of keys) if (key !== ASSETS) await caches.delete(key);
        await self.clients.claim();
    }));
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || event.request.headers.has('range')) return;
    const url = new URL(event.request.url);
    // Only immutable build/static assets may be served offline. HTML contains
    // the session and APIs contain private records, so both always use the network.
    if (url.origin !== self.location.origin || !staticAssets.has(url.pathname)) return;
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
