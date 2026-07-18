const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { createIptvOrgApiService } = require('./services/iptvOrgApiService');

loadEnvFile();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '').trim();
const FSTREAM_INFO = 'https://fstream.info/';

// ⚠️ COOKIE ANTI-BOT OBLIGATOIRE
const axiosConfig = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cookie': 'fsschal=1',  // ← C'EST ÇA QUI MANQUAIT !
        'Referer': 'https://fs24.lol/'
    },
    timeout: 15000,
    maxRedirects: 5
};

axios.interceptors.response.use(undefined, async (error) => {
    const config = error.config;
    if (!config || String(config.method || 'get').toLowerCase() !== 'get') return Promise.reject(error);
    const status = error.response?.status || 0;
    if ((config.__madradorRetry || 0) >= 1 || (status > 0 && status < 500 && status !== 429)) return Promise.reject(error);
    config.__madradorRetry = (config.__madradorRetry || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return axios.request(config);
});

// URLs FrenchStream (peut changer, essaie ces variants)
const BASE_URLS = [
    'https://fs24.lol',
    'https://fs23.lol',
    'https://fs22.lol',
    'https://fs21.lol',
    'https://fs20.lol',
    'https://fs19.lol',
    'https://fs18.lol',
    'https://fs17.lol'
];

let currentBaseUrl = BASE_URLS[0];

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
        "font-src 'self' data: https://cdnjs.cloudflare.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https:",
        "media-src 'self' blob: https:",
        "frame-src 'self' https:",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; '));
    next();
});
app.use(cors());
app.use(compression({ threshold: 1024 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
    if (IS_PRODUCTION && ['/admin.html', '/diagnostic.html'].includes(req.path)) {
        return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }
    next();
});
app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: IS_PRODUCTION ? '1h' : 0,
    setHeaders: (res, filePath) => {
        if (path.extname(filePath).toLowerCase() === '.html') {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
    }
}));

function requireAdminAction(req, res, next) {
    if (!IS_PRODUCTION) return next();
    const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const token = String(req.get('x-admin-token') || bearer || '');
    if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
        return res.status(403).json({
            ok: false,
            error: 'Action administrative désactivée en production.'
        });
    }
    next();
}

// Cache simple
const cache = new Map();
const inFlightCache = new Map();
const catalogBuilds = new Map();
let fullCatalogBuildRunning = false;
let lastPublicCatalogEnsureAt = 0;
const CACHE_DURATION = 5 * 60 * 1000;
const ALL_CACHE_DURATION = 30 * 60 * 1000;
const DETAILS_CACHE_DURATION = 6 * 60 * 60 * 1000;
const SOURCES_CACHE_DURATION = 30 * 60 * 1000;
const EPISODES_CACHE_DURATION = 2 * 60 * 60 * 1000;
const DIRECT_HEALTH_CACHE_DURATION = 10 * 60 * 1000;
const DIRECT_HEALTH_TIMEOUT = 5000;
const FULL_CATALOG_PAGE_LIMITS = {
    movie: 1312,
    series: 691
};
const DEFAULT_ALL_PAGE_LIMIT = FULL_CATALOG_PAGE_LIMITS.movie;
const MAX_ALL_PAGE_LIMIT = Math.max(FULL_CATALOG_PAGE_LIMITS.movie, FULL_CATALOG_PAGE_LIMITS.series);
const CATALOG_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.CATALOG_BATCH_SIZE) || 2, 4));
const PERSISTENT_CACHE_DIR = process.env.CATALOG_CACHE_DIR
    ? path.resolve(process.env.CATALOG_CACHE_DIR)
    : path.join(__dirname, '.cache');
const PERSISTENT_DATA_CACHE_DIR = path.join(PERSISTENT_CACHE_DIR, 'data');
const BUNDLED_CATALOG_DIR = path.join(__dirname, 'data', 'catalog');
const PERSISTENT_CATALOG_DURATION = 12 * 60 * 60 * 1000;
const CATALOG_CACHE_SCHEMA_VERSION = 2;
const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_BEARER_TOKEN = process.env.TMDB_BEARER_TOKEN || process.env.TMDB_READ_TOKEN || '';
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';

const DIRECT_ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const CDN_LIVE_TV_CHANNELS_URL = 'https://api.cdnlivetv.tv/api/v1/channels/?user=cdnlivetv&plan=free';
const CDN_LIVE_TV_METADATA_FILE = path.join(__dirname, 'data', 'cdnlivetv-fr-metadata.json');
const CDN_LIVE_TV_METADATA = loadCdnLiveTvMetadata(CDN_LIVE_TV_METADATA_FILE);
const DIRECT_CHANNELS_CACHE_DURATION = 10 * 60 * 1000;
const DIRECT_PLAYLIST_CACHE_DURATION = 10 * 60 * 1000;
const DIRECT_PLAYLIST_ITEM_LIMIT = 1000;
const IPTV_ORG_CACHE_DURATION = 8 * 60 * 60 * 1000;
const iptvOrgService = createIptvOrgApiService({
    axios,
    maxAge: IPTV_ORG_CACHE_DURATION,
    timeout: 30000,
    cacheFile: path.join(PERSISTENT_DATA_CACHE_DIR, 'iptv-org-api.json'),
    fallbackFile: path.join(__dirname, 'data', 'iptv-org-api-fallback.json'),
    supplementFiles: [
        path.join(__dirname, 'data', 'iptv-org-fra-supplement.m3u'),
        path.join(__dirname, 'data', 'iptv-org-extra-supplement.m3u')
    ]
});
const DIRECT_EPG_DIRECTORY_URL = 'https://epg.pw/areas/fr.html?lang=en';
const DIRECT_EPG_CACHE_DURATION = 30 * 60 * 1000;
const DIRECT_EPG_SCHEDULE_CACHE_DURATION = 15 * 60 * 1000;
let directEpgCache = { updatedAt: 0, channels: [] };
const directEpgScheduleCache = new Map();
const DIRECT_EPG_ALIASES = {
    'bfm tv': ['BFMTV', 'BFM TV'],
    'canal plus': ['Canal+', 'Canal Plus'],
    cnews: ['CNews'],
    'france 2': ['France 2', 'France2'],
    'france 3': ['France 3', 'France3'],
    'france 4': ['France 4', 'France4'],
    'france 5': ['France 5', 'France5'],
    'france 24': ['France 24'],
    franceinfo: ['Franceinfo', 'franceinfo:'],
    lci: ['LCI'],
    m6: ['M6'],
    tf1: ['TF1'],
    tmc: ['TMC'],
    w9: ['W9']
};

function normalizeEpgName(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(french|fr|hd|fhd|uhd|4k|direct|live)\b/g, ' ')
        .replace(/\+/g, ' plus ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getEpgCandidateNames(input = {}) {
    const raw = [input.channel, input.channelId, input.tvgId, ...(input.aliases || [])]
        .flatMap((value) => String(value || '').split('|'))
        .map((value) => value.replace(/@[^\s]+$/i, '').replace(/\.(fr|be|ch|ca|ma|sn)$/i, '').trim())
        .filter(Boolean);
    const expanded = [...raw];
    raw.forEach((value) => {
        const aliases = DIRECT_EPG_ALIASES[normalizeEpgName(value)] || [];
        expanded.push(...aliases);
    });
    return [...new Set(expanded.map(normalizeEpgName).filter(Boolean))];
}

function findEpgChannelMatch(input, channels) {
    const candidates = getEpgCandidateNames(input);
    if (!candidates.length) return null;
    const matches = channels.map((channel) => {
        let best = 0;
        let matchedQuery = '';
        let matchedName = '';
        for (const candidate of candidates) {
            const wantedParts = candidate.split(' ').filter(Boolean);
            for (const rawName of channel.names || []) {
                const name = normalizeEpgName(rawName);
                if (!name) continue;
                const compactCandidate = candidate.replace(/\s+/g, '');
                const compactName = name.replace(/\s+/g, '');
                let score = name === candidate ? 140 : compactName === compactCandidate ? 120 : 0;
                if (!score && (name.startsWith(`${candidate} `) || candidate.startsWith(`${name} `))) score = 88;
                const nameParts = name.split(' ').filter(Boolean);
                const common = wantedParts.filter((part) => nameParts.includes(part)).length;
                if (common) {
                    const coverage = common / Math.max(wantedParts.length, nameParts.length);
                    score = Math.max(score, Math.round(coverage * 80) - Math.abs(nameParts.length - wantedParts.length) * 4);
                }
                if (score > best) {
                    best = score;
                    matchedQuery = candidate;
                    matchedName = rawName;
                }
            }
        }
        return { id: channel.id, channel, score: best, matchedQuery, matchedName };
    }).filter((item) => item.score >= 60).sort((a, b) => b.score - a.score);
    return matches[0] || null;
}

async function loadFranceEpg(force = false) {
    const fresh = Date.now() - directEpgCache.updatedAt < DIRECT_EPG_CACHE_DURATION;
    if (!force && fresh && directEpgCache.channels.length) return directEpgCache;

    const response = await axios.get(DIRECT_EPG_DIRECTORY_URL, {
        timeout: 20000,
        headers: { 'User-Agent': axiosConfig.headers['User-Agent'], Accept: 'text/html' }
    });
    const $directory = cheerio.load(response.data);
    const channels = [];
    const seen = new Set();
    $directory('a[href*="/last/"]').each((_, element) => {
        const href = $directory(element).attr('href') || '';
        const match = href.match(/\/last\/(\d+)\.html/i);
        const name = $directory(element).text().replace(/\s+/g, ' ').trim();
        if (!match || !name || seen.has(match[1])) return;
        seen.add(match[1]);
        channels.push({ id: match[1], names: [name], icon: '' });
    });
    if (!channels.length) throw new Error('Répertoire EPG France vide');

    directEpgCache = { updatedAt: Date.now(), channels };
    return directEpgCache;
}

async function loadChannelEpgSchedule(channelId, force = false) {
    const key = String(channelId || '').trim();
    if (!key) return [];
    const cached = directEpgScheduleCache.get(key);
    if (!force && cached && Date.now() - cached.updatedAt < DIRECT_EPG_SCHEDULE_CACHE_DURATION) return cached.items;

    const response = await axios.get(`https://epg.pw/api/epg.json?channel_id=${encodeURIComponent(key)}`, {
        timeout: 20000,
        headers: { 'User-Agent': axiosConfig.headers['User-Agent'], Accept: 'application/json' }
    });
    const sourceItems = Array.isArray(response.data?.epg_list) ? response.data.epg_list : [];
    const items = sourceItems.map((item, index) => {
        const start = new Date(item.start_date);
        const explicitStop = new Date(item.end_date || item.stop_date || '');
        const nextStart = new Date(sourceItems[index + 1]?.start_date);
        const stop = !Number.isNaN(explicitStop.getTime())
            ? explicitStop
            : Number.isNaN(nextStart.getTime()) ? new Date(start.getTime() + 60 * 60 * 1000) : nextStart;
        if (Number.isNaN(start.getTime())) return null;
        return {
            channel: key,
            start: start.toISOString(),
            stop: stop.toISOString(),
            title: String(item.title || 'Programme TV').trim(),
            subtitle: '',
            description: String(item.desc || '').trim(),
            category: ''
        };
    }).filter(Boolean);
    directEpgScheduleCache.set(key, { updatedAt: Date.now(), items });
    return items;
}

function normalizeDirectUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';

    try {
        const candidate = raw.startsWith('http://') || raw.startsWith('https://')
            ? raw
            : `https://${raw}`;
        const url = new URL(candidate);
        if (!DIRECT_ALLOWED_PROTOCOLS.has(url.protocol)) return '';
        return url.href;
    } catch {
        return '';
    }
}

function isAllowedDirectHealthUrl(value) {
    const normalized = normalizeDirectUrl(value);
    if (!normalized) return false;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return ['cdnlivetv.tv', 'event.vedge.infomaniak.com'].some((host) => hostname === host || hostname.endsWith(`.${host}`)) ||
        iptvOrgService.hasSourceUrl(normalized);
}

async function checkDirectHealth(value) {
    const url = normalizeDirectUrl(value);
    if (!url || !isAllowedDirectHealthUrl(url)) throw new Error('Source Direct non autorisée pour la vérification.');
    const key = `direct_health_${url}`;
    const result = await getOrCreateCached(key, DIRECT_HEALTH_CACHE_DURATION, async () => {
        const startedAt = Date.now();
        try {
            const isHls = new URL(url).pathname.toLowerCase().endsWith('.m3u8');
            const response = await axios.get(url, {
                ...axiosConfig,
                timeout: DIRECT_HEALTH_TIMEOUT,
                responseType: isHls ? 'text' : 'stream',
                maxContentLength: isHls ? 512 * 1024 : 1024 * 1024,
                validateStatus: (status) => status >= 200 && status < 500
            });
            if (!isHls) response.data?.destroy?.();
            const latency = Date.now() - startedAt;
            const validHls = !isHls || await validateHlsManifestAndSegment(url, String(response.data));
            const available = response.status < 400 && validHls;
            return {
                ok: available,
                state: available ? (latency > 2500 ? 'slow' : 'available') : 'unavailable',
                latency,
                status: response.status,
                checkedAt: new Date().toISOString()
            };
        } catch (error) {
            return {
                ok: false,
                state: error.code === 'ECONNABORTED' ? 'slow' : 'unavailable',
                latency: Date.now() - startedAt,
                status: error.response?.status || 0,
                checkedAt: new Date().toISOString()
            };
        }
    });
    iptvOrgService.markSourceStatus(url, result);
    return result;
}

