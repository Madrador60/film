const fs = require('fs');
const path = require('path');

const DEFAULT_URL = 'https://iptv-org.github.io/iptv/languages/fra.m3u';
const CACHE_SCHEMA_VERSION = 1;
const QUALITY_SUFFIX = /(?:\s*[([_-]?\s*(?:uhd|fhd|full\s*hd|hd|sd|4k|2160p|1080p|720p|576p|480p)\s*[)\]_-]?\s*)+$/i;

function slug(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/['’]/g, '').replace(/\+/g, ' plus ')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function cleanChannelName(value) {
    return String(value || 'Chaîne IPTV')
        .replace(/\s*\[(?:not\s*24\/7|geo-?blocked)[^\]]*\]\s*/gi, ' ')
        .replace(QUALITY_SUFFIX, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeChannelName(value) {
    return slug(cleanChannelName(value))
        .replace(/(?:-(?:francais|francaise|france|french|fr))+$/g, '')
        .replace(/(?:-(?:uhd|fhd|hd|sd|4k|1080p|720p))+$/g, '');
}

function canonicalTvgId(value) {
    return String(value || '').trim().toLowerCase().replace(/@(uhd|fhd|hd|sd|4k|1080p|720p)$/i, '');
}

function categoryFor(group, name) {
    const value = `${group || ''} ${name || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/regional|local|territorial|outre.?mer|alsace|bretagne|corse|normandie|provence|occitan|reunion|guadeloupe|martinique|guyane/.test(value)) return 'Régionales';
    if (/news|information|business|legislative|meteo|weather/.test(value)) return 'Information';
    if (/sport|football|soccer|tennis|rugby|basket|racing|auto|golf/.test(value)) return 'Sports';
    if (/series|drama/.test(value)) return 'Séries';
    if (/movie|movies|cinema|film|comedy/.test(value)) return 'Cinéma';
    if (/kids|children|youth|animation|junior|jeunesse|cartoon/.test(value)) return 'Jeunesse';
    if (/music|musique|radio|hits/.test(value)) return 'Musique';
    if (/documentary|documentaire|education|science|culture|history|nature/.test(value)) return 'Documentaires';
    if (/general|entertainment/.test(value)) return 'Généralistes';
    return 'Autres';
}

function countryFor(tvgId, name) {
    const match = String(tvgId || '').match(/\.([a-z]{2})(?:@|$)/i);
    if (match) return match[1].toUpperCase();
    return /\b(france|fr)\b/i.test(String(name || '')) ? 'FR' : '';
}

function sourceType(value) {
    try {
        const pathname = new URL(value).pathname.toLowerCase();
        if (pathname.endsWith('.m3u8')) return 'hls';
        if (/\.(mp4|webm|mkv)$/.test(pathname)) return 'video';
        return 'other';
    } catch {
        return 'other';
    }
}

function isPublicHttpUrl(value) {
    try {
        const url = new URL(String(value || ''));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
        const hostname = url.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) return false;
        if (/^(?:127|10|0)\./.test(hostname) || /^192\.168\./.test(hostname)) return false;
        const private172 = hostname.match(/^172\.(\d+)\./);
        if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
        return true;
    } catch {
        return false;
    }
}

function parseAttributes(line) {
    const attributes = {};
    line.replace(/([\w-]+)="([^"]*)"/g, (_match, key, value) => {
        attributes[key.toLowerCase()] = value.trim();
        return _match;
    });
    return attributes;
}

function parseM3u(content) {
    const text = String(content || '').replace(/^\uFEFF/, '');
    if (!/^#EXTM3U/m.test(text)) throw new Error('La réponse IPTV-org n’est pas une playlist M3U valide.');
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const raw = [];
    let metadata = null;
    let headers = {};

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const attributes = parseAttributes(line);
            const comma = line.lastIndexOf(',');
            metadata = {
                tvgId: attributes['tvg-id'] || '',
                tvgName: attributes['tvg-name'] || '',
                logo: attributes['tvg-logo'] || '',
                group: attributes['group-title'] || '',
                language: attributes['tvg-language'] || 'fr',
                name: comma >= 0 ? line.slice(comma + 1).trim() : ''
            };
            headers = {
                referrer: attributes['http-referrer'] || '',
                userAgent: attributes['http-user-agent'] || ''
            };
            continue;
        }
        if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
            headers.referrer = line.slice(line.indexOf('=') + 1).trim();
            continue;
        }
        if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
            headers.userAgent = line.slice(line.indexOf('=') + 1).trim();
            continue;
        }
        if (line.startsWith('#')) continue;
        if (!metadata || !isPublicHttpUrl(line)) {
            metadata = null;
            headers = {};
            continue;
        }
        raw.push({ ...metadata, url: line, headers: { ...headers } });
        metadata = null;
        headers = {};
    }

    const channels = new Map();
    const tvgIndex = new Map();
    const nameIndex = new Map();
    let duplicateMerges = 0;
    for (const entry of raw) {
        const displayName = cleanChannelName(entry.tvgName || entry.name);
        const tvgKey = canonicalTvgId(entry.tvgId);
        const nameKey = normalizeChannelName(displayName);
        if (!nameKey) continue;
        const key = (tvgKey && tvgIndex.get(tvgKey)) || nameIndex.get(nameKey) || (tvgKey ? `tvg:${tvgKey}` : `name:${nameKey}`);
        if (!channels.has(key)) {
            channels.set(key, {
                id: `iptv-org-${slug(tvgKey || nameKey)}`,
                tvgId: entry.tvgId,
                name: displayName,
                logo: isPublicHttpUrl(entry.logo) ? entry.logo : '',
                country: countryFor(entry.tvgId, displayName),
                language: String(entry.language || 'fr').toLowerCase(),
                category: categoryFor(entry.group, displayName),
                source: 'iptv-org',
                sources: []
            });
        } else {
            duplicateMerges += 1;
        }
        if (tvgKey) tvgIndex.set(tvgKey, key);
        nameIndex.set(nameKey, key);
        const channel = channels.get(key);
        if (!channel.logo && isPublicHttpUrl(entry.logo)) channel.logo = entry.logo;
        if (!channel.sources.some((source) => source.url === entry.url)) {
            channel.sources.push({
                url: entry.url,
                type: sourceType(entry.url),
                provider: 'IPTV-org',
                provenance: 'IPTV-org',
                catalog: 'iptv-org',
                status: 'unchecked',
                checkedAt: null,
                headers: entry.headers
            });
        } else {
            duplicateMerges += 1;
        }
    }

    return {
        channels: [...channels.values()].filter((channel) => channel.sources.length),
        rawEntries: raw.length,
        duplicateMerges
    };
}

function createIptvOrgService(options = {}) {
    const axios = options.axios;
    if (!axios) throw new Error('Le client HTTP est requis.');
    const remoteUrl = options.remoteUrl || DEFAULT_URL;
    const cacheFile = options.cacheFile;
    const fallbackFile = options.fallbackFile;
    const maxAge = Number(options.maxAge) || 8 * 60 * 60 * 1000;
    const timeout = Number(options.timeout) || 20000;
    let snapshot = null;
    let refreshPromise = null;
    let lastError = '';
    let lastRefreshRequestAt = 0;

    function readSnapshot(file, source) {
        try {
            if (!file || !fs.existsSync(file)) return null;
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            const data = parsed.data || parsed;
            if (data.schemaVersion !== CACHE_SCHEMA_VERSION || !Array.isArray(data.channels) || !data.channels.length) return null;
            return { ...data, cacheSource: source };
        } catch {
            return null;
        }
    }

    function loadFallback() {
        if (snapshot) return snapshot;
        snapshot = readSnapshot(cacheFile, 'runtime') || readSnapshot(fallbackFile, 'bundled');
        return snapshot;
    }

    function writeSnapshot(data) {
        if (!cacheFile) return;
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const temporary = `${cacheFile}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
        fs.renameSync(temporary, cacheFile);
    }

    async function refresh(force = false) {
        if (refreshPromise) return refreshPromise;
        const current = loadFallback();
        if (!force && current?.updatedAt && Date.now() - new Date(current.updatedAt).getTime() < maxAge) return current;
        refreshPromise = (async () => {
            try {
                const response = await axios.get(remoteUrl, {
                    timeout,
                    responseType: 'text',
                    maxContentLength: 2 * 1024 * 1024,
                    headers: { 'Accept': 'application/vnd.apple.mpegurl,audio/x-mpegurl,text/plain,*/*' }
                });
                const parsed = parseM3u(response.data);
                const now = new Date().toISOString();
                snapshot = {
                    schemaVersion: CACHE_SCHEMA_VERSION,
                    ok: true,
                    name: 'IPTV-org — Chaînes francophones',
                    sourceUrl: remoteUrl,
                    updatedAt: now,
                    lastAttemptAt: now,
                    cacheSource: 'remote',
                    rawEntries: parsed.rawEntries,
                    total: parsed.channels.length,
                    duplicateMerges: parsed.duplicateMerges,
                    channels: parsed.channels
                };
                lastError = '';
                writeSnapshot(snapshot);
                return snapshot;
            } catch (error) {
                lastError = error.message;
                const fallback = loadFallback();
                if (fallback) return { ...fallback, ok: true, stale: true, lastError, lastAttemptAt: new Date().toISOString() };
                throw error;
            } finally {
                refreshPromise = null;
            }
        })();
        return refreshPromise;
    }

    async function getSnapshot(options = {}) {
        const current = loadFallback();
        const stale = !current?.updatedAt || Date.now() - new Date(current.updatedAt).getTime() >= maxAge;
        if (options.force || !current) return refresh(Boolean(options.force));
        if (stale && !refreshPromise) refresh(false).catch(() => {});
        return { ...current, stale, lastError };
    }

    function hasSourceUrl(value) {
        const wanted = String(value || '');
        return Boolean(loadFallback()?.channels?.some((channel) => channel.sources.some((source) => source.url === wanted)));
    }

    function markSourceStatus(value, health = {}) {
        const wanted = String(value || '');
        const current = loadFallback();
        if (!current?.channels) return false;
        for (const channel of current.channels) {
            const source = channel.sources.find((item) => item.url === wanted);
            if (!source) continue;
            source.status = ['available', 'slow', 'unavailable'].includes(health.state) ? health.state : 'unchecked';
            source.checkedAt = health.checkedAt || new Date().toISOString();
            source.latency = Number(health.latency) || 0;
            return true;
        }
        return false;
    }

    function canPublicRefresh(cooldown = 15 * 60 * 1000) {
        const now = Date.now();
        if (now - lastRefreshRequestAt < cooldown) return false;
        lastRefreshRequestAt = now;
        return true;
    }

    function status() {
        const current = loadFallback();
        const sourceStats = { total: 0, unchecked: 0, available: 0, slow: 0, unavailable: 0 };
        for (const channel of current?.channels || []) {
            for (const source of channel.sources || []) {
                sourceStats.total += 1;
                const state = source.status || 'unchecked';
                sourceStats[state] = (sourceStats[state] || 0) + 1;
            }
        }
        return {
            ok: Boolean(current),
            name: 'IPTV-org — Chaînes francophones',
            sourceUrl: remoteUrl,
            updatedAt: current?.updatedAt || null,
            lastAttemptAt: current?.lastAttemptAt || null,
            stale: !current?.updatedAt || Date.now() - new Date(current.updatedAt).getTime() >= maxAge,
            refreshing: Boolean(refreshPromise),
            cacheSource: current?.cacheSource || null,
            rawEntries: current?.rawEntries || 0,
            total: current?.total || 0,
            duplicateMerges: current?.duplicateMerges || 0,
            sourceStats,
            lastError
        };
    }

    return { parseM3u, refresh, getSnapshot, hasSourceUrl, markSourceStatus, canPublicRefresh, status };
}

module.exports = { createIptvOrgService, parseM3u, normalizeChannelName, canonicalTvgId };
