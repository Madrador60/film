const fs = require('fs');
const path = require('path');
const { parseM3u, normalizeChannelName } = require('./iptvOrgService');

const API_BASE = 'https://iptv-org.github.io/api';
const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/languages/fra.m3u';
const RESOURCES = ['channels', 'feeds', 'logos', 'streams', 'guides', 'categories', 'languages', 'countries', 'blocklist'];
const SCHEMA_VERSION = 2;

function normalizeCategory(values = [], name = '') {
    const value = `${values.join(' ')} ${name}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/regional|local|territorial|outre.?mer|alsace|bretagne|corse|normandie|provence|occitan|reunion|guadeloupe|martinique|guyane/.test(value)) return 'Régionales';
    if (/news|business|legislative|weather/.test(value)) return 'Information';
    if (/sport|football|soccer|tennis|rugby|basket|racing|auto|golf/.test(value)) return 'Sports';
    if (/series|drama/.test(value)) return 'Séries';
    if (/movie|cinema|film|comedy/.test(value)) return 'Cinéma';
    if (/kids|children|youth|animation|junior|cartoon/.test(value)) return 'Jeunesse';
    if (/music|radio/.test(value)) return 'Musique';
    if (/documentary|education|science|culture|history|nature/.test(value)) return 'Documentaires';
    if (/general|entertainment/.test(value)) return 'Généralistes';
    return 'Autres';
}

function feedKey(channel, feed) {
    return `${String(channel || '').toLowerCase()}::${String(feed || 'main').toLowerCase()}`;
}

function isQualityFeed(feed = {}) {
    return feed.is_main || /^(?:main|sd|hd|fhd|uhd|4k|\d{3,4}p)$/i.test(String(feed.id || ''));
}

function sourceProtocol(value) {
    try {
        const url = new URL(value);
        return url.protocol.replace(':', '').toUpperCase();
    } catch {
        return '';
    }
}

function sourceType(value) {
    try {
        const pathname = new URL(value).pathname.toLowerCase();
        return pathname.endsWith('.m3u8') ? 'hls' : /\.(mp4|webm)$/.test(pathname) ? 'video' : 'other';
    } catch {
        return 'other';
    }
}

function qualityRank(value) {
    const match = String(value || '').match(/(\d{3,4})p/i);
    if (match) return Number(match[1]);
    return ({ '4K': 2160, UHD: 2160, FHD: 1080, HD: 720, SD: 480 })[String(value || '').toUpperCase()] || 0;
}

function chooseLogo(logos, channelId, feedId) {
    return logos
        .filter((logo) => !channelId || String(logo.channel).toLowerCase() === channelId.toLowerCase())
        .map((logo) => {
            const exactFeed = feedId && String(logo.feed || '').toLowerCase() === feedId.toLowerCase();
            const horizontal = (logo.tags || []).some((tag) => /horizontal/i.test(tag)) || Number(logo.width) >= Number(logo.height);
            const size = Math.min(Number(logo.width) || 0, 1600) * Math.min(Number(logo.height) || 0, 900);
            return { logo, score: (exactFeed ? 10000000 : 0) + (logo.in_use ? 1000000 : 0) + (horizontal ? 100000 : 0) + size };
        })
        .sort((a, b) => b.score - a.score)[0]?.logo?.url || '';
}

function normalizeLabel(value) {
    const label = String(value || '').trim();
    if (/geo.?blocked/i.test(label)) return 'Geo-blocked';
    if (/not\s*24\/?7/i.test(label)) return 'Not 24/7';
    if (/offline/i.test(label)) return 'Offline';
    return label;
}

function normalizeSource(input, provider) {
    const protocol = sourceProtocol(input.url);
    const secure = protocol === 'HTTPS';
    const label = normalizeLabel(input.label);
    const offline = label === 'Offline';
    return {
        url: input.url,
        type: sourceType(input.url),
        quality: input.quality || '',
        label,
        referrer: input.referrer || input.headers?.referrer || '',
        userAgent: input.user_agent || input.headers?.userAgent || '',
        protocol,
        secure,
        playable: secure && !offline,
        geoBlocked: label === 'Geo-blocked',
        intermittent: label === 'Not 24/7',
        provider,
        provenance: 'IPTV-org',
        catalog: 'iptv-org',
        status: offline ? 'unavailable' : secure ? 'unchecked' : 'incompatible_https',
        checkedAt: null
    };
}

function parseTvgId(value) {
    const raw = String(value || '').trim();
    const at = raw.indexOf('@');
    return { channel: at >= 0 ? raw.slice(0, at) : raw, feed: at >= 0 ? raw.slice(at + 1) : '' };
}

function buildCatalog(api, playlists = []) {
    const blocklist = new Set(api.blocklist.map((item) => String(item.channel || '').toLowerCase()));
    const channelsById = new Map(api.channels.map((channel) => [channel.id.toLowerCase(), channel]));
    const feedsByChannel = new Map();
    const logosByChannel = new Map();
    const guidesByChannel = new Map();
    for (const feed of api.feeds) {
        const list = feedsByChannel.get(feed.channel.toLowerCase()) || [];
        list.push(feed);
        feedsByChannel.set(feed.channel.toLowerCase(), list);
    }
    for (const logo of api.logos) {
        const key = String(logo.channel || '').toLowerCase();
        const list = logosByChannel.get(key) || [];
        list.push(logo);
        logosByChannel.set(key, list);
    }
    for (const guide of api.guides) {
        const key = String(guide.channel || '').toLowerCase();
        const list = guidesByChannel.get(key) || [];
        list.push(guide);
        guidesByChannel.set(key, list);
    }
    const categoryNames = new Map(api.categories.map((item) => [item.id, item.name]));
    const languageNames = new Map(api.languages.map((item) => [item.code, item.name]));
    const countryNames = new Map(api.countries.map((item) => [item.code, item.name]));
    const today = new Date().toISOString().slice(0, 10);
    const entities = new Map();
    const stats = {
        apiResources: RESOURCES.length,
        rawApiStreams: api.streams.length,
        rawPlaylistStreams: 0,
        duplicateMerges: 0,
        excludedNsfw: 0,
        excludedBlocklist: 0,
        excludedClosed: 0,
        excludedUnmatched: 0
    };

    const excludedChannels = new Set();
    for (const channel of api.channels) {
        let reason = '';
        if (channel.is_nsfw) reason = 'excludedNsfw';
        else if (blocklist.has(channel.id.toLowerCase())) reason = 'excludedBlocklist';
        else if (channel.closed && channel.closed <= today) reason = 'excludedClosed';
        if (reason) {
            excludedChannels.add(channel.id.toLowerCase());
            stats[reason] += 1;
        }
    }

    function activeChannel(id) {
        const channel = channelsById.get(String(id || '').toLowerCase());
        return channel && !excludedChannels.has(channel.id.toLowerCase()) ? channel : null;
    }

    function resolveFeed(channel, requestedFeed) {
        const feeds = feedsByChannel.get(channel.id.toLowerCase()) || [];
        const exact = feeds.find((feed) => String(feed.id).toLowerCase() === String(requestedFeed || '').toLowerCase());
        const main = feeds.find((feed) => feed.is_main) || feeds[0] || null;
        const selected = exact || main;
        const groupedId = selected && !isQualityFeed(selected) ? selected.id : 'main';
        return { selected, groupedId, feeds };
    }

    function ensureEntity(channel, requestedFeed) {
        const { selected, groupedId, feeds } = resolveFeed(channel, requestedFeed);
        const key = feedKey(channel.id, groupedId);
        if (!entities.has(key)) {
            const languages = selected?.languages?.length
                ? selected.languages
                : feeds.filter((feed) => feed.is_main).flatMap((feed) => feed.languages || []);
            const uniqueLanguages = [...new Set(languages)];
            const feedName = selected && groupedId !== 'main' && !/^(?:sd|hd|fhd|uhd|4k)$/i.test(selected.name || '') ? selected.name : '';
            const guide = (guidesByChannel.get(channel.id.toLowerCase()) || [])
                .sort((a, b) => Number(String(b.feed || '').toLowerCase() === String(selected?.id || '').toLowerCase()) - Number(String(a.feed || '').toLowerCase() === String(selected?.id || '').toLowerCase()))[0] || null;
            entities.set(key, {
                id: `iptv-org-${channel.id}${groupedId === 'main' ? '' : `@${groupedId}`}`,
                channelId: channel.id,
                feedId: selected?.id || null,
                name: feedName ? `${channel.name} — ${feedName}` : channel.name,
                altNames: [...new Set([...(channel.alt_names || []), ...(selected?.alt_names || [])])],
                country: channel.country,
                countryName: countryNames.get(channel.country) || channel.country,
                language: uniqueLanguages[0] || '',
                languages: uniqueLanguages,
                languageNames: uniqueLanguages.map((code) => languageNames.get(code) || code),
                categories: (channel.categories || []).map((id) => categoryNames.get(id) || id),
                category: normalizeCategory(channel.categories || [], channel.name),
                logo: chooseLogo(logosByChannel.get(channel.id.toLowerCase()) || [], '', selected?.id),
                website: channel.website || '',
                isNsfw: false,
                guide: guide ? { site: guide.site, siteId: guide.site_id, name: guide.site_name, lang: guide.lang, sources: guide.sources || [] } : null,
                scopes: [...new Set([channel.country === 'FR' ? 'france' : '', uniqueLanguages.includes('fra') ? 'francophone' : ''].filter(Boolean))],
                source: 'iptv-org-api',
                sources: []
            });
        }
        return entities.get(key);
    }

    function addSource(entity, source) {
        if (!source.url) return;
        if (entity.sources.some((item) => item.url === source.url)) {
            stats.duplicateMerges += 1;
            return;
        }
        entity.sources.push(source);
    }

    for (const stream of api.streams) {
        const channel = activeChannel(stream.channel);
        if (!channel) { stats.excludedUnmatched += 1; continue; }
        const entity = ensureEntity(channel, stream.feed);
        if (!entity.scopes.length) continue;
        addSource(entity, normalizeSource(stream, 'IPTV-org API'));
    }

    for (const parsed of playlists) {
        for (const item of parsed.channels || []) {
            for (const rawSource of item.sources || []) stats.rawPlaylistStreams += 1;
            const tvg = parseTvgId(item.tvgId);
            let channel = activeChannel(tvg.channel);
            if (!channel && item.name) {
                const wanted = normalizeChannelName(item.name);
                channel = [...channelsById.values()].find((candidate) => normalizeChannelName(candidate.name) === wanted) || null;
            }
            if (!channel) continue;
            const entity = ensureEntity(channel, tvg.feed);
            if (!entity.scopes.length) continue;
            for (const rawSource of item.sources || []) addSource(entity, normalizeSource(rawSource, 'IPTV-org M3U'));
        }
    }

    stats.excludedNoPlayableSource = [...entities.values()].filter((channel) => channel.sources.length && !channel.sources.some((source) => source.playable)).length;
    const channels = [...entities.values()]
        .filter((channel) => channel.sources.some((source) => source.playable))
        .map((channel) => {
            const sources = channel.sources.sort((a, b) => (
                Number(b.playable) - Number(a.playable) ||
                Number(b.secure) - Number(a.secure) ||
                Number(a.status === 'unavailable') - Number(b.status === 'unavailable') ||
                Number(a.geoBlocked) - Number(b.geoBlocked) ||
                qualityRank(b.quality) - qualityRank(a.quality)
            ));
            return { ...channel, maxQuality: sources.map((source) => source.quality).sort((a, b) => qualityRank(b) - qualityRank(a))[0] || '', sources };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const allSources = channels.flatMap((channel) => channel.sources);
    Object.assign(stats, {
        total: channels.length,
        france: channels.filter((channel) => channel.scopes.includes('france')).length,
        francophone: channels.filter((channel) => channel.scopes.includes('francophone')).length,
        sources: allSources.length,
        https: allSources.filter((source) => source.secure).length,
        httpRejected: allSources.filter((source) => !source.secure).length,
        unavailable: allSources.filter((source) => source.status === 'unavailable').length,
        unchecked: allSources.filter((source) => source.status === 'unchecked').length,
        geoBlocked: allSources.filter((source) => source.geoBlocked).length,
        not24x7: allSources.filter((source) => source.intermittent).length,
        withLogo: channels.filter((channel) => channel.logo).length,
        withGuide: channels.filter((channel) => channel.guide).length
    });
    return { channels, stats };
}

function createIptvOrgApiService(options = {}) {
    const axios = options.axios;
    const cacheFile = options.cacheFile;
    const fallbackFile = options.fallbackFile;
    const supplementFile = options.supplementFile;
    const maxAge = Number(options.maxAge) || 8 * 60 * 60 * 1000;
    const timeout = Number(options.timeout) || 30000;
    let snapshot = null;
    let refreshPromise = null;
    let lastError = '';

    function readSnapshot(file, source) {
        try {
            const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
            const data = parsed.data || parsed;
            return data.schemaVersion === SCHEMA_VERSION && Array.isArray(data.channels) ? { ...data, cacheSource: source } : null;
        } catch { return null; }
    }

    function loadFallback() {
        if (!snapshot) snapshot = readSnapshot(cacheFile, 'runtime') || readSnapshot(fallbackFile, 'bundled');
        return snapshot;
    }

    function writeSnapshot(data) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        const temporary = `${cacheFile}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
        fs.renameSync(temporary, cacheFile);
    }

    async function fetchWithRetry(url, responseType = 'json') {
        let error;
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const response = await axios.get(url, { timeout, responseType, maxContentLength: 40 * 1024 * 1024 });
                return response.data;
            } catch (current) {
                error = current;
                if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
            }
        }
        throw error;
    }

    async function refresh(force = false) {
        if (refreshPromise) return refreshPromise;
        const current = loadFallback();
        if (!force && current?.updatedAt && Date.now() - new Date(current.updatedAt).getTime() < maxAge) return current;
        refreshPromise = (async () => {
            try {
                const results = await Promise.all([
                    ...RESOURCES.map((name) => fetchWithRetry(`${API_BASE}/${name}.json`)),
                    fetchWithRetry(PLAYLIST_URL, 'text')
                ]);
                const api = Object.fromEntries(RESOURCES.map((name, index) => [name, results[index]]));
                const playlists = [parseM3u(results[RESOURCES.length])];
                if (supplementFile && fs.existsSync(supplementFile)) playlists.push(parseM3u(fs.readFileSync(supplementFile, 'utf8')));
                const built = buildCatalog(api, playlists);
                const now = new Date().toISOString();
                snapshot = {
                    schemaVersion: SCHEMA_VERSION,
                    ok: true,
                    name: 'IPTV-org — API officielle',
                    sourceUrl: API_BASE,
                    updatedAt: now,
                    lastAttemptAt: now,
                    cacheSource: 'remote',
                    ...built.stats,
                    stats: built.stats,
                    channels: built.channels
                };
                lastError = '';
                writeSnapshot(snapshot);
                return snapshot;
            } catch (error) {
                lastError = error.message;
                const fallback = loadFallback();
                if (fallback) return { ...fallback, stale: true, lastError, lastAttemptAt: new Date().toISOString() };
                throw error;
            } finally { refreshPromise = null; }
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

    function findChannel(id) {
        const wanted = decodeURIComponent(String(id || '')).toLowerCase();
        return loadFallback()?.channels?.find((channel) => channel.id.toLowerCase() === wanted || channel.channelId.toLowerCase() === wanted) || null;
    }

    function hasSourceUrl(value) {
        return Boolean(loadFallback()?.channels?.some((channel) => channel.sources.some((source) => source.url === String(value || ''))));
    }

    function markSourceStatus(value, health = {}) {
        for (const channel of loadFallback()?.channels || []) {
            const source = channel.sources.find((item) => item.url === String(value || ''));
            if (!source) continue;
            source.status = health.state || source.status;
            source.checkedAt = health.checkedAt || new Date().toISOString();
            source.latency = Number(health.latency) || 0;
            return true;
        }
        return false;
    }

    function status() {
        const current = loadFallback();
        return {
            ok: Boolean(current),
            name: current?.name || 'IPTV-org — API officielle',
            sourceUrl: API_BASE,
            updatedAt: current?.updatedAt || null,
            stale: !current?.updatedAt || Date.now() - new Date(current.updatedAt).getTime() >= maxAge,
            refreshing: Boolean(refreshPromise),
            cacheSource: current?.cacheSource || null,
            ...(current?.stats || {}),
            lastError
        };
    }

    return { refresh, getSnapshot, findChannel, hasSourceUrl, markSourceStatus, status };
}

module.exports = { createIptvOrgApiService, buildCatalog, normalizeCategory, chooseLogo };