async function validateHlsManifestAndSegment(manifestUrl, manifestText) {
    if (!/^\s*#EXTM3U/m.test(manifestText)) return false;
    let mediaUrl = manifestUrl;
    let mediaText = manifestText;
    if (/#EXT-X-STREAM-INF/i.test(mediaText)) {
        const lines = mediaText.split(/\r?\n/).map((line) => line.trim());
        const variant = lines.find((line, index) => index > 0 && !line.startsWith('#') && /#EXT-X-STREAM-INF/i.test(lines.slice(0, index).at(-1) || '')) ||
            lines.find((line) => line && !line.startsWith('#'));
        if (!variant) return false;
        mediaUrl = new URL(variant, manifestUrl).href;
        const mediaResponse = await axios.get(mediaUrl, { ...axiosConfig, timeout: DIRECT_HEALTH_TIMEOUT, responseType: 'text', maxContentLength: 512 * 1024 });
        mediaText = String(mediaResponse.data);
    }
    if (!/#EXTINF|#EXT-X-MEDIA-SEQUENCE/i.test(mediaText)) return false;
    const segment = mediaText.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
    if (!segment) return false;
    const segmentUrl = new URL(segment, mediaUrl).href;
    const segmentResponse = await axios.get(segmentUrl, {
        ...axiosConfig,
        timeout: DIRECT_HEALTH_TIMEOUT,
        responseType: 'stream',
        headers: { ...axiosConfig.headers, Range: 'bytes=0-1023' },
        validateStatus: (status) => status >= 200 && status < 500
    });
    segmentResponse.data?.destroy?.();
    return segmentResponse.status < 400;
}

function extractDirectUrlFromText(value) {
    const text = String(value || '').replace(/^\uFEFF/, '').trim();
    if (!text) return '';

    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const line of lines) {
        if (line.startsWith('#')) continue;
        const urlLine = line.match(/^URL=(.+)$/i);
        const candidate = urlLine ? urlLine[1].trim() : line;
        const direct = normalizeDirectUrl(candidate);
        if (direct) return direct;
    }

    const match = text.match(/https?:\/\/[^\s"'<>]+/i);
    return match ? normalizeDirectUrl(match[0]) : '';
}

function getDirectType(url) {
    const clean = String(url || '').split('?')[0].toLowerCase();
    if (clean.endsWith('.m3u8')) return 'hls';
    if (clean.endsWith('.m3u')) return 'playlist';
    if (clean.endsWith('.mp4')) return 'video';
    if (clean.endsWith('.webm')) return 'video';
    if (clean.endsWith('.mkv')) return 'video';
    if (clean.endsWith('.avi')) return 'video';
    return 'iframe';
}

function buildDirectResponse(input = {}) {
    const url = normalizeDirectUrl(input.url) || extractDirectUrlFromText(input.content);
    if (!url) {
        return {
            ok: false,
            error: 'Aucune URL http/https valide trouvée.',
            url: '',
            type: '',
            filename: input.filename || ''
        };
    }

    const parsed = new URL(url);
    return {
        ok: true,
        url,
        type: getDirectType(url),
        title: parsed.hostname.replace(/^www\./, '') || 'Direct',
        hostname: parsed.hostname,
        filename: input.filename || '',
        playable: true
    };
}

function parseDirectPlaylist(content, options = {}) {
    const text = String(content || '').replace(/^\uFEFF/, '').trim();
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const items = [];
    const seen = new Set();
    let metadata = {};

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            const attributes = {};
            line.replace(/([\w-]+)="([^"]*)"/g, (_match, key, value) => {
                attributes[key.toLowerCase()] = value.trim();
                return _match;
            });
            const comma = line.lastIndexOf(',');
            metadata = {
                name: comma >= 0 ? line.slice(comma + 1).trim() : '',
                logo: attributes['tvg-logo'] || '',
                group: attributes['group-title'] || '',
                tvgId: attributes['tvg-id'] || '',
                language: attributes['tvg-language'] || ''
            };
            continue;
        }

        if (line.startsWith('#')) continue;
        const url = normalizeDirectUrl(line.replace(/^URL=/i, ''));
        if (!url || seen.has(url)) {
            metadata = {};
            continue;
        }

        seen.add(url);
        const parsed = new URL(url);
        const name = metadata.name || parsed.hostname.replace(/^www\./, '') || `Chaîne ${items.length + 1}`;
        items.push({
            id: `${metadata.tvgId || name}-${items.length + 1}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
            name,
            title: name,
            url,
            image: normalizeDirectUrl(metadata.logo),
            group: metadata.group || 'Playlist',
            language: metadata.language,
            type: getDirectType(url),
            source: 'playlist'
        });
        metadata = {};
        if (items.length >= DIRECT_PLAYLIST_ITEM_LIMIT) break;
    }

    return {
        ok: items.length > 0,
        type: 'playlist',
        filename: String(options.filename || ''),
        sourceUrl: String(options.sourceUrl || ''),
        total: items.length,
        items,
        first: items[0] || null,
        error: items.length ? undefined : 'Aucun flux valide trouvé dans la playlist.'
    };
}

async function loadDirectPlaylist(url) {
    const normalizedUrl = normalizeDirectUrl(url);
    if (!normalizedUrl) throw new Error('URL de playlist invalide.');
    const cacheKey = `direct_playlist_${normalizedUrl}`;
    const cached = getCachedFor(cacheKey, DIRECT_PLAYLIST_CACHE_DURATION);
    if (cached) return cached;

    const response = await axios.get(normalizedUrl, {
        timeout: 15000,
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024,
        headers: {
            'User-Agent': axiosConfig.headers['User-Agent'],
            'Accept': 'application/vnd.apple.mpegurl,audio/x-mpegurl,text/plain,*/*'
        }
    });
    const result = parseDirectPlaylist(response.data, { sourceUrl: normalizedUrl });
    if (!result.ok) throw new Error(result.error);
    setCachedFor(cacheKey, result);
    return result;
}

function normalizeDirectChannel(channel = {}, index = 0) {
    const name = String(channel.name || '').trim();
    const code = String(channel.code || '').trim().toLowerCase();
    const url = normalizeDirectUrl(channel.url);
    const metadata = findCdnLiveTvMetadata(name);
    const image = normalizeDirectUrl(metadata?.image || channel.image);

    return {
        id: `${code || 'xx'}-${name || index}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name: name || `Chaîne ${index + 1}`,
        code,
        country: code.toUpperCase(),
        url,
        image,
        status: String(channel.status || 'unknown').toLowerCase(),
        viewers: Number(channel.viewers || 0),
        type: getDirectType(url),
        category: normalizeDirectMetadataCategory(metadata?.category) || classifyDirectChannel(name, code),
        source: 'cdnlivetv',
        metadataSource: metadata ? 'chaines-francaises-completes' : 'cdnlivetv'
    };
}

function loadCdnLiveTvMetadata(filename) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
        return Array.isArray(parsed)
            ? parsed.filter((item) => item && item.channel_name && normalizeDirectUrl(item.image))
            : [];
    } catch (error) {
        console.warn('[DIRECT] Métadonnées CDNLiveTV indisponibles :', error.message);
        return [];
    }
}

function normalizeDirectMetadataName(value) {
    return String(value || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\+/g, ' plus ')
        .replace(/\bsports\b/g, 'sport')
        .replace(/\bsport\s*360\b/g, '360')
        .replace(/\bplus\b/g, '')
        .replace(/\b(?:france|fr|hd|fhd)\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function findCdnLiveTvMetadata(name) {
    const key = normalizeDirectMetadataName(name);
    if (!key) return null;
    return CDN_LIVE_TV_METADATA.find((item) => normalizeDirectMetadataName(item.channel_name) === key) || null;
}

function normalizeDirectMetadataCategory(value) {
    if (/^general$/i.test(String(value || '').trim())) return 'Généralistes';
    if (/^sports?$/i.test(String(value || '').trim())) return 'Sports';
    return '';
}

function classifyDirectChannel(name, code) {
    const value = String(name || '').toLowerCase();
    if (/sport|espn|bein|racing|football|soccer|nba|nfl|tennis|golf/.test(value)) return 'Sports';
    if (/news|info|actualité|actualite|cnn|bbc|fox news|weather/.test(value)) return 'Information';
    if (/music|musique|mtv|radio|hits|vevo/.test(value)) return 'Musique';
    if (/kids|junior|cartoon|nick|disney|baby|enfant/.test(value)) return 'Jeunesse';
    if (/movie|movies|cinema|film|series|drama|action/.test(value)) return 'Cinéma & séries';

    const countries = {
        fr: 'France', us: 'États-Unis', gb: 'Royaume-Uni', uk: 'Royaume-Uni',
        ca: 'Canada', be: 'Belgique', ch: 'Suisse', de: 'Allemagne', es: 'Espagne',
        it: 'Italie', pt: 'Portugal', ma: 'Maroc', dz: 'Algérie', tn: 'Tunisie'
    };
    return countries[String(code || '').toLowerCase()] || 'International';
}

async function getDirectChannels() {
    const cacheKey = 'direct_channels_cdnlivetv';
    const cached = getCachedFor(cacheKey, DIRECT_CHANNELS_CACHE_DURATION);
    if (cached) return cached;

    const response = await axios.get(CDN_LIVE_TV_CHANNELS_URL, {
        timeout: 15000,
        headers: {
            'User-Agent': axiosConfig.headers['User-Agent'],
            'Accept': 'application/json,text/plain,*/*'
        }
    });

    const channels = Array.isArray(response.data?.channels)
        ? response.data.channels.map(normalizeDirectChannel).filter((channel) => channel.url)
        : [];

    const result = {
        ok: true,
        source: 'cdnlivetv',
        metadataSource: 'chaines-francaises-completes',
        metadataCount: CDN_LIVE_TV_METADATA.length,
        total: Number(response.data?.total_channels || channels.length),
        count: channels.length,
        channels,
        updatedAt: new Date().toISOString()
    };
    setCachedFor(cacheKey, result);
    return result;
}

function decodeBase64Url(value) {
    const clean = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(clean, 'base64').toString('utf8');
}

function extractCdnLiveStream(html) {
    const source = String(html || '');
    const values = new Map(
        Array.from(source.matchAll(/var\s+(\w+)='([^']*)';/g), (match) => [match[1], match[2]])
    );
    const assignments = Array.from(source.matchAll(/var\s+(\w+)=((?:\w+\(\w+\)\+?)+);/g));

    for (const assignment of assignments) {
        const names = Array.from(assignment[2].matchAll(/\((\w+)\)/g), (match) => match[1]);
        if (!names.length) continue;
        try {
            const url = names.map((name) => decodeBase64Url(values.get(name) || '')).join('');
            if (/^https:\/\/[^\s]+\.m3u8(?:\?|$)/i.test(url)) return url;
        } catch {}
    }
    return '';
}

async function resolveCdnLiveStream(playerUrl) {
    const normalizedUrl = normalizeDirectUrl(playerUrl);
    if (!normalizedUrl) throw new Error('URL lecteur invalide.');
    const parsed = new URL(normalizedUrl);
    if (!parsed.hostname.endsWith('cdnlivetv.tv') || !parsed.pathname.includes('/api/v1/channels/player/')) {
        throw new Error('Cette URL ne correspond pas à un lecteur CDNLiveTV.');
    }

    const response = await axios.get(normalizedUrl, {
        timeout: 15000,
        headers: {
            'User-Agent': axiosConfig.headers['User-Agent'],
            'Accept': 'text/html,application/xhtml+xml'
        }
    });
    const streamUrl = extractCdnLiveStream(response.data);
    if (!streamUrl) throw new Error('Flux HLS introuvable ou temporairement indisponible.');
    return {
        ok: true,
        source: 'cdnlivetv',
        playerUrl: normalizedUrl,
        url: streamUrl,
        type: 'hls',
        resolvedAt: new Date().toISOString()
    };
}

function loadEnvFile() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (!fs.existsSync(envPath)) return;

        fs.readFileSync(envPath, 'utf8')
            .split(/\r?\n/)
            .forEach((line) => {
                const clean = line.trim();
                if (!clean || clean.startsWith('#')) return;
                const index = clean.indexOf('=');
                if (index === -1) return;

                const key = clean.slice(0, index).trim();
                let value = clean.slice(index + 1).trim();
                if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                    value = value.slice(1, -1);
                }
                if (key && process.env[key] === undefined) {
                    process.env[key] = value;
                }
            });
    } catch (error) {
        console.log(`[ENV] Lecture .env impossible : ${error.message}`);
    }
}

