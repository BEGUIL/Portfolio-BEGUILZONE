const CACHE_PREFIX = 'beguilzone-portfolio';
const CORE_CACHE = `${CACHE_PREFIX}-core-v1`;
const MEDIA_CACHE = `${CACHE_PREFIX}-media-v1`;

const CORE_ASSETS = [
    './',
    './index.html',
    './images/img1.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CORE_CACHE)
            .then((cache) => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    const currentCaches = new Set([CORE_CACHE, MEDIA_CACHE]);
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith(CACHE_PREFIX) && !currentCaches.has(key))
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

const networkFirst = async (request) => {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CORE_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        return (await caches.match(request)) || (await caches.match('./index.html'));
    }
};

const staleWhileRevalidate = async (request) => {
    const cachedResponse = await caches.match(request);
    const networkResponse = fetch(request).then(async (response) => {
        if (response.ok) {
            const cache = await caches.open(MEDIA_CACHE);
            await cache.put(request, response.clone());
        }
        return response;
    }).catch(() => null);

    if (cachedResponse) return cachedResponse;
    return (await networkResponse) || Response.error();
};

self.addEventListener('message', (event) => {
    if (event.data?.type !== 'CACHE_URL' || !event.data.url) return;

    const assetUrl = new URL(event.data.url, self.location.href);
    if (assetUrl.origin !== self.location.origin) return;

    event.waitUntil(
        caches.open(MEDIA_CACHE).then(async (cache) => {
            const cached = await cache.match(assetUrl.href);
            if (!cached) await cache.add(assetUrl.href);
        })
    );
});

const serveAudioRange = async (request) => {
    const cachedResponse = await caches.match(request.url);
    if (!cachedResponse || cachedResponse.status !== 200) return fetch(request);

    const range = request.headers.get('range');
    const bytes = await cachedResponse.arrayBuffer();
    const match = /bytes=(\d+)-(\d*)/.exec(range || '');
    if (!match) return cachedResponse;

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : bytes.byteLength - 1;
    const chunk = bytes.slice(start, end + 1);
    const headers = new Headers(cachedResponse.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${bytes.byteLength}`);
    headers.set('Content-Length', String(chunk.byteLength));
    headers.set('Accept-Ranges', 'bytes');

    return new Response(chunk, { status: 206, statusText: 'Partial Content', headers });
};

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }

    if (request.headers.has('range') && url.pathname.toLowerCase().endsWith('.mp3')) {
        event.respondWith(serveAudioRange(request));
        return;
    }

    if (/\.(?:png|jpe?g|svg|webp|mp3|pdf)$/i.test(url.pathname)) {
        event.respondWith(staleWhileRevalidate(request));
    }
});
