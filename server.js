const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
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

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Cache simple
const cache = new Map();
const inFlightCache = new Map();
const catalogBuilds = new Map();
let fullCatalogBuildRunning = false;
const CACHE_DURATION = 5 * 60 * 1000;
const ALL_CACHE_DURATION = 30 * 60 * 1000;
const DETAILS_CACHE_DURATION = 10 * 60 * 1000;
const SOURCES_CACHE_DURATION = 5 * 60 * 1000;
const FULL_CATALOG_PAGE_LIMITS = {
    movie: 1312,
    series: 691
};
const DEFAULT_ALL_PAGE_LIMIT = FULL_CATALOG_PAGE_LIMITS.movie;
const MAX_ALL_PAGE_LIMIT = Math.max(FULL_CATALOG_PAGE_LIMITS.movie, FULL_CATALOG_PAGE_LIMITS.series);
const CATALOG_BATCH_SIZE = Math.max(1, Math.min(Number(process.env.CATALOG_BATCH_SIZE) || 2, 4));
const PERSISTENT_CACHE_DIR = path.join(__dirname, '.cache');
const PERSISTENT_CATALOG_DURATION = 12 * 60 * 60 * 1000;

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

function readPersistentCatalog(kind, limit) {
    try {
        const file = getPersistentCatalogPath(kind, limit);
        if (!fs.existsSync(file)) return null;
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed?.savedAt || Date.now() - parsed.savedAt > PERSISTENT_CATALOG_DURATION) return null;
        return parsed.data || null;
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
            JSON.stringify({ savedAt: Date.now(), data }, null, 2),
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
            JSON.stringify({ savedAt: Date.now(), data }, null, 2),
            'utf8'
        );
    } catch (error) {
        console.log(`[CACHE] Ecriture checkpoint impossible (${kind}) : ${error.message}`);
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
                    return { page, items: [] };
                }
            }));

            pages.sort((a, b) => a.page - b.page);

            let newItemsInBatch = 0;
            for (const result of pages) {
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
                    console.log(`🛑 Arrêt ${kind}: page ${result.page} sans nouveau contenu.`);
                    stopped = true;
                    break;
                }
            }

            if (!newItemsInBatch) {
                console.log(`🛑 Arrêt ${kind}: aucune nouveauté dans le lot ${startPage}-${endPage}.`);
                stopped = true;
            }

            writePersistentCatalogCheckpoint(kind, limit, {
                type: kind === 'series' ? 'series' : 'movie',
                limit,
                page: lastPage,
                total: allItems.length,
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
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const paths = [
        `/static/series/${id}.js`,
        `/css/sr_${id}.css`,
        `/font/sr_${id}.woff2`,
        `/assets/poster_${id}.json`,
        `/data/eps_${id}.txt`,
        `/ep-data.php?id=${id}&format=js`
    ];

    for (const path of paths) {
        try {
            const response = await axios.get(`${currentBaseUrl}${path}`, axiosConfig);
            let data = response.data;
            if (typeof data === 'string') {
                data = JSON.parse(data);
            }

            if (data && typeof data === 'object' && !data.error) {
                setCached(cacheKey, data);
                return data;
            }
        } catch (error) {
            console.log(`⚠️ Episodes indisponibles via ${path}: ${error.message}`);
        }
    }

    return null;
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
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached && (!includeSources || cached.sources)) return cached;

    const details = await scrapeDetails(apiId);
    const film = {
        ...details,
        id: apiId,
        type: 'movie',
        isSeries: false,
        sources: includeSources ? (await getFilmSources(apiId)).sources : (details.sources || [])
    };

    setCachedFor(cacheKey, film);
    return film;
}

async function getFilmSources(id) {
    const apiId = getApiId(id);
    const cacheKey = `sources_${apiId}`;
    const cached = getCachedFor(cacheKey, SOURCES_CACHE_DURATION);
    if (cached) return cached;

    const result = await scrapeFilmSources(apiId, false);
    setCachedFor(cacheKey, result);
    return result;
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
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached && (!includeEpisodes || cached.episodes)) return cached;

    const details = await scrapeDetails(apiId);
    const parsed = parseSeasonTitle(details.title);
    const serie = {
        ...details,
        id: apiId,
        type: 'series',
        isSeries: true,
        baseTitle: parsed.baseTitle || details.title,
        season: parsed.season,
        episodes: includeEpisodes ? normalizeSeriesEpisodes(await getSerieEpisodeData(apiId)) : (details.episodes || [])
    };

    setCachedFor(cacheKey, serie);
    return serie;
}

async function getSerieEpisodeData(id) {
    const apiId = getApiId(id);
    const cacheKey = `serie_episodes_${apiId}`;
    const cached = getCachedFor(cacheKey, DETAILS_CACHE_DURATION);
    if (cached) return cached;

    const data = await fetchSeriesEpisodeData(apiId);
    const result = {
        id: apiId,
        vf: data?.vf || {},
        vostfr: data?.vostfr || {},
        vo: data?.vo || {},
        info: data?.info || {}
    };

    setCachedFor(cacheKey, result);
    return result;
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

    const response = await axios.get(url, axiosConfig);
    const $ = cheerio.load(response.data);

    const apiUrl = `${currentBaseUrl}/engine/ajax/film_api.php?id=${apiId}`;
    const apiResponse = await axios.get(apiUrl, axiosConfig);

    let apiData = apiResponse.data;
    if (typeof apiData === 'string') {
        apiData = JSON.parse(apiData);
    }

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

async function scrapeFilmSources(id, allowSeriesFallback = true) {
    const apiId = getApiId(id);
    const url = `${currentBaseUrl}/engine/ajax/film_api.php?id=${apiId}`;
    console.log(`[SCRAPING] Stream: ${url}`);

    const response = await axios.get(url, axiosConfig);
    let data = response.data;
    if (typeof data === 'string') {
        data = JSON.parse(data);
    }

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
        res.json(await getFilmDetails(req.params.id, true));
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
        res.json(await getSerieDetails(req.params.id, true));
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
        persistentCacheDir: PERSISTENT_CACHE_DIR,
        film: filmState,
        series: serieState,
        ready: filmState.state === 'ready' && serieState.state === 'ready',
        updatedAt: new Date().toISOString()
    });
});

app.post('/api/cache/build', async (req, res) => {
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

app.get('/api/cache/warm', (req, res) => {
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
            '/api/seasons/:query'
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
app.post('/api/refresh-domain', async (req, res) => {
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


// Vérifie automatiquement le domaine toutes les 10 minutes.
setInterval(() => {
    findWorkingUrl().catch((error) => {
        console.log('[DOMAIN] Rafraîchissement impossible :', error.message);
    });
}, 10 * 60 * 1000);

// Démarrage
app.listen(PORT, "0.0.0.0", async () => {
    console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
    const networkUrls = getLocalNetworkUrls(PORT);
    if (networkUrls.length) {
        console.log('📱 URL telephone/tablette sur le meme reseau:');
        networkUrls.forEach((url) => console.log(`  ${url}`));
        console.log('🌍 Hors Wi-Fi: utilise Tailscale puis ouvre http://ADRESSE_TAILSCALE:3000');
    }
    console.log(`🧭 Fichier serveur: ${__filename}`);
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
