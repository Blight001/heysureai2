"use strict";
// avatar-cache.ts — resolve the server avatar reference and cache it as a data
// URL in the store, mirroring the browser extension. Preset avatars are served
// by the backend at /avatars/avatarsN.png; user.avatar holds the web console's
// bundled reference (e.g. /assets/avatars2-<hash>.png), so the 1-5 index is
// extracted and resolved against the server.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAvatarUrl = resolveAvatarUrl;
exports.cacheUserAvatar = cacheUserAvatar;
const electron_1 = require("electron");
const store_1 = require("../store");
function resolveAvatarUrl(avatar, server) {
    const raw = (avatar || '').trim();
    if (!raw)
        return '';
    const base = (server || '').replace(/\/+$/, '');
    const preset = raw.match(/avatars([1-5])(?:[-.][^/]*)?\.png/i);
    if (preset)
        return base ? `${base}/avatars/avatars${preset[1]}.png` : '';
    if (/^(https?:|data:|blob:)/i.test(raw))
        return raw;
    if (!base)
        return raw;
    return raw.startsWith('/') ? `${base}${raw}` : `${base}/${raw}`;
}
async function fetchAvatarDataUrl(url) {
    if (!url)
        return '';
    if (url.startsWith('data:'))
        return url;
    const res = await electron_1.net.fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok)
        throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || 'image/png';
    return `data:${contentType};base64,${buf.toString('base64')}`;
}
// Fetch + cache the current account's avatar into `userAvatarDataUrl`. On
// failure, clears the cache so the renderer falls back to the live URL.
async function cacheUserAvatar(server, avatar) {
    try {
        const url = resolveAvatarUrl(avatar, server);
        store_1.store.set('userAvatarDataUrl', url ? await fetchAvatarDataUrl(url) : '');
    }
    catch (err) {
        console.warn('avatar cache fetch failed, falling back to live URL', err);
        store_1.store.set('userAvatarDataUrl', '');
    }
}
