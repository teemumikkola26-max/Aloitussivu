/* Service worker: sovellus toimii myös ilman verkkoa (esim. kellarissa).
   - Oman sivuston tiedostot: verkko ensin (3,5 s), muuten välimuisti.
   - CDN-kirjastot (supabase, jszip, pdf.js, pdf-lib): välimuisti ensin.
   - Supabasen omat API-kutsut eivät kulje tämän kautta. */
const CACHE = "aloitussivu-v3";
const SHELL = [
  "./", "index.html", "kenttalomake.html", "form.html", "editor.html",
  "style-editor.html", "styles.css", "auth-gate.js", "submission-sync.js", "users.js",
  "form-runtime.js", "editor-runtime.js", "style-editor-runtime.js",
  "docx-style-engine.js"
];
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(SHELL.map((u) => cache.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  net.catch(() => {});
  try {
    return await Promise.race([
      net,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3500))
    ]);
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return net;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req));
  } else if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(req));
  }
});