function ensurePersistentCacheDir() {
    if (!fs.existsSync(PERSISTENT_CACHE_DIR)) {
        fs.mkdirSync(PERSISTENT_CACHE_DIR, { recursive: true });
    }
}

function getPersistentCatalogPath(kind, limit) {
    return path.join(PERSISTENT_CACHE_DIR, `${kind}-catalog-${limit}.json`);
}

function getPersistentCatalogCheckpointPath(kind, limit) {
    return path.join(PERSISTENT_CACHE_DIR, `${kind}-catalog-${limit}.checkpoint.json`);
}

function getBundledCatalogPath(kind, limit) {
    return path.join(BUNDLED_CATALOG_DIR, `${kind}-catalog-${limit}.json`);
}

function installBundledCatalogSeeds() {
    ensurePersistentCacheDir();

    for (const [kind, limit] of Object.entries(FULL_CATALOG_PAGE_LIMITS)) {
        const target = getPersistentCatalogPath(kind, limit);
        const bundled = getBundledCatalogPath(kind, limit);
        if (fs.existsSync(target) || !fs.existsSync(bundled)) continue;

        try {
            const parsed = JSON.parse(fs.readFileSync(bundled, 'utf8'));
            if (parsed?.schemaVersion !== CATALOG_CACHE_SCHEMA_VERSION || parsed?.data?.complete !== true) {
                throw new Error('snapshot incomplet ou incompatible');
            }

            parsed.savedAt = Date.now();
            parsed.data.generatedAt = parsed.data.generatedAt || new Date().toISOString();
            fs.writeFileSync(target, JSON.stringify(parsed), 'utf8');
            console.log(`[CACHE] Catalogue ${kind} amorce avec ${parsed.data.total || parsed.data.items?.length || 0} titres.`);
        } catch (error) {
            console.log(`[CACHE] Amorçage catalogue impossible (${kind}) : ${error.message}`);
        }
    }
}

function readPersistentCatalog(kind, limit, options = {}) {
    try {
        const file = getPersistentCatalogPath(kind, limit);
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed?.savedAt) return null;
        if (parsed.schemaVersion !== CATALOG_CACHE_SCHEMA_VERSION || parsed.data?.complete !== true) return null;
        const stale = Date.now() - parsed.savedAt > PERSISTENT_CATALOG_DURATION;
        if (stale && !options.allowStale) return null;
        return parsed.data ? { ...parsed.data, stale, savedAt: parsed.savedAt } : null;
    } catch (error) {
        console.log(`[CACHE] Lecture cache persistant impossible (${kind}) : ${error.message}`);
        return null;
    }
}

function readPersistentCatalogCheckpoint(kind, limit) {
    try {
        const file = getPersistentCatalogCheckpointPath(kind, limit);
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed?.savedAt || Date.now() - parsed.savedAt > PERSISTENT_CATALOG_DURATION) return null;
        return parsed.data || null;
    } catch (error) {
        console.log(`[CACHE] Lecture checkpoint impossible (${kind}) : ${error.message}`);
        return null;
    }
}

function writePersistentCatalog(kind, limit, data) {
    try {
        ensurePersistentCacheDir();
        fs.writeFileSync(
            getPersistentCatalogPath(kind, limit),
            JSON.stringify({ schemaVersion: CATALOG_CACHE_SCHEMA_VERSION, savedAt: Date.now(), data }, null, 2),
            'utf8'
        );
    } catch (error) {
        console.log(`[CACHE] Ecriture cache persistant impossible (${kind}) : ${error.message}`);
    }
}

function writePersistentCatalogCheckpoint(kind, limit, data) {
    try {
        ensurePersistentCacheDir();
        fs.writeFileSync(
            getPersistentCatalogCheckpointPath(kind, limit),
            JSON.stringify({ schemaVersion: CATALOG_CACHE_SCHEMA_VERSION, savedAt: Date.now(), data }, null, 2),
            'utf8'
        );
    } catch (error) {
        console.log(`[CACHE] Ecriture checkpoint impossible (${kind}) : ${error.message}`);
    }
}

function getPersistentDataPath(key) {
    const safeKey = String(key).replace(/[^a-z0-9_.-]+/gi, '_').slice(0, 180);
    return path.join(PERSISTENT_DATA_CACHE_DIR, `${safeKey}.json`);
}

function readPersistentData(key, duration) {
    try {
        const file = getPersistentDataPath(key);
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed?.savedAt || Date.now() - parsed.savedAt > duration) return null;
        return parsed.data ?? null;
    } catch {
        return null;
    }
}

