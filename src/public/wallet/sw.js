// Retires the old GeoWallet web app's service worker (now Oxyon Wallet, at
// https://wallet.oxyon.io/). That app registered this file (Workbox) and cached
// its own pages with a navigation fallback, so a returning visitor could keep
// being served stale cached pages here. Browsers re-check this file on each
// visit; this version deletes those caches, unregisters itself, and reloads any
// open tab once, onto the current page. Nothing on winlew.co registers a
// service worker any more, so this runs once per affected browser and is gone.
//
// It does NOT touch wallet data: a wallet created in the old app stays in this
// browser's site storage. The move path is importing the recovery phrase at
// https://wallet.oxyon.io/ (see /news/winlew-isnt-going-away/).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) await caches.delete(key);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url);
  })());
});