function writePersistentData(key, data) {
    try {
        fs.mkdirSync(PERSISTENT_DATA_CACHE_DIR, { recursive: true });
        fs.writeFileSync(getPersistentDataPath(key), JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
    } catch (error) {
        console.log(`[CACHE] Écriture donnée impossible (${key}) : ${error.message}`);
    }
}

function clearPersistentCatalogCheckpoint(kind, limit) {
    try {
        const file = getPersistentCatalogCheckpointPath(kind, limit);
        if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (error) {
        console.log(`[CACHE] Nettoyage checkpoint impossible (${kind}) : ${error.message}`);
    }
}

function getCatalogBuildState(kind, limit) {
    const key = `${kind}:${limit}`;
    if (!catalogBuilds.has(key)) {
        catalogBuilds.set(key, {
            kind,
            limit,
            state: 'idle',
            page: 0,
            total: 0,
            error: null,
            startedAt: null,
            updatedAt: null,
            doneAt: null
        });
    }
    return catalogBuilds.get(key);
}

function updateCatalogBuildState(kind, limit, patch) {
    const current = getCatalogBuildState(kind, limit);
    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    return current;
}

function getCached(key) {
    const item = cache.get(key);
    if (item && Date.now() - item.time < CACHE_DURATION) {
        return item.data;
    }
    return null;
}

function getCachedFor(key, duration) {
    const item = cache.get(key);
    if (item && Date.now() - item.time < duration) {
        return item.data;
    }
    return null;
}

function setCached(key, data) {
    cache.set(key, { data, time: Date.now() });
}

function setCachedFor(key, data) {
    cache.set(key, { data, time: Date.now() });
}

async function getOrCreateCached(key, duration, loader, options = {}) {
    const cached = getCachedFor(key, duration);
    if (cached !== null) return cached;
    if (options.persistent) {
        const persisted = readPersistentData(key, duration);
        if (persisted !== null) {
            setCachedFor(key, persisted);
            return persisted;
        }
    }
    if (inFlightCache.has(key)) return inFlightCache.get(key);

    const task = Promise.resolve()
        .then(loader)
        .then((data) => {
            if (data !== undefined && data !== null) {
                setCachedFor(key, data);
                if (options.persistent) writePersistentData(key, data);
            }
            return data;
        })
        .finally(() => inFlightCache.delete(key));

    inFlightCache.set(key, task);
    return task;
}

function getApiId(value) {
    const clean = String(value || '').trim();
    const match = clean.match(/^\d+/);
    return match ? match[0] : clean;
}

function toAbsoluteUrl(url) {
    if (!url) return '';
    if (url.startsWith('http')) return url;
    if (url.startsWith('//')) return `https:${url}`;
    if (url.startsWith('/')) return `${currentBaseUrl}${url}`;
    return url;
}

function parseSeasonTitle(title) {
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    const patterns = [
        /^(.*?)\s*[-–—:|]\s*(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
        /^(.*?)\s+(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
        /^(.*?)\s*[-–—:|]\s*S(\d{1,2})(?=\D|$)/i,
        /^(.*?)\s+\bS(\d{1,2})\b(?=\D|$)/i
    ];

    for (const pattern of patterns) {
        const match = clean.match(pattern);
        if (match?.[1] && match?.[2]) {
            return {
                baseTitle: match[1].trim(),
                season: Number(match[2])
            };
        }
    }

    return { baseTitle: clean, season: null };
}

function normalizeTitleKey(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function cleanDuplicatedTitle(value) {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    if (!title) return title;
    if (title.length % 2 === 0) {
        const half = title.length / 2;
        const left = title.slice(0, half).trim();
        const right = title.slice(half).trim();
        if (left && normalizeTitleKey(left) === normalizeTitleKey(right)) return left;
    }
    return title.replace(/(.+?\bSaison\s*\d+)\s*\1$/i, '$1').trim();
}

function isTmdbConfigured() {
    return Boolean(TMDB_BEARER_TOKEN || TMDB_API_KEY);
}

function getTmdbAuthConfig(params = {}) {
    const config = {
        timeout: 10000,
        params: {
            language: 'fr-FR',
            ...params
        }
    };

    if (TMDB_BEARER_TOKEN) {
        config.headers = {
            Authorization: `Bearer ${TMDB_BEARER_TOKEN}`,
            Accept: 'application/json'
        };
    } else if (TMDB_API_KEY) {
        config.params.api_key = TMDB_API_KEY;
    }

    return config;
}

async function tmdbGet(pathname, params = {}) {
    try {
        return await axios.get(`${TMDB_API_BASE}${pathname}`, getTmdbAuthConfig(params));
    } catch (error) {
        if (error.response?.status !== 401 || !TMDB_BEARER_TOKEN || !TMDB_API_KEY) throw error;
        return axios.get(`${TMDB_API_BASE}${pathname}`, {
            timeout: 10000,
            params: { language: 'fr-FR', ...params, api_key: TMDB_API_KEY },
            headers: { Accept: 'application/json' }
        });
    }
}

function getTmdbImage(pathname, size = 'w780') {
    if (!pathname) return '';
    if (String(pathname).startsWith('http')) return pathname;
    return `${TMDB_IMAGE_BASE}/${size}${pathname}`;
}

function getTmdbYear(item = {}) {
    const date = item.release_date || item.first_air_date || '';
    return date ? String(date).slice(0, 4) : '';
}

function getTmdbScore(result = {}, titleKey = '', year = '') {
    const resultTitle = normalizeTitleKey(result.title || result.name || result.original_title || result.original_name || '');
    let score = 0;
    if (resultTitle === titleKey) score += 80;
    else if (resultTitle.includes(titleKey) || titleKey.includes(resultTitle)) score += 45;
    if (year && getTmdbYear(result) === String(year)) score += 18;
    score += Math.min(Number(result.popularity || 0), 100) / 10;
    if (result.poster_path) score += 5;
    if (result.backdrop_path) score += 8;
    return score;
}

function pickTmdbResult(results = [], title = '', year = '') {
    const titleKey = normalizeTitleKey(title);
    if (!titleKey || !Array.isArray(results) || !results.length) return null;

    return results
        .filter((item) => item && (item.poster_path || item.backdrop_path || item.overview))
        .map((item) => ({ item, score: getTmdbScore(item, titleKey, year) }))
        .sort((a, b) => b.score - a.score)[0]?.item || null;
}

function getTmdbVideoUrl(videos = {}, options = {}) {
    const results = Array.isArray(videos.results) ? videos.results : [];
    const video = results
        .filter((item) => item.site === 'YouTube' && item.key)
        .map((item, index) => {
            const name = String(item.name || '');
            const frenchLanguage = String(item.iso_639_1 || '').toLowerCase() === 'fr';
            const frenchDub = /\bVF\b|version fran[cç]aise|doubl[eé].*fran[cç]ais|bande[- ]annonce fran[cç]aise/i.test(name)
                && !/VOST|sous[- ]titr/i.test(name);
            const french = frenchDub || frenchLanguage;
            if (options.frenchOnly && !french) return null;
            let score = 0;
            if (item.type === 'Trailer') score += 100;
            else if (item.type === 'Teaser') score += 35;
            if (item.official) score += 20;
            if (frenchLanguage) score += 90;
            if (frenchDub) score += 80;
            if (/VOST|sous[- ]titr/i.test(name)) score -= 20;
            return { item, score, index };
        })
        .filter(Boolean)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.item;
    return video?.key ? `https://www.youtube.com/watch?v=${video.key}` : '';
}

async function getPreferredTmdbTrailer(mediaType, tmdbId, appendedVideos = {}) {
    const appendedFrench = getTmdbVideoUrl(appendedVideos, { frenchOnly: true });
    if (appendedFrench) return appendedFrench;

    for (const language of ['fr-FR', 'fr-CA']) {
        try {
            const response = await tmdbGet(`/${mediaType}/${tmdbId}/videos`, { language });
            const french = getTmdbVideoUrl(response.data, { frenchOnly: true });
            if (french) return french;
        } catch (error) {
            console.log(`[TMDB] Bande-annonce ${language} indisponible (${tmdbId}) : ${error.message}`);
        }
    }

    const appendedFallback = getTmdbVideoUrl(appendedVideos);
    if (appendedFallback) return appendedFallback;
    try {
        const response = await tmdbGet(`/${mediaType}/${tmdbId}/videos`, { language: 'en-US' });
        return getTmdbVideoUrl(response.data);
    } catch (error) {
        return '';
    }
}

async function fetchTmdbDetails({ title, year, type = 'movie' }) {
    if (!isTmdbConfigured()) return null;

    const clean = cleanDuplicatedTitle(parseSeasonTitle(title).baseTitle || title);
    const mediaType = type === 'series' ? 'tv' : 'movie';
    const cacheKey = `tmdb_${mediaType}_${normalizeTitleKey(clean)}_${year || 'any'}`;
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached) return cached;

    try {
        const searchParams = {
            query: clean,
            include_adult: false
        };
        if (year && mediaType === 'movie') searchParams.year = year;
        if (year && mediaType === 'tv') searchParams.first_air_date_year = year;

        const search = await tmdbGet(`/search/${mediaType}`, searchParams);
        const result = pickTmdbResult(search.data?.results, clean, year);
        if (!result?.id) {
            setCachedFor(cacheKey, null);
            return null;
        }

        const detail = await tmdbGet(`/${mediaType}/${result.id}`, {
            append_to_response: 'videos',
            include_image_language: 'fr,en,null'
        });
        const data = detail.data || {};
        const trailer = await getPreferredTmdbTrailer(mediaType, data.id || result.id, data.videos);
        const tmdb = {
            tmdbId: data.id,
            tmdbType: mediaType,
            tmdbUrl: `https://www.themoviedb.org/${mediaType}/${data.id}`,
            title: data.title || data.name || result.title || result.name || clean,
            description: data.overview || result.overview || '',
            poster: getTmdbImage(data.poster_path || result.poster_path, 'w500'),
            backdrop: getTmdbImage(data.backdrop_path || result.backdrop_path, 'w780'),
            year: getTmdbYear(data) || getTmdbYear(result) || '',
            genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).filter(Boolean) : [],
            trailer,
            voteAverage: data.vote_average || result.vote_average || null
        };

        setCachedFor(cacheKey, tmdb);
        return tmdb;
    } catch (error) {
        console.log(`[TMDB] Enrichissement impossible (${clean}) : ${error.message}`);
        setCachedFor(cacheKey, null);
        return null;
    }
}

async function fetchTmdbRecommendations(type, tmdbId) {
    if (!isTmdbConfigured() || !tmdbId) return [];
    const mediaType = type === 'series' || type === 'tv' ? 'tv' : 'movie';
    const cacheKey = `tmdb_recommendations_${mediaType}_${tmdbId}`;
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached) return cached;

    try {
        const response = await tmdbGet(`/${mediaType}/${tmdbId}/recommendations`, { page: 1 });
        const items = (response.data?.results || []).slice(0, 18).map((item) => ({
            tmdbId: item.id,
            type: mediaType === 'tv' ? 'series' : 'movie',
            title: item.title || item.name || item.original_title || item.original_name || '',
            description: item.overview || '',
            poster: getTmdbImage(item.poster_path, 'w500'),
            backdrop: getTmdbImage(item.backdrop_path, 'w780'),
            year: getTmdbYear(item),
            rating: item.vote_average || null
        })).filter((item) => item.title && (item.poster || item.backdrop));
        setCachedFor(cacheKey, items);
        return items;
    } catch (error) {
        console.log(`[TMDB] Recommandations indisponibles (${mediaType}/${tmdbId}) : ${error.message}`);
        return [];
    }
}

function shouldReplaceImage(currentUrl = '') {
    const url = String(currentUrl || '');
    if (!url) return true;
    if (url.includes('image.tmdb.org')) return false;
    return /\/uploads\/|\/poster_|\/thumb|\/resize|\/cache/i.test(url);
}

async function enrichDetailsWithTmdb(details = {}, type = 'movie') {
    if (!details?.title || !isTmdbConfigured()) return details;

    const parsed = parseSeasonTitle(details.title);
    const tmdb = await fetchTmdbDetails({
        title: type === 'series' ? (parsed.baseTitle || details.title) : details.title,
        year: details.year,
        type
    });
    if (!tmdb) return details;

    return {
        ...details,
        description: details.description && details.description.length > 40 ? details.description : (tmdb.description || details.description || ''),
        synopsis: details.synopsis && details.synopsis.length > 40 ? details.synopsis : (tmdb.description || details.synopsis || ''),
        poster: shouldReplaceImage(details.poster) ? (tmdb.poster || details.poster || '') : details.poster,
        backdrop: shouldReplaceImage(details.backdrop) ? (tmdb.backdrop || details.backdrop || details.poster || '') : details.backdrop,
        // TMDB metadata is curated and lets us prefer the official VF trailer
        // when the scraped page exposes a VOST link that blocks embedding.
        trailer: tmdb.trailer || details.trailer || '',
        year: details.year || tmdb.year || '',
        genres: Array.isArray(details.genres) && details.genres.length ? details.genres : (tmdb.genres || []),
        tmdb: {
            id: tmdb.tmdbId,
            type: tmdb.tmdbType,
            url: tmdb.tmdbUrl,
            voteAverage: tmdb.voteAverage,
            enrichmentVersion: 2
        }
    };
}

function getLocalNetworkUrls(port) {
    const interfaces = os.networkInterfaces();
    const urls = [];

    Object.values(interfaces).flat().forEach((entry) => {
        if (!entry || entry.family !== 'IPv4' || entry.internal) return;
        urls.push(`http://${entry.address}:${port}`);
    });

    return urls;
}

function inferSearchItemType(id, title, rawType = '') {
    const parsed = parseSeasonTitle(title);
    const hay = `${id} ${rawType} ${title}`.toLowerCase();
    if (parsed.season || hay.includes('s-tv') || hay.includes('serie') || hay.includes('series')) return 'series';
    return 'movie';
}

async function scrapeCatalogPage(kind, page) {
    const isSeries = kind === 'series';
    const path = isSeries ? 's-tv' : 'films';
    const url = `${currentBaseUrl}/${path}/page/${page}/`;
    console.log(`[SCRAPING] ${isSeries ? 'Séries' : 'Films'} page ${page}: ${url}`);

    const response = await axios.get(url, axiosConfig);
    const $ = cheerio.load(response.data);
    const items = [];

    $('#dle-content > div.short, .short').each((i, el) => {
        const $el = $(el);

        const linkElem =
            $el.find('a[href*="newsid="]').first().length
                ? $el.find('a[href*="newsid="]').first()
                : $el.find('a.short-poster').first();

        const link = linkElem.attr('href') || '';
        const fullLink = toAbsoluteUrl(link);
        const newsidMatch = fullLink.match(/newsid=(\d+)/);
        const id = newsidMatch ? newsidMatch[1] : null;
        const title = $el.find('div.short-title, .short-title').text().trim();
        const poster = $el.find('img').attr('src') || $el.find('img').attr('data-src');
        const quality = $el.find('span.film-quality, .quality').text().trim();

        if (id && title) {
            items.push({
                id,
                title,
                poster: toAbsoluteUrl(poster),
                quality: quality || 'HD',
                type: isSeries ? 'series' : 'movie',
                isSeries,
                link: fullLink
            });
        }
    });

    console.log(`✅ ${items.length} ${isSeries ? 'séries' : 'films'} trouvés page ${page}`);
    return items;
}

function dedupeById(items) {
    const seen = new Set();
    return items.filter((item) => {
        const id = String(item?.id || '').trim();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function groupSeriesSeasons(items = []) {
    const grouped = new Map();

    items.forEach((item) => {
        const parsed = parseSeasonTitle(item.title || item.name || '');
        const baseTitle = item.baseTitle || parsed.baseTitle || item.title || 'Série';
        const key = normalizeTitleKey(baseTitle);
        const season = Number(item.season || parsed.season || 1);

        if (!grouped.has(key)) {
            grouped.set(key, {
                title: baseTitle,
                baseTitle,
                seasons: []
            });
        }

        const group = grouped.get(key);
        if (!group.seasons.some((entry) => String(entry.id) === String(item.id) || Number(entry.season) === season)) {
            group.seasons.push({
                season,
                id: getApiId(item.id),
                title: cleanDuplicatedTitle(item.title || `${baseTitle} - Saison ${season}`),
                poster: item.poster || '',
                quality: item.quality || 'HD',
                version: item.version || item.lang || ''
            });
        }
    });

    return Array.from(grouped.values())
        .map((group) => ({
            ...group,
            seasons: group.seasons.sort((a, b) => Number(a.season) - Number(b.season)),
            totalSeasons: group.seasons.length
        }))
        .sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

function getAllPageLimit(value, kind = 'movie') {
    const catalogKind = kind === 'series' ? 'series' : 'movie';
    const maxLimit = FULL_CATALOG_PAGE_LIMITS[catalogKind] || MAX_ALL_PAGE_LIMIT;
    if (String(value || '').toLowerCase() === 'all') return maxLimit;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return maxLimit;
    return Math.min(Math.floor(parsed), maxLimit);
}

function getBootstrapLimit(value) {
    if (String(value || '').toLowerCase() === 'all') return 4;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return 4;
    return Math.min(Math.floor(parsed), 24);
}

async function fetchAllCatalogItems(kind, limit) {
    const cacheKey = `${kind}_all_${currentBaseUrl}_${limit}`;
    const cached = getCachedFor(cacheKey, ALL_CACHE_DURATION);
    if (cached) return cached;

    const persistent = readPersistentCatalog(kind, limit);
    if (persistent) {
        setCached(cacheKey, persistent);
        updateCatalogBuildState(kind, limit, {
            state: 'ready',
            total: persistent.total || persistent.items?.length || 0,
            page: persistent.pagesScraped || 0,
            doneAt: new Date().toISOString(),
            error: null
        });
        return persistent;
    }

    if (inFlightCache.has(cacheKey)) return inFlightCache.get(cacheKey);

    const task = (async () => {
        const checkpoint = readPersistentCatalogCheckpoint(kind, limit);
        const checkpointItems = Array.isArray(checkpoint?.items) ? checkpoint.items : [];
        const allItems = [...checkpointItems];
        const seen = new Set();
        allItems.forEach((item) => {
            const id = String(item?.id || '').trim();
            if (id) seen.add(id);
        });
        const batchSize = CATALOG_BATCH_SIZE;
        let stopped = false;
        let lastPage = Number(checkpoint?.page || checkpoint?.pagesScraped || 0);
        const firstPage = Math.min(lastPage + 1, limit + 1);

        updateCatalogBuildState(kind, limit, {
            state: 'building',
            page: lastPage,
            total: allItems.length,
            startedAt: checkpoint?.startedAt || new Date().toISOString(),
            doneAt: null,
            error: null
        });

        for (let startPage = firstPage; startPage <= limit && !stopped; startPage += batchSize) {
            const endPage = Math.min(limit, startPage + batchSize - 1);
            const pageNumbers = [];
            for (let page = startPage; page <= endPage; page++) pageNumbers.push(page);

            const pages = await Promise.all(pageNumbers.map(async (page) => {
                try {
                    return { page, items: await scrapeCatalogPage(kind, page) };
                } catch (error) {
                    console.log(`⚠️ Page ${page} indisponible (${kind}) : ${error.message}`);
                    return { page, items: null, error };
                }
            }));

            pages.sort((a, b) => a.page - b.page);

            let newItemsInBatch = 0;
            for (const result of pages) {
                if (result.error) {
                    writePersistentCatalogCheckpoint(kind, limit, {
                        type: kind === 'series' ? 'series' : 'movie',
                        limit,
                        page: lastPage,
                        total: allItems.length,
                        complete: false,
                        state: 'error',
                        error: result.error.message,
                        startedAt: checkpoint?.startedAt || getCatalogBuildState(kind, limit).startedAt,
                        updatedAt: new Date().toISOString(),
                        items: dedupeById(allItems)
                    });
                    throw new Error(`Page ${result.page} indisponible: ${result.error.message}`);
                }
                lastPage = Math.max(lastPage, result.page);
                const pageItems = result.items || [];
                if (!pageItems.length) {
                    stopped = true;
                    break;
                }

                let newItemsInPage = 0;
                for (const item of pageItems) {
                    const id = String(item?.id || '').trim();
                    if (!id || seen.has(id)) continue;
                    seen.add(id);
                    allItems.push(item);
                    newItemsInPage++;
                    newItemsInBatch++;
                }

                updateCatalogBuildState(kind, limit, {
                    state: 'building',
                    page: result.page,
                    total: allItems.length
                });

                if (newItemsInPage === 0) {
                    console.log(`ℹ️ Page ${result.page} sans nouveau contenu (${kind}), poursuite jusqu'à une vraie page vide.`);
                }
            }

            writePersistentCatalogCheckpoint(kind, limit, {
                type: kind === 'series' ? 'series' : 'movie',
                limit,
                page: lastPage,
                total: allItems.length,
                complete: false,
                state: 'building',
                startedAt: checkpoint?.startedAt || getCatalogBuildState(kind, limit).startedAt,
                updatedAt: new Date().toISOString(),
                items: dedupeById(allItems)
            });
        }

        const items = dedupeById(allItems);
        const result = {
            type: kind === 'series' ? 'series' : 'movie',
            total: items.length,
            pagesScraped: lastPage,
            limit,
            generatedAt: new Date().toISOString(),
            complete: true,
            state: 'complete',
            schemaVersion: CATALOG_CACHE_SCHEMA_VERSION,
            items
        };

        setCached(cacheKey, result);
        writePersistentCatalog(kind, limit, result);
        clearPersistentCatalogCheckpoint(kind, limit);
        updateCatalogBuildState(kind, limit, {
            state: 'ready',
            page: lastPage,
            total: items.length,
            doneAt: new Date().toISOString(),
            error: null
        });
        return result;
    })().catch((error) => {
        updateCatalogBuildState(kind, limit, {
            state: 'error',
            error: error.message,
            doneAt: new Date().toISOString()
        });
        throw error;
    }).finally(() => {
        inFlightCache.delete(cacheKey);
    });

    inFlightCache.set(cacheKey, task);
    return task;
}

function listRegisteredRoutes() {
    const router = app._router;
    if (!router?.stack) return [];

    return router.stack
        .filter((layer) => layer.route)
        .flatMap((layer) => Object.keys(layer.route.methods).map((method) => (
            `${method.toUpperCase()} ${layer.route.path}`
        )));
}

function printRegisteredRoutes() {
    console.log('📌 Routes Express enregistrées:');
    listRegisteredRoutes().forEach((route) => console.log(`  ${route}`));
}

function normalizeProviderSources(players, lang) {
    if (!players || typeof players !== 'object') return [];

    return Object.entries(players)
        .filter(([, url]) => url && typeof url === 'string' && !url.includes('dood') && !url.includes('bigwar'))
        .map(([provider, url]) => ({
            name: `${provider} (${String(lang).toUpperCase()})`,
            url,
            lang,
            quality: String(lang).toUpperCase(),
            provider
        }));
}

function normalizeSeriesEpisodes(seriesData) {
    if (!seriesData || typeof seriesData !== 'object') return [];

    const episodeNumbers = new Set();
    ['vf', 'vostfr', 'vo'].forEach((lang) => {
        Object.keys(seriesData[lang] || {}).forEach((num) => episodeNumbers.add(num));
    });
    Object.keys(seriesData.info || {}).forEach((num) => episodeNumbers.add(num));

    return Array.from(episodeNumbers)
        .sort((a, b) => Number(a) - Number(b))
        .map((num) => {
            const info = seriesData.info?.[num] || {};
            const sources = ['vf', 'vostfr', 'vo'].flatMap((lang) => (
                normalizeProviderSources(seriesData[lang]?.[num], lang)
            ));

            return {
                id: num,
                number: Number(num),
                title: info.title || `Épisode ${num}`,
                description: info.synopsis || info.description || '',
                synopsis: info.synopsis || info.description || '',
                poster: info.poster || '',
                sources
            };
        })
        .filter((episode) => episode.sources.length);
}

async function fetchSeriesEpisodeData(id) {
    const cacheKey = `series_episode_data_${id}`;
    return getOrCreateCached(cacheKey, EPISODES_CACHE_DURATION, async () => {
      const paths = [
        `/ep-data.php?id=${id}&format=js`,
        `/static/series/${id}.js`,
        `/css/sr_${id}.css`,
        `/font/sr_${id}.woff2`,
        `/assets/poster_${id}.json`,
        `/data/eps_${id}.txt`
      ];

      for (const path of paths) {
        try {
            const response = await axios.get(`${currentBaseUrl}${path}`, axiosConfig);
            let data = response.data;
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            if (data && typeof data === 'object' && !data.error) {
                return data;
            }
        } catch (error) {
            console.log(`⚠️ Episodes indisponibles via ${path}: ${error.message}`);
        }
      }

      return null;
    }, { persistent: true });
}

// 📺 Episodes séries
app.get('/api/episodes/:id', async (req, res) => {
    try {
        const id = getApiId(req.params.id);
        res.json(await getSerieEpisodeData(id));
    } catch (error) {
        console.error('[ERROR EPISODES]', error.message);
        res.status(500).json({
            id: getApiId(req.params.id),
            error: error.message,
            vf: {},
            vostfr: {},
            vo: {},
            info: {}
        });
    }
});

// Récupère automatiquement les domaines sur fstream.info
async function getDomainsFromFstreamInfo() {
    try {
        console.log("🔍 Recherche du domaine actif sur fstream.info...");

        const response = await axios.get(FSTREAM_INFO, {
            headers: axiosConfig.headers,
            timeout: 10000
        });

        const html = response.data;

        const matches =
            html.match(/https?:\/\/fs\d+\.lol|fs\d+\.lol/gi) || [];

        const domains = [...new Set(
            matches
                .map(d => d.startsWith('http') ? d : `https://${d}`)
                .filter(d => /^https:\/\/fs\d+\.lol$/i.test(d))
        )];

        console.log("📡 Domaines trouvés :", domains);

        return domains;

    } catch (err) {
        console.log("❌ Impossible de lire fstream.info :", err.message);
        return [];
    }
}

// Recherche automatique du domaine actif
async function findWorkingUrl() {

    const dynamicDomains = await getDomainsFromFstreamInfo();

    const domains = [
        ...dynamicDomains,
        ...BASE_URLS
    ];

    for (const url of [...new Set(domains)]) {

        try {

            console.log(`🔍 Test : ${url}`);

            const response = await axios.get(`${url}/films/page/1/`, {
                ...axiosConfig,
                timeout: 5000
            });

            if (response.status === 200 && response.data.includes("short")) {

                console.log(`✅ Domaine actif : ${url}`);

                currentBaseUrl = url;

                return url;
            }

        } catch {

            console.log(`❌ ${url} ne répond pas`);

        }
    }

    console.log(`⚠️ Fallback : ${currentBaseUrl}`);

    return currentBaseUrl;
}

// =====================================================
// API interne séparée : Films
// =====================================================
async function getFilmPage(page = 1) {
    const pageNumber = Math.max(1, Number(page) || 1);
    const cacheKey = `film_page_${currentBaseUrl}_${pageNumber}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const items = await scrapeCatalogPage('movie', pageNumber);
    const result = {
        type: 'movie',
        page: pageNumber,
        total: items.length,
        source: currentBaseUrl,
        items: items.map((item) => ({
            ...item,
            type: 'movie',
            isSeries: false
        }))
    };

    setCached(cacheKey, result);
    return result;
}

async function getAllFilms(limit = 50) {
    const safeLimit = getAllPageLimit(limit, 'movie');
    const cacheKey = `film_all_${currentBaseUrl}_${safeLimit}`;
    const cached = getCachedFor(cacheKey, ALL_CACHE_DURATION);
    if (cached) return cached;

    const result = await fetchAllCatalogItems('movie', safeLimit);
    const cleanResult = {
        ...result,
        type: 'movie',
        items: (result.items || []).map((item) => ({
            ...item,
            type: 'movie',
            isSeries: false
        })),
        total: (result.items || []).length
    };

    setCachedFor(cacheKey, cleanResult);
    return cleanResult;
}

async function getFilmDetails(id, includeSources = false) {
    const apiId = getApiId(id);
    const cacheKey = `film_details_${apiId}`;
    const film = await getOrCreateCached(cacheKey, DETAILS_CACHE_DURATION, async () => {
        const details = await scrapeDetails(apiId);
        return {
            ...details,
            id: apiId,
            type: 'movie',
            isSeries: false,
            sources: details.sources || []
        };
    }, { persistent: true });

    scheduleTmdbEnrichment(cacheKey, film, 'movie');
    if (!includeSources) return film;
    const sourceResult = await getFilmSources(apiId);
    return { ...film, sources: sourceResult.sources || [] };
}

async function getFilmSources(id) {
    const apiId = getApiId(id);
    const cacheKey = `sources_${apiId}`;
    return getOrCreateCached(cacheKey, SOURCES_CACHE_DURATION, () => scrapeFilmSources(apiId, false), { persistent: true });
}

// =====================================================
// API interne séparée : Séries
// =====================================================
async function getSeriePage(page = 1) {
    const pageNumber = Math.max(1, Number(page) || 1);
    const cacheKey = `serie_page_${currentBaseUrl}_${pageNumber}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const items = await scrapeCatalogPage('series', pageNumber);
    const result = {
        type: 'series',
        page: pageNumber,
        total: items.length,
        source: currentBaseUrl,
        items: items.map((item) => {
            const parsed = parseSeasonTitle(item.title);
            return {
                ...item,
                type: 'series',
                isSeries: true,
                baseTitle: parsed.baseTitle,
                season: parsed.season
            };
        })
    };

    setCached(cacheKey, result);
    return result;
}

async function getAllSeries(limit = 50) {
    const safeLimit = getAllPageLimit(limit, 'series');
    const cacheKey = `serie_all_${currentBaseUrl}_${safeLimit}`;
    const cached = getCachedFor(cacheKey, ALL_CACHE_DURATION);
    if (cached) return cached;

    const result = await fetchAllCatalogItems('series', safeLimit);
    const items = (result.items || []).map((item) => {
        const parsed = parseSeasonTitle(item.title);
        return {
            ...item,
            type: 'series',
            isSeries: true,
            baseTitle: parsed.baseTitle,
            season: parsed.season
        };
    });
    const groups = groupSeriesSeasons(items);
    const cleanResult = {
        ...result,
        type: 'series',
        items,
        groups,
        total: items.length,
        totalSeries: groups.length,
        totalSeasons: items.length
    };

    setCachedFor(cacheKey, cleanResult);
    return cleanResult;
}

async function buildFullCatalogCacheSequential(filmLimit, serieLimit) {
    if (fullCatalogBuildRunning) return;
    fullCatalogBuildRunning = true;

    try {
        const filmState = getCatalogBuildState('movie', filmLimit);
        if (filmState.state === 'building') {
            const serieState = getCatalogBuildState('series', serieLimit);
            if (serieState.state !== 'ready') {
                updateCatalogBuildState('series', serieLimit, {
                    state: 'queued',
                    startedAt: serieState.startedAt || new Date().toISOString(),
                    error: null
                });
            }
            return;
        }

        if (filmState.state !== 'ready' && filmState.state !== 'building') {
            await getAllFilms(filmLimit);
        }

        const serieState = getCatalogBuildState('series', serieLimit);
        if (serieState.state !== 'ready' && serieState.state !== 'building') {
            await getAllSeries(serieLimit);
        }
    } catch (error) {
        console.error('[CACHE BUILD FULL]', error.message);
    } finally {
        fullCatalogBuildRunning = false;
    }
}

function startCatalogCacheBuild({ filmLimit, serieLimit, target = 'all' }) {
    const normalizedTarget = String(target || 'all').toLowerCase();
    const tasks = [];

    if (normalizedTarget === 'all') {
        const filmState = getCatalogBuildState('movie', filmLimit);
        const serieState = getCatalogBuildState('series', serieLimit);

        if (!fullCatalogBuildRunning && (filmState.state !== 'ready' || serieState.state !== 'ready')) {
            tasks.push('movie', 'series');
            if (filmState.state !== 'building') {
                updateCatalogBuildState('movie', filmLimit, {
                    state: 'queued',
                    startedAt: filmState.startedAt || new Date().toISOString(),
                    error: null
                });
            }
            if (serieState.state !== 'building') {
                updateCatalogBuildState('series', serieLimit, {
                    state: 'queued',
                    startedAt: serieState.startedAt || new Date().toISOString(),
                    error: null
                });
            }
            buildFullCatalogCacheSequential(filmLimit, serieLimit);
        }

        return {
            mode: 'sequential',
            tasks,
            message: tasks.length ? 'Construction progressive du cache lancee.' : 'Cache deja pret ou en cours de construction.'
        };
    }

    if (normalizedTarget === 'film' || normalizedTarget === 'movie' || normalizedTarget === 'movies') {
        const state = getCatalogBuildState('movie', filmLimit);
        if (state.state !== 'building') {
            tasks.push('movie');
            getAllFilms(filmLimit).catch((error) => console.error('[CACHE BUILD MOVIE]', error.message));
        }
    }

    if (normalizedTarget === 'serie' || normalizedTarget === 'series') {
        const state = getCatalogBuildState('series', serieLimit);
        if (state.state !== 'building') {
            tasks.push('series');
            getAllSeries(serieLimit).catch((error) => console.error('[CACHE BUILD SERIES]', error.message));
        }
    }

    return {
        mode: 'parallel-target',
        tasks,
        message: tasks.length ? 'Construction du cache lancee.' : 'Cache deja en cours de construction.'
    };
}

async function getSerieDetails(id, includeEpisodes = false) {
    const apiId = getApiId(id);
    const cacheKey = `serie_details_${apiId}`;
    const serie = await getOrCreateCached(cacheKey, DETAILS_CACHE_DURATION, async () => {
        const details = await scrapeDetails(apiId);
        const parsed = parseSeasonTitle(details.title);
        return {
            ...details,
            id: apiId,
            type: 'series',
            isSeries: true,
            baseTitle: parsed.baseTitle || details.title,
            season: parsed.season,
            episodes: details.episodes || []
        };
    }, { persistent: true });

    scheduleTmdbEnrichment(cacheKey, serie, 'series');
    if (!includeEpisodes) return serie;
    const episodeData = await getSerieEpisodeData(apiId);
    return { ...serie, episodes: normalizeSeriesEpisodes(episodeData) };
}

async function getSerieEpisodeData(id) {
    const apiId = getApiId(id);
    const cacheKey = `serie_episodes_${apiId}`;
    return getOrCreateCached(cacheKey, EPISODES_CACHE_DURATION, async () => {
        const data = await fetchSeriesEpisodeData(apiId);
        return {
            id: apiId,
            vf: data?.vf || {},
            vostfr: data?.vostfr || {},
            vo: data?.vo || {},
            info: data?.info || {}
        };
    }, { persistent: true });
}

async function getSerieEpisodes(id) {
    const apiId = getApiId(id);
    const data = await getSerieEpisodeData(apiId);
    return {
        ...data,
        episodes: normalizeSeriesEpisodes(data).map((episode) => ({
            id: `${apiId}-${episode.number}`,
            seriesId: apiId,
            episode: episode.number,
            number: episode.number,
            title: episode.title,
            description: episode.description,
            synopsis: episode.synopsis,
            poster: episode.poster,
            sources: episode.sources
        }))
    };
}

async function getSerieEpisode(id, episodeNumber) {
    const apiId = getApiId(id);
    const number = Number(episodeNumber || 1);
    const episodeData = await getSerieEpisodes(apiId);
    const episode = episodeData.episodes.find((item) => Number(item.episode) === number);

    if (episode) return episode;

    return {
        id: `${apiId}-${number}`,
        seriesId: apiId,
        episode: number,
        title: `Épisode ${number}`,
        description: '',
        poster: '',
        sources: []
    };
}

async function getSerieSources(id, episodeNumber = 1) {
    const episode = await getSerieEpisode(id, episodeNumber);
    return {
        id: getApiId(id),
        episode: episode.episode,
        sources: episode.sources || [],
        links: episode.sources || []
    };
}

async function getSerieSeasons(id) {
    const details = await getSerieDetails(id);
    return getSeasonsByQuery(details.baseTitle || parseSeasonTitle(details.title).baseTitle || details.title);
}

async function getSeasonsByQuery(query) {
    const cleanQuery = decodeURIComponent(String(query || '')).trim();
    if (!cleanQuery) return { query: '', seasons: [] };

    const items = await scrapeSearchItems(cleanQuery);
    const queryKey = normalizeTitleKey(cleanQuery);
    const seasonsByNumber = new Map();

    items.forEach((item) => {
        const parsed = parseSeasonTitle(item.title);
        if (!parsed.season) return;
        if (normalizeTitleKey(parsed.baseTitle) !== queryKey) return;

            seasonsByNumber.set(String(parsed.season), {
                season: parsed.season,
                id: getApiId(item.id),
                title: cleanDuplicatedTitle(item.title)
            });
    });

    const seasons = Array.from(seasonsByNumber.values())
        .sort((a, b) => Number(a.season) - Number(b.season));

    return { query: cleanQuery, seasons };
}

async function scrapeDetails(id) {
    const apiId = getApiId(id);
    const cacheKey = `details_raw_${apiId}`;
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached) return cached;

    const url = `${currentBaseUrl}/index.php?newsid=${apiId}`;
    console.log(`[SCRAPING] Détails: ${url}`);

    const [response, apiData] = await Promise.all([
        axios.get(url, axiosConfig),
        getFilmApiData(apiId)
    ]);
    const $ = cheerio.load(response.data);

    const cleanTitle =
        $('#film-data').attr('data-title') ||
        $('#s-title').clone().children().remove().end().text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        $('title').text().trim() ||
        'Sans titre';

    const isSeries = /saison\s*\d+|season\s*\d+/i.test(cleanTitle);
    const cleanDescription = $('#s-desc')
        .clone()
        .find('p')
        .remove()
        .end()
        .text()
        .replace(/\s+/g, ' ')
        .trim();

    const details = {
        id: apiId,
        title: cleanTitle,
        description: cleanDescription,
        synopsis: cleanDescription,
        poster: toAbsoluteUrl(
            $('#film-data').attr('data-affiche') ||
            apiData?.meta?.affiche ||
            apiData?.meta?.affiche2 ||
            $('meta[property="og:image"]').attr('content') ||
            ''
        ),
        backdrop: toAbsoluteUrl(
            $('#film-data').attr('data-affiche2') ||
            apiData?.meta?.affiche2 ||
            ''
        ),
        trailer: $('#film-data').attr('data-trailer') || apiData?.meta?.trailer || '',
        year: $('.release_date a').first().text().trim() || '',
        quality: $('#film_quality').text().trim() || 'HD',
        version: $('#film_lang').text().trim() || 'VF',
        genres: $('.genres a').map((i, el) => $(el).text().trim()).get(),
        isSeries
    };

    setCachedFor(cacheKey, details);
    return details;
}

async function getFilmApiData(id) {
    const apiId = getApiId(id);
    return getOrCreateCached(`film_api_raw_${apiId}`, SOURCES_CACHE_DURATION, async () => {
        const url = `${currentBaseUrl}/engine/ajax/film_api.php?id=${apiId}`;
        const response = await axios.get(url, axiosConfig);
        return typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
    }, { persistent: true });
}

function scheduleTmdbEnrichment(cacheKey, item, type) {
    if (!isTmdbConfigured() || !item || item.tmdb?.enrichmentVersion === 2 || inFlightCache.has(`${cacheKey}_tmdb`)) return;
    const taskKey = `${cacheKey}_tmdb`;
    const task = enrichDetailsWithTmdb(item, type)
        .then((enriched) => {
            setCachedFor(cacheKey, enriched);
            writePersistentData(cacheKey, enriched);
        })
        .catch((error) => console.log(`[TMDB] Enrichissement différé impossible: ${error.message}`))
        .finally(() => inFlightCache.delete(taskKey));
    inFlightCache.set(taskKey, task);
}

async function scrapeFilmSources(id, allowSeriesFallback = true) {
    const apiId = getApiId(id);
    console.log(`[SCRAPING] Stream: ${apiId}`);
    const data = await getFilmApiData(apiId);

    const sources = [];
    let episodes = [];

    if (data.players) {
        Object.entries(data.players).forEach(([provider, langs]) => {
            Object.entries(langs).forEach(([lang, playerUrl]) => {
                if (playerUrl && !playerUrl.includes('dood') && !playerUrl.includes('bigwar')) {
                    sources.push({
                        name: `${provider} (${lang})`,
                        url: playerUrl,
                        lang,
                        quality: String(lang).toUpperCase(),
                        provider
                    });
                }
            });
        });
    }

    if (allowSeriesFallback) {
        const seriesData = await fetchSeriesEpisodeData(apiId);
        episodes = normalizeSeriesEpisodes(seriesData);
        if (sources.length === 0 && episodes.length) {
            sources.push(...episodes[0].sources);
        }
    }

    if (sources.length === 0) {
        const pageUrl = `${currentBaseUrl}/${apiId}/`;
        const pageResponse = await axios.get(pageUrl, axiosConfig);
        const $ = cheerio.load(pageResponse.data);

        $('iframe').each((i, el) => {
            const src = $(el).attr('src');
            if (src) {
                sources.push({
                    name: `Lecteur ${i + 1}`,
                    url: src.startsWith('http') ? src : `https:${src}`,
                    provider: `lecteur-${i + 1}`
                });
            }
        });
    }

    return {
        id: apiId,
        sources,
        links: sources,
        episodes
    };
}

// =====================================================
// Nouvelles routes API Film
// =====================================================
app.get('/api/film', async (req, res) => {
    try {
        res.json(await getAllFilms(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR API FILM]', error.message);
        res.status(500).json({ type: 'movie', total: 0, error: error.message, items: [] });
    }
});

app.get('/api/film/all', async (req, res) => {
    try {
        res.json(await getAllFilms(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR API FILM ALL]', error.message);
        res.status(500).json({ type: 'movie', total: 0, error: error.message, items: [] });
    }
});

app.get('/api/film/all/progress', async (req, res) => {
    try {
        const limit = getAllPageLimit(req.query.limit || 'all', 'movie');
        const state = getCatalogBuildState('movie', limit);
        if (state.state === 'idle' || state.state === 'error') {
            getAllFilms(limit).catch((error) => console.error('[BUILD FILM]', error.message));
        }
        res.json({
            ok: true,
            kind: 'movie',
            status: getCatalogBuildState('movie', limit)
        });
    } catch (error) {
        res.status(500).json({ ok: false, kind: 'movie', error: error.message });
    }
});

app.get('/api/film/page/:page', async (req, res) => {
    try {
        res.json(await getFilmPage(req.params.page));
    } catch (error) {
        console.error('[ERROR API FILM PAGE]', error.message);
        res.status(500).json({ type: 'movie', page: Number(req.params.page) || 1, error: error.message, items: [] });
    }
});

app.get('/api/film/:id/sources', async (req, res) => {
    try {
        res.json(await getFilmSources(req.params.id));
    } catch (error) {
        console.error('[ERROR API FILM SOURCES]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), error: error.message, sources: [] });
    }
});

app.get('/api/film/:id', async (req, res) => {
    try {
        res.json(await getFilmDetails(req.params.id, req.query.sources === '1'));
    } catch (error) {
        console.error('[ERROR API FILM DETAILS]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), type: 'movie', error: error.message });
    }
});

// =====================================================
// Nouvelles routes API Série
// =====================================================
app.get('/api/serie', async (req, res) => {
    try {
        res.json(await getAllSeries(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR API SERIE]', error.message);
        res.status(500).json({ type: 'series', total: 0, error: error.message, items: [] });
    }
});

app.get('/api/serie/all', async (req, res) => {
    try {
        res.json(await getAllSeries(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR API SERIE ALL]', error.message);
        res.status(500).json({ type: 'series', total: 0, error: error.message, items: [] });
    }
});

app.get('/api/serie/all/progress', async (req, res) => {
    try {
        const limit = getAllPageLimit(req.query.limit || 'all', 'series');
        const state = getCatalogBuildState('series', limit);
        if (state.state === 'idle' || state.state === 'error') {
            getAllSeries(limit).catch((error) => console.error('[BUILD SERIE]', error.message));
        }
        res.json({
            ok: true,
            kind: 'series',
            status: getCatalogBuildState('series', limit)
        });
    } catch (error) {
        res.status(500).json({ ok: false, kind: 'series', error: error.message });
    }
});

app.get('/api/serie/page/:page', async (req, res) => {
    try {
        res.json(await getSeriePage(req.params.page));
    } catch (error) {
        console.error('[ERROR API SERIE PAGE]', error.message);
        res.status(500).json({ type: 'series', page: Number(req.params.page) || 1, error: error.message, items: [] });
    }
});

app.get('/api/serie/:id/episodes', async (req, res) => {
    try {
        res.json(await getSerieEpisodes(req.params.id));
    } catch (error) {
        console.error('[ERROR API SERIE EPISODES]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), error: error.message, vf: {}, vostfr: {}, vo: {}, info: {}, episodes: [] });
    }
});

app.get('/api/serie/:id/sources', async (req, res) => {
    try {
        res.json(await getSerieSources(req.params.id, req.query.episode || 1));
    } catch (error) {
        console.error('[ERROR API SERIE SOURCES]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), error: error.message, sources: [] });
    }
});

app.get('/api/serie/:id/episode/:episodeNumber', async (req, res) => {
    try {
        res.json(await getSerieEpisode(req.params.id, req.params.episodeNumber));
    } catch (error) {
        console.error('[ERROR API SERIE EPISODE]', error.message);
        res.status(500).json({
            id: `${getApiId(req.params.id)}-${req.params.episodeNumber}`,
            seriesId: getApiId(req.params.id),
            episode: Number(req.params.episodeNumber) || 1,
            error: error.message,
            sources: []
        });
    }
});

app.get('/api/serie/:id/seasons', async (req, res) => {
    try {
        res.json(await getSerieSeasons(req.params.id));
    } catch (error) {
        console.error('[ERROR API SERIE SEASONS]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), error: error.message, seasons: [] });
    }
});

app.get('/api/serie/:id', async (req, res) => {
    try {
        res.json(await getSerieDetails(req.params.id, req.query.episodes === '1'));
    } catch (error) {
        console.error('[ERROR API SERIE DETAILS]', error.message);
        res.status(500).json({ id: getApiId(req.params.id), type: 'series', error: error.message });
    }
});
// 🎬 Films
app.get('/api/movies', async (req, res) => {
    try {
        res.json(await getFilmPage(req.query.page || 1));
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({ 
            error: 'Erreur scraping',
            message: error.message,
            items: []
        });
    }
});

console.log("REGISTER /api/movies/all");
app.get('/api/movies/all', async (req, res) => {
    try {
        res.json(await getAllFilms(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR MOVIES ALL]', error.message);
        res.status(500).json({
            type: 'movie',
            total: 0,
            error: error.message,
            items: []
        });
    }
});

console.log("REGISTER /api/catalog/bootstrap");
app.get('/api/catalog/bootstrap', async (req, res) => {
    try {
        const limit = getBootstrapLimit(req.query.limit);
        const [movies, series] = await Promise.all([
            getAllFilms(limit),
            getAllSeries(limit)
        ]);

        const items = [
            ...(movies.items || []),
            ...(series.items || [])
        ];

        res.json({
            ok: true,
            source: currentBaseUrl,
            limit,
            scope: 'temporary',
            complete: false,
            temporary: true,
            totals: {
                movies: movies.total || 0,
                series: series.total || 0,
                all: items.length
            },
            movies,
            series,
            total: items.length,
            items
        });
    } catch (error) {
        console.error('[ERROR CATALOG BOOTSTRAP]', error.message);
        res.status(500).json({
            ok: false,
            error: error.message,
            movies: { type: 'movie', total: 0, items: [] },
            series: { type: 'series', total: 0, items: [] },
            items: []
        });
    }
});

app.get('/api/keepalive', (req, res) => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
        ok: true,
        service: 'madrador-tv',
        message: 'awake',
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString()
    });
});

// 📺 Séries
app.get('/api/series', async (req, res) => {
    try {
        res.json(await getSeriePage(req.query.page || 1));
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({ 
            error: 'Erreur scraping',
            message: error.message,
            items: []
        });
    }
});

console.log("REGISTER /api/series/all");
app.get('/api/series/all', async (req, res) => {
    try {
        res.json(await getAllSeries(req.query.limit || 'all'));
    } catch (error) {
        console.error('[ERROR SERIES ALL]', error.message);
        res.status(500).json({
            type: 'series',
            total: 0,
            error: error.message,
            items: []
        });
    }
});

// 🔍 Recherche
async function scrapeSearchItems(query) {
    const cacheKey = `search_${normalizeTitleKey(query)}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const url = `${currentBaseUrl}/engine/ajax/search.php`;
    console.log(`[SCRAPING] Recherche: "${query}"`);

    const response = await axios.post(url, `query=${encodeURIComponent(query)}`, {
        ...axiosConfig,
        headers: {
            ...axiosConfig.headers,
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
        }
    });

    const $ = cheerio.load(response.data);
    const items = [];
    const seen = new Set();

    $('.search-item, div').each((i, el) => {
        const $el = $(el);
        const onclick = $el.attr('onclick') || '';
        const match = onclick.match(/'\/([^']+)'/);
        const rawId = match ? match[1] : null;
        const id = getApiId(rawId);

        const title = $el.find('.search-title, div').text().trim();
        const poster = $el.find('img').attr('src');
        const type = inferSearchItemType(rawId || id, title);

        if (id && title && !seen.has(`${id}:${title}`)) {
            seen.add(`${id}:${title}`);
            items.push({
                id,
                title,
                poster: toAbsoluteUrl(poster),
                type,
                isSeries: type === 'series'
            });
        }
    });

    setCached(cacheKey, items);
    return items;
}

app.get('/api/search', async (req, res) => {
    try {
        const query = String(req.query.q || '').trim();
        if (!query) return res.json({ query: '', items: [] });

        const items = await scrapeSearchItems(query);
        console.log(`✅ ${items.length} résultats trouvés`);
        res.json({ query, items });

    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({ error: error.message, items: [] });
    }
});

// 📚 Saisons d'une série
app.get('/api/seasons/:query', async (req, res) => {
    try {
        const query = decodeURIComponent(String(req.params.query || '')).trim();
        res.json(await getSeasonsByQuery(query));
    } catch (error) {
        console.error('[ERROR SEASONS]', error.message);
        res.status(500).json({ query: req.params.query, error: error.message, seasons: [] });
    }
});

// 📄 Détails
app.get('/api/tmdb/enrich', async (req, res) => {
    const title = String(req.query.title || '').trim();
    const type = req.query.type === 'series' || req.query.type === 'tv' ? 'series' : 'movie';
    const year = String(req.query.year || '').match(/\d{4}/)?.[0] || '';

    if (!title) {
        return res.status(400).json({ ok: false, error: 'Le titre est requis.', item: null });
    }

    const item = await fetchTmdbDetails({ title, type, year });
    return res.json({ ok: true, type, item: item || null });
});

app.get('/api/tmdb/recommendations/:type/:id', async (req, res) => {
    const type = req.params.type === 'series' || req.params.type === 'tv' ? 'series' : 'movie';
    const items = await fetchTmdbRecommendations(type, req.params.id);
    res.json({ ok: true, type, total: items.length, items });
});

app.get('/api/details/:id', async (req, res) => {
    try {
        const id = getApiId(req.params.id);
        const details = await scrapeDetails(id);
        res.json(details.isSeries ? await getSerieDetails(id, true) : await getFilmDetails(id, false));
    } catch (error) {
        console.error('[ERROR DETAILS]', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ▶️ Liens de streaming
app.get('/api/stream/:id', async (req, res) => {
    try {
        const id = getApiId(req.params.id);
        res.json(await scrapeFilmSources(id, true));
        
    } catch (error) {
        console.error('[ERROR]', error.message);
        res.status(500).json({ error: error.message, sources: [] });
    }
});

app.get('/api/catalog/status', (req, res) => {
    const filmLimit = getAllPageLimit(req.query.filmLimit || req.query.limit || 'all', 'movie');
    const serieLimit = getAllPageLimit(req.query.serieLimit || req.query.seriesLimit || req.query.limit || 'all', 'series');
    const filmState = getCatalogBuildState('movie', filmLimit);
    const serieState = getCatalogBuildState('series', serieLimit);

    res.json({
        ok: true,
        source: currentBaseUrl,
        cacheItems: cache.size,
        inFlight: Array.from(inFlightCache.keys()),
        persistentCacheDir: IS_PRODUCTION ? undefined : PERSISTENT_CACHE_DIR,
        film: filmState,
        series: serieState,
        ready: filmState.state === 'ready' && serieState.state === 'ready',
        updatedAt: new Date().toISOString()
    });
});

app.get('/api/catalog/snapshot', (req, res) => {
    const kind = String(req.query.type || req.query.kind || '').toLowerCase().startsWith('serie') ? 'series' : 'movie';
    const limit = getAllPageLimit(req.query.limit || 'all', kind);
    const complete = readPersistentCatalog(kind, limit, { allowStale: true });
    const checkpoint = complete || readPersistentCatalogCheckpoint(kind, limit);
    const allItems = Array.isArray(checkpoint?.items) ? checkpoint.items : [];
    const maxItems = Math.max(0, Math.min(Number(req.query.maxItems) || allItems.length, 50000));
    const items = allItems.slice(0, maxItems);
    const state = getCatalogBuildState(kind, limit);
    const completeSnapshot = Boolean(complete);
    const refreshNeeded = Boolean(complete?.stale);
    const snapshotState = completeSnapshot
        ? 'complete'
        : allItems.length
            ? (state.state === 'error' ? 'error' : 'partial')
            : (state.state === 'building' ? 'loading' : state.state === 'error' ? 'error' : 'empty');

    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
        ok: true,
        type: kind === 'series' ? 'series' : 'movie',
        complete: completeSnapshot,
        partial: !completeSnapshot && allItems.length > 0,
        temporary: !completeSnapshot,
        state: snapshotState,
        source: completeSnapshot ? (refreshNeeded ? 'persistent-complete-stale' : 'persistent-complete') : allItems.length ? 'persistent-checkpoint' : 'none',
        refreshNeeded,
        fresh: completeSnapshot && !refreshNeeded,
        total: allItems.length,
        returned: items.length,
        page: checkpoint?.page || checkpoint?.pagesScraped || state.page || 0,
        items,
        status: state
    });
});

app.post('/api/catalog/ensure', (req, res) => {
    const now = Date.now();
    const target = ['movie', 'movies', 'film', 'series', 'serie'].includes(String(req.query.target || '').toLowerCase())
        ? String(req.query.target).toLowerCase()
        : 'all';
    const coolingDown = now - lastPublicCatalogEnsureAt < 10 * 60 * 1000;
    const filmLimit = FULL_CATALOG_PAGE_LIMITS.movie;
    const serieLimit = FULL_CATALOG_PAGE_LIMITS.series;
    const build = coolingDown
        ? { mode: 'rate-limited', tasks: [], message: 'Une préparation récente est déjà enregistrée.' }
        : startCatalogCacheBuild({ filmLimit, serieLimit, target });
    if (!coolingDown) lastPublicCatalogEnsureAt = now;
    res.json({
        ok: true,
        ...build,
        coolingDown,
        status: {
            film: getCatalogBuildState('movie', filmLimit),
            series: getCatalogBuildState('series', serieLimit)
        }
    });
});

app.post('/api/cache/build', requireAdminAction, async (req, res) => {
    const filmLimit = getAllPageLimit(req.query.filmLimit || req.query.limit || 'all', 'movie');
    const serieLimit = getAllPageLimit(req.query.serieLimit || req.query.seriesLimit || req.query.limit || 'all', 'series');
    const target = String(req.query.target || 'all').toLowerCase();
    const build = startCatalogCacheBuild({ filmLimit, serieLimit, target });

    res.json({
        ok: true,
        message: build.message,
        mode: build.mode,
        batchSize: CATALOG_BATCH_SIZE,
        tasks: build.tasks,
        limits: {
            film: filmLimit,
            series: serieLimit
        },
        status: {
            film: getCatalogBuildState('movie', filmLimit),
            series: getCatalogBuildState('series', serieLimit)
        }
    });
});

app.get('/api/cache/warm', requireAdminAction, (req, res) => {
    const filmLimit = getAllPageLimit(req.query.filmLimit || req.query.limit || 'all', 'movie');
    const serieLimit = getAllPageLimit(req.query.serieLimit || req.query.seriesLimit || req.query.limit || 'all', 'series');
    const target = String(req.query.target || 'all').toLowerCase();
    const build = startCatalogCacheBuild({ filmLimit, serieLimit, target });
    const film = getCatalogBuildState('movie', filmLimit);
    const series = getCatalogBuildState('series', serieLimit);

    res.set('Cache-Control', 'no-store, max-age=0');
    res.json({
        ok: true,
        service: 'madrador-tv',
        message: build.message,
        mode: build.mode,
        batchSize: CATALOG_BATCH_SIZE,
        tasks: build.tasks,
        limits: {
            film: filmLimit,
            series: serieLimit
        },
        ready: film.state === 'ready' && series.state === 'ready',
        status: {
            film,
            series
        },
        timestamp: new Date().toISOString()
    });
});

// 📡 Direct : normalise une URL ou extrait l'URL d'un fichier .url/.txt/.m3u
app.get('/api/direct/resolve', (req, res) => {
    const result = buildDirectResponse({
        url: req.query.url,
        content: req.query.content,
        filename: req.query.filename
    });
    res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/direct/resolve', (req, res) => {
    const result = buildDirectResponse({
        url: req.body?.url,
        content: req.body?.content,
        filename: req.body?.filename
    });
    res.status(result.ok ? 200 : 400).json(result);
});

app.get('/api/direct/playlist', async (req, res) => {
    try {
        const result = await loadDirectPlaylist(req.query.url);
        res.json(result);
    } catch (error) {
        res.status(400).json({ ok: false, type: 'playlist', total: 0, items: [], error: error.message });
    }
});

app.post('/api/direct/playlist', async (req, res) => {
    try {
        const content = String(req.body?.content || '');
        const result = content
            ? parseDirectPlaylist(content, { filename: req.body?.filename })
            : await loadDirectPlaylist(req.body?.url);
        res.status(result.ok ? 200 : 400).json(result);
    } catch (error) {
        res.status(400).json({ ok: false, type: 'playlist', total: 0, items: [], error: error.message });
    }
});

app.get('/api/direct/iptv-org/status', async (_req, res) => {
    try {
        await iptvOrgService.getSnapshot();
        res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(iptvOrgService.status());
    } catch (error) {
        res.status(503).json({ ...iptvOrgService.status(), ok: false, error: error.message });
    }
});

app.get('/api/direct/iptv-org/channels', async (req, res) => {
    try {
        const snapshot = await iptvOrgService.getSnapshot();
        const query = String(req.query.q || '').trim().toLocaleLowerCase('fr');
        const category = String(req.query.category || '').trim().toLocaleLowerCase('fr');
        const country = String(req.query.country || '').trim().toLowerCase();
        const scope = String(req.query.scope || 'all').trim().toLowerCase();
        const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
        const limit = Math.max(1, Math.min(Number.parseInt(req.query.limit, 10) || 250, 500));
        let channels = snapshot.channels || [];

        if (query) {
            channels = channels.filter((channel) => (
                `${channel.name} ${channel.channelId} ${(channel.altNames || []).join(' ')} ${channel.country} ${channel.category}`.toLocaleLowerCase('fr').includes(query)
            ));
        }
        if (category) channels = channels.filter((channel) => channel.category.toLocaleLowerCase('fr') === category);
        if (country) channels = channels.filter((channel) => String(channel.country || '').toLowerCase() === country);
        if (scope !== 'all') channels = channels.filter((channel) => (channel.scopes || []).includes(scope));

        const total = channels.length;
        const page = channels.slice(offset, offset + limit);
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.json({
            ok: true,
            source: 'iptv-org',
            name: snapshot.name,
            updatedAt: snapshot.updatedAt,
            stale: Boolean(snapshot.stale),
            total,
            count: page.length,
            offset,
            limit,
            hasMore: offset + page.length < total,
            channels: page
        });
    } catch (error) {
        res.status(503).json({ ok: false, source: 'iptv-org', total: 0, count: 0, channels: [], error: error.message });
    }
});

app.get('/api/direct/iptv-org/channel/:id', async (req, res) => {
    try {
        await iptvOrgService.getSnapshot();
        const channel = iptvOrgService.findChannel(req.params.id);
        if (!channel) return res.status(404).json({ ok: false, error: 'Chaîne IPTV-org introuvable.' });
        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600');
        res.json({ ok: true, source: 'iptv-org', channel });
    } catch (error) {
        res.status(503).json({ ok: false, error: error.message });
    }
});

app.post('/api/direct/iptv-org/refresh', requireAdminAction, async (_req, res) => {
    try {
        const snapshot = await iptvOrgService.refresh(true);
        res.json({ ...iptvOrgService.status(), ok: true, total: snapshot.total });
    } catch (error) {
        res.status(503).json({ ...iptvOrgService.status(), ok: false, error: error.message });
    }
});

app.get('/api/direct/status', (req, res) => {
    res.json({
        ok: true,
        service: 'direct',
        accepted: ['url', 'txt', 'm3u', 'm3u8', 'cdnlivetv', 'iptv-org'],
        endpoints: [
            'GET /api/direct/resolve?url=https://...',
            'POST /api/direct/resolve { url }',
            'POST /api/direct/resolve { filename, content }',
            'GET /api/direct/playlist?url=https://.../playlist.m3u',
            'POST /api/direct/playlist { filename, content }',
            'GET /api/direct/channel-stream?url=https://...',
            'GET /api/direct/health?url=https://...',
            'GET /api/direct/channels',
            'GET /api/direct/iptv-org/status',
            'GET /api/direct/iptv-org/channels?scope=france&offset=0&limit=250',
            'GET /api/direct/iptv-org/channel/:id',
            'POST /api/direct/iptv-org/refresh',
            'GET /api/direct/epg?channel=TF1'
        ]
    });
});

app.get('/api/direct/health', async (req, res) => {
    try {
        res.set('Cache-Control', 'private, max-age=60');
        res.json(await checkDirectHealth(req.query.url));
    } catch (error) {
        res.status(400).json({ ok: false, state: 'unavailable', error: error.message, checkedAt: new Date().toISOString() });
    }
});

app.get('/api/direct/channels', async (req, res) => {
    try {
        const query = String(req.query.q || '').trim().toLowerCase();
        const country = String(req.query.country || '').trim().toLowerCase();
        const data = await getDirectChannels();
        let channels = data.channels || [];

        if (query) {
            channels = channels.filter((channel) => (
                channel.name.toLowerCase().includes(query) ||
                channel.code.toLowerCase().includes(query) ||
                channel.country.toLowerCase().includes(query)
            ));
        }

        if (country) {
            channels = channels.filter((channel) => channel.code === country);
        }

        res.json({
            ...data,
            count: channels.length,
            channels
        });
    } catch (error) {
        console.error('[ERROR DIRECT CHANNELS]', error.message);
        res.status(500).json({
            ok: false,
            source: 'cdnlivetv',
            error: error.message,
            total: 0,
            count: 0,
            channels: []
        });
    }
});

app.get('/api/direct/epg', async (req, res) => {
    const channelName = String(req.query.channel || req.query.name || '').trim();
    if (!channelName) {
        return res.status(400).json({ ok: false, error: 'Le nom de la chaîne est requis.', items: [] });
    }

    try {
        const epg = await loadFranceEpg(req.query.refresh === '1');
        const match = findEpgChannelMatch({
            channel: channelName,
            channelId: req.query.channelId,
            tvgId: req.query.tvgId,
            aliases: String(req.query.aliases || '').split('|').slice(0, 8)
        }, epg.channels);
        const channel = match?.channel || null;
        const schedule = match?.id
            ? await loadChannelEpgSchedule(match.id, req.query.refresh === '1')
            : [];
        const now = Date.now();
        const horizon = now + 24 * 60 * 60 * 1000;
        const items = schedule
            .filter((programme) => new Date(programme.stop).getTime() > now && new Date(programme.start).getTime() < horizon)
            .sort((a, b) => new Date(a.start) - new Date(b.start))
            .slice(0, 8);

        res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
        res.json({
            ok: true,
            source: 'epg.pw/channel-api',
            query: channelName,
            timezone: 'Europe/Paris',
            matched: channel ? {
                id: channel.id,
                name: match.matchedName || channel.names[0] || channelName,
                icon: channel.icon,
                confidence: match.score
            } : null,
            current: items.find((item) => new Date(item.start).getTime() <= now && new Date(item.stop).getTime() > now) || null,
            next: items.find((item) => new Date(item.start).getTime() > now) || null,
            items,
            updatedAt: new Date(epg.updatedAt).toISOString()
        });
    } catch (error) {
        console.error('EPG France error:', error.message);
        res.status(502).json({ ok: false, source: 'epg.pw', query: channelName, current: null, next: null, items: [], error: 'Guide TV temporairement indisponible.' });
    }
});

app.get('/api/direct/channel-stream', async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        res.json(await resolveCdnLiveStream(req.query.url));
    } catch (error) {
        console.error('[ERROR DIRECT STREAM]', error.message);
        res.status(502).json({ ok: false, source: 'cdnlivetv', error: error.message });
    }
});

// 🩺 Etat de l'API et du domaine actif
app.get('/api/status', (req, res) => {
    const memory = process.memoryUsage();
    res.json({
        ok: true,
        source: currentBaseUrl,
        domain: currentBaseUrl,
        fallbackDomains: BASE_URLS,
        cacheItems: cache.size,
        cacheSize: cache.size,
        uptime: process.uptime(),
        memory,
        catalog: {
            limits: FULL_CATALOG_PAGE_LIMITS,
            film: getCatalogBuildState('movie', FULL_CATALOG_PAGE_LIMITS.movie),
            series: getCatalogBuildState('series', FULL_CATALOG_PAGE_LIMITS.series)
        },
        endpoints: [
            '/api/film',
            '/api/film/all?limit=all',
            '/api/film/all/progress',
            '/api/film/page/:page',
            '/api/film/:id',
            '/api/film/:id/sources',
            '/api/serie',
            '/api/serie/all?limit=all',
            '/api/serie/all/progress',
            '/api/serie/page/:page',
            '/api/serie/:id',
            '/api/serie/:id/episodes',
            '/api/serie/:id/sources',
            '/api/serie/:id/episode/:episodeNumber',
            '/api/serie/:id/seasons',
            '/api/movies?page=1',
            '/api/movies/all?limit=10',
            '/api/catalog/bootstrap?limit=4',
            '/api/catalog/status',
            '/api/cache/build',
            '/api/cache/warm',
            '/api/library/stats',
            '/api/series?page=1',
            '/api/series/all?limit=10',
            '/api/search?q=batman',
            '/api/details/:id',
            '/api/stream/:id',
            '/api/episodes/:id',
            '/api/seasons/:query',
            '/api/direct/resolve',
            '/api/direct/status',
            '/api/direct/playlist',
            '/api/direct/channel-stream?url=...',
            '/api/direct/channels'
        ],
        updatedAt: new Date().toISOString()
    });
});

app.get('/api/library/stats', async (req, res) => {
    try {
        const [movies, series] = await Promise.all([
            getAllFilms(getBootstrapLimit(req.query.limit || 4)),
            getAllSeries(getBootstrapLimit(req.query.limit || 4))
        ]);

        res.json({
            ok: true,
            source: currentBaseUrl,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cacheSize: cache.size,
            cacheItems: cache.size,
            movies: movies.total || 0,
            series: series.total || 0,
            totals: {
                movies: movies.total || 0,
                series: series.total || 0,
                all: (movies.total || 0) + (series.total || 0)
            },
            updatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[ERROR LIBRARY STATS]', error.message);
        res.status(500).json({
            ok: false,
            source: currentBaseUrl,
            error: error.message,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cacheSize: cache.size,
            movies: 0,
            series: 0
        });
    }
});

// 🔄 Force la recherche du domaine actif sans redémarrer le serveur
app.post('/api/refresh-domain', requireAdminAction, async (req, res) => {
    try {
        const domain = await findWorkingUrl();
        res.json({ ok: true, domain });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message, domain: currentBaseUrl });
    }
});

// 🏠 Page d'accueil
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use('/api', (req, res) => {
    res.status(404).json({
        ok: false,
        error: 'Endpoint API introuvable',
        path: req.originalUrl
    });
});

app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});


// Vérifie automatiquement le domaine toutes les 10 minutes.
setInterval(() => {
    findWorkingUrl().catch((error) => {
        console.log('[DOMAIN] Rafraîchissement impossible :', error.message);
    });
}, 10 * 60 * 1000);

// IPTV-org est synchronisé en arrière-plan. La dernière version valide reste disponible en cas de panne distante.
setInterval(() => {
    iptvOrgService.refresh(false).catch((error) => {
        console.log('[IPTV-ORG] Synchronisation différée :', error.message);
    });
}, IPTV_ORG_CACHE_DURATION);

// Démarrage
app.listen(PORT, "0.0.0.0", async () => {
    installBundledCatalogSeeds();
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    const networkUrls = getLocalNetworkUrls(PORT);
    if (networkUrls.length) {
        console.log('📱 URL telephone/tablette sur le meme reseau:');
        networkUrls.forEach((url) => console.log(`  ${url}`));
        console.log('🌍 Hors Wi-Fi: utilise Tailscale puis ouvre http://ADRESSE_TAILSCALE:3000');
    }
    console.log(`🧭 Fichier serveur: ${__filename}`);
    setTimeout(() => {
        iptvOrgService.getSnapshot().catch((error) => console.log('[IPTV-ORG] Initialisation différée :', error.message));
    }, 1500);
    printRegisteredRoutes();
    console.log('🔍 Recherche de l\'URL FrenchStream fonctionnelle...');
    await findWorkingUrl();
    console.log(`✅ Utilisation de: ${currentBaseUrl}`);
    console.log('');
    console.log('📚 Endpoints:');
    console.log(`  API Film: http://localhost:${PORT}/api/film/all?limit=all`);
    console.log(`  Film p1:  http://localhost:${PORT}/api/film/page/1`);
    console.log(`  Bootstrap:http://localhost:${PORT}/api/catalog/bootstrap?limit=all`);
    console.log(`  Stats:    http://localhost:${PORT}/api/library/stats`);
    console.log(`  API Série:http://localhost:${PORT}/api/serie/all?limit=all`);
    console.log(`  Série p1: http://localhost:${PORT}/api/serie/page/1`);
    console.log(`  Recherche:http://localhost:${PORT}/api/search?q=batman`);
    console.log(`  Détails:  http://localhost:${PORT}/api/details/15113307`);
    console.log(`  Stream:   http://localhost:${PORT}/api/stream/15113307`);
    console.log(`  Episodes: http://localhost:${PORT}/api/episodes/15113307`);
    console.log(`  Saisons:  http://localhost:${PORT}/api/seasons/The%20Last%20Of%20Us`);
});
