const ITEMS_PER_PAGE = window.MadradorConfig?.ITEMS_PER_PAGE || 24;
const KEEPALIVE_INTERVAL_MS = 14 * 60 * 1000;

let currentTab = 'home';
let currentPage = 1;
let lastItems = [];
let movieItems = [];
let seriesItems = [];
let isSearching = false;
let heroIndex = 0;
let heroTimer = null;
let heroItems = [];
let currentHeroItem = null;
let heroDetailsToken = 0;
let quickItem = null;
let quickTrailerEmbed = '';
let quickTrailerWatch = '';
let toastTimer = null;
let searchMode = 'all';
let searchSuggestIndex = -1;
let searchDebounce = null;
let backendSuggestToken = 0;
let keepaliveTimer = null;
let catalogHydrationAttempts = 0;
const pendingJsonRequests = new Map();
let catalogBackgroundTimer = null;
let heroInteractionStarted = false;
let autoBrowseEnabled = localStorage.getItem('madrador:auto-browse') === 'true';
let autoBrowseTimer = null;

const $ = (id) => document.getElementById(id);
const rows = $('rows');
const loading = $('loading');
const empty = $('empty');

function formatVisibleCount(count) {
  const total = Number(count) || 0;
  return `${total} titre${total > 1 ? 's' : ''} affiché${total > 1 ? 's' : ''}`;
}

const FILTER_GROUPS = {
  genreFilters: ['Action', 'Aventure', 'Animation', 'Arts martiaux', 'Comédie', 'Crime', 'Documentaire', 'Drame', 'Fantastique', 'Horreur', 'Romance', 'Science-Fiction', 'Thriller'],
  languageFilters: ['TrueFrench', 'French', 'VF', 'VF+VOSTFR', 'VOSTFR'],
  themeFilters: ['Netflix', 'Disney+', 'Prime Video', 'Animation', 'Super-héros', 'Famille', 'Épouvante', 'Manga', 'Guerre', 'Suspense'],
  collectionFilters: ['Films 2026', 'Films 2025', 'Films 2024', 'Séries 2026', 'Séries 2025', 'Top IMDb']
};

window.addEventListener('DOMContentLoaded', () => {
  renderSkeletons();
  renderFilters();
  bindBrowsePanels();
  bindUI();
  setAutoBrowse(autoBrowseEnabled);
  startKeepalivePing();
  loadHome();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((eventName) => {
    window.addEventListener(eventName, enableHeroAutoplay, { once: true, passive: true });
  });
});

function enableHeroAutoplay() {
  heroInteractionStarted = true;
  resumeHeroCarousel();
}

function startKeepalivePing() {
  if (keepaliveTimer) return;
  pingKeepalive();
  keepaliveTimer = window.setInterval(pingKeepalive, KEEPALIVE_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pingKeepalive();
  });
}

async function pingKeepalive() {
  try {
    await fetch(`/api/keepalive?t=${Date.now()}`, {
      cache: 'no-store',
      keepalive: true
    });
  } catch (error) {
    console.warn('Keepalive indisponible.', error);
  }
}

function bindUI() {
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      location.href = `./catalog.html?type=${btn.dataset.tab}`;
    });
  });

  document.querySelectorAll('[data-switch]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.switch));
  });

  $('backBtn')?.addEventListener('click', () => {
    if (currentTab !== 'home' || isSearching) {
      currentTab = 'home';
      isSearching = false;
      $('search').value = '';
      setActiveNav($('homeBtn'));
      loadHome();
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });
  $('searchBtn')?.addEventListener('click', search);
  $('reloadBtn')?.addEventListener('click', () => {
    $('search').value = '';
    isSearching = false;
    loadHome();
  });
  $('apiRetry')?.addEventListener('click', () => {
    hideApiStatus();
    if ($('search').value.trim()) {
      search();
    } else {
      loadHome();
    }
  });
  $('prevBtn').addEventListener('click', () => changePage(-1));
  $('nextBtn').addEventListener('click', () => changePage(1));
  $('autoBrowseBtn')?.addEventListener('click', () => setAutoBrowse(!autoBrowseEnabled));
  updateAutoBrowseButton();
  $('clearSearch').addEventListener('click', () => {
    $('search').value = '';
    isSearching = false;
    hideSearchSuggestions();
    loadHome();
  });
  $('homeBtn').addEventListener('click', () => {
    currentTab = 'home';
    setActiveNav($('homeBtn'));
    $('search').value = '';
    currentPage = 1;
    loadHome();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('sidebar').classList.remove('open');
  });
  $('advancedSearchBtn').addEventListener('click', () => {
    const q = $('search').value.trim();
    location.href = `./search.html${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  });
  $('directBtn').addEventListener('click', () => {
    location.href = './direct.html';
  });
  $('newBtn').addEventListener('click', () => { location.href = './catalog.html?view=new'; });
  $('popularBtn').addEventListener('click', () => { location.href = './catalog.html?view=popular'; });
  $('favoritesBtn').addEventListener('click', () => { location.href = './library.html?view=favorites'; });
  $('historyBtn').addEventListener('click', () => { location.href = './library.html?view=history'; });
  $('settingsBtn').addEventListener('click', () => {
    location.href = './settings.html';
  });
  $('topSettingsBtn')?.addEventListener('click', () => {
    location.href = './settings.html';
  });
  $('notifyBtn')?.addEventListener('click', () => {
    renderDashboardPanel('Notifications', [
      ['Nouveautés chargées', String([...movieItems, ...seriesItems].length)],
      ['Films disponibles', String(movieItems.length)],
      ['Séries regroupées', String(seriesItems.length)]
    ], 'Les nouveautés apparaissent automatiquement sur l’accueil dès que le catalogue répond.');
  });
  document.querySelectorAll('[data-side-filter]').forEach((button) => {
    button.addEventListener('click', () => quickSearch(button.dataset.sideFilter, button));
  });
  document.querySelectorAll('[data-search-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      searchMode = button.dataset.searchMode;
      document.querySelectorAll('[data-search-mode]').forEach((btn) => btn.classList.toggle('active', btn === button));
      renderSearchSuggestions();
      if ($('search').value.trim()) search();
    });
  });
  $('heroWatch').addEventListener('click', () => {
    if (currentHeroItem) openPlayer(currentHeroItem, true);
  });
  $('heroInfo').addEventListener('click', () => {
    if (currentHeroItem) openQuickDetails(currentHeroItem);
  });
  $('heroPrev').addEventListener('click', () => changeHero(-1));
  $('heroNext').addEventListener('click', () => changeHero(1));
  $('hero').addEventListener('pointerenter', stopHeroCarousel);
  $('hero').addEventListener('pointerleave', resumeHeroCarousel);
  $('hero').addEventListener('focusin', stopHeroCarousel);
  $('hero').addEventListener('focusout', (event) => {
    if (!$('hero').contains(event.relatedTarget)) resumeHeroCarousel();
  });
  $('quickClose').addEventListener('click', closeQuickDetails);
  $('quickModal').addEventListener('click', (event) => {
    if (event.target === $('quickModal')) closeQuickDetails();
  });
  $('quickWatch').addEventListener('click', () => {
    if (quickItem) openPlayer(quickItem, true);
  });
  $('quickFullDetails').addEventListener('click', () => {
    if (quickItem) openDetailsPage(quickItem);
  });
  $('quickFavorite').addEventListener('click', () => {
    if (!quickItem) return;
    toggleFavoriteItem(quickItem);
    renderQuickFavorite();
  });
  $('quickTrailer').addEventListener('click', openQuickTrailer);
  $('quickTrailerClose').addEventListener('click', closeQuickTrailer);
  $('quickTrailerModal').addEventListener('click', (event) => {
    if (event.target === $('quickTrailerModal')) closeQuickTrailer();
  });
  $('mobileMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('search').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const active = getActiveSuggestion();
      if (active) {
        event.preventDefault();
        chooseSuggestion(active);
      } else {
        search();
      }
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveSuggestion(1);
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveSuggestion(-1);
    }
    if (event.key === 'Escape') hideSearchSuggestions();
  });
  $('search').addEventListener('input', () => {
    renderTopSearchLoading(true);
    window.clearTimeout(searchDebounce);
    searchDebounce = window.setTimeout(renderSearchSuggestions, 120);
  });
  $('search').addEventListener('focus', renderSearchSuggestions);
  document.addEventListener('click', (event) => {
    if (!$('searchArea').contains(event.target)) hideSearchSuggestions();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeQuickDetails();
  });
}

async function loadHome() {
  isSearching = false;
  hideApiStatus();
  showLoading(true);

  try {
    const { moviesData, seriesData } = await fetchHomeCatalog(4);

    movieItems = normalizeItems(moviesData.items || [], 'movies')
      .filter((item) => item.type === 'movies');
    seriesItems = groupSeriesItems(
      normalizeItems(seriesData.items || [], 'series')
        .filter((item) => item.type === 'series')
    );
    lastItems = getActiveItems().slice(0, ITEMS_PER_PAGE);

    renderHomeRows();
    updatePager();
    startHeroCarousel();
    scheduleCatalogBackgroundWork();
  } catch (err) {
    console.error(err);
    renderRows([]);
    stopHeroCarousel();
    updateHero(null);
    showApiStatus(
      'Catalogue indisponible',
      'Impossible de charger les films et séries. Vérifie que le serveur local répond puis réessaie.'
    );
  } finally {
    showLoading(false);
  }
}

async function startCatalogCacheBuild() {
  try {
    const status = await fetchJson('/api/catalog/status?limit=all', { timeout: 6000, retries: 0 });
    if (status?.ready || [status?.film?.state, status?.series?.state].includes('building')) return;
    await fetch('/api/catalog/ensure', { method: 'POST' });
  } catch (error) {
    console.warn('Construction cache catalogue indisponible.', error);
  }
}

function scheduleCatalogBackgroundWork() {
  window.clearTimeout(catalogBackgroundTimer);
  const run = () => {
    startCatalogCacheBuild();
    hydrateHomeWithFullCatalog();
  };
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 15000 });
  } else {
    catalogBackgroundTimer = window.setTimeout(run, 10000);
  }
}

async function hydrateHomeWithFullCatalog() {
  try {
    const [moviesData, seriesData] = await Promise.all([
      fetchCatalogSnapshot('movie'),
      fetchCatalogSnapshot('series')
    ]);

    const nextMovies = normalizeItems(moviesData.items || [], 'movies')
      .filter((item) => item.type === 'movies');
    const nextSeries = groupSeriesItems(
      normalizeItems(seriesData.items || [], 'series')
        .filter((item) => item.type === 'series')
    );

    if (nextMovies.length > movieItems.length || nextSeries.length > seriesItems.length) {
      movieItems = nextMovies;
      seriesItems = nextSeries;
      lastItems = getActiveItems().slice(0, ITEMS_PER_PAGE);
      if (!isSearching && currentTab === 'home') {
        renderHomeRows();
        updatePager();
        startHeroCarousel();
      }
    }
    const complete = moviesData.complete === true && seriesData.complete === true;
    if (!complete && catalogHydrationAttempts < 20) {
      catalogHydrationAttempts += 1;
      window.clearTimeout(catalogBackgroundTimer);
      catalogBackgroundTimer = window.setTimeout(hydrateHomeWithFullCatalog, 15000);
    }
  } catch (error) {
    console.warn('Catalogue complet en arrière-plan indisponible.', error);
  }
}

async function fetchCatalogSnapshot(type) {
  const data = await fetchJson(`/api/catalog/snapshot?type=${type}&limit=all&maxItems=240`, { timeout: 8000, retries: 1 });
  if (data?.items?.length) return data;
  return fetchCatalogAll(type === 'series' ? 'series' : 'movies', 8);
}

async function search() {
  const q = $('search').value.trim();
  if (!q) return loadHome();

  saveSearchHistory(q);
  hideSearchSuggestions();
  isSearching = true;
  currentPage = 1;
  hideApiStatus();
  showLoading(true);

  try {
    const intent = parseSearchIntent(q);
    const backendQuery = intent.words.join(' ') || q;
    const localResults = searchLocalCatalog(q, getEffectiveSearchMode());
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(backendQuery)}`);
    const normalizedResults = rankSearchItems(dedupeMediaItems([
      ...localResults,
      ...normalizeItems(data.items || [], 'movies')
    ]), intent);
    const movies = normalizedResults.filter((item) => item.type === 'movies').slice(0, ITEMS_PER_PAGE);
    const series = groupSeriesItems(normalizedResults.filter((item) => item.type === 'series')).slice(0, ITEMS_PER_PAGE);
    const mode = getEffectiveSearchMode();
    const results = mode === 'series' ? series : mode === 'movies' ? movies : [...movies, ...series].slice(0, ITEMS_PER_PAGE);
    lastItems = results;
    renderRows(getSearchRows(q, movies, series));
    $('pageNum').textContent = formatVisibleCount(results.length);
    startHeroCarousel(q);
  } catch (err) {
    console.error(err);
    renderRows([]);
    stopHeroCarousel();
    updateHero(null, q);
    showApiStatus(
      'Recherche indisponible',
      'La recherche ne répond pas pour le moment. Tu peux réessayer dans quelques secondes.'
    );
  } finally {
    showLoading(false);
  }
}

function searchLocalCatalog(query, mode = 'all') {
  const intent = parseSearchIntent(query);
  const pool = mode === 'movies'
    ? movieItems
    : mode === 'series'
      ? seriesItems
      : [...movieItems, ...seriesItems];
  return rankSearchItems(dedupeMediaItems(pool), intent);
}

function parseSearchIntent(query) {
  const normalized = normalizeTitleKey(query);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const type = tokens.some((token) => ['serie', 'series', 'saison', 'episode'].includes(token))
    ? 'series'
    : tokens.some((token) => ['film', 'films', 'movie'].includes(token)) ? 'movies' : '';
  const year = tokens.find((token) => /^(19|20)\d{2}$/.test(token)) || '';
  const versions = tokens.filter((token) => ['vf', 'vostfr', 'vost', 'truefrench', 'french', 'vfq'].includes(token));
  const ignored = new Set(['film', 'films', 'movie', 'serie', 'series', 'saison', 'episode', year, ...versions]);
  const words = tokens.filter((token) => token && !ignored.has(token));
  return { normalized, words, type, year, versions };
}

function rankSearchItems(items, intent) {
  return items
    .map((item) => {
      if (intent.type && item.type !== intent.type) return { item, score: -1 };
      if (intent.year && String(item.year || '') !== intent.year) return { item, score: -1 };
      const title = normalizeTitleKey([item.title, item.originalTitle, item.seriesTitle].filter(Boolean).join(' '));
      const metadata = normalizeTitleKey([item.year, item.quality, item.version, ...(item.genres || [])].filter(Boolean).join(' '));
      if (intent.versions.length && !intent.versions.some((version) => metadata.includes(version))) return { item, score: -1 };
      let score = intent.normalized && `${title} ${metadata}`.includes(intent.normalized) ? 90 : 0;
      intent.words.forEach((word) => {
        if (title === word) score += 80;
        else if (title.startsWith(word)) score += 40;
        else if (title.includes(word)) score += 24;
        else if (metadata.includes(word)) score += 10;
        else if (title.split(' ').some((part) => isCloseSearchWord(word, part))) score += 8;
      });
      if (!intent.words.length && (intent.type || intent.year || intent.versions.length)) score += 12;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.title).localeCompare(String(b.item.title), 'fr'))
    .map((entry) => entry.item);
}

function isCloseSearchWord(left, right) {
  if (left.length < 4 || right.length < 4 || Math.abs(left.length - right.length) > 2) return false;
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let column = 0; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      );
    }
  }
  return rows[left.length][right.length] <= (Math.max(left.length, right.length) >= 8 ? 2 : 1);
}

async function fetchJson(url, options = {}) {
  if (pendingJsonRequests.has(url)) return pendingJsonRequests.get(url);
  const timeout = Number(options.timeout) || 10000;
  const retries = Math.max(0, Number(options.retries ?? 1));
  const task = (async () => {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`Erreur ${res.status}`);
        return await res.json();
      } catch (error) {
        lastError = error.name === 'AbortError' ? new Error('Délai de chargement dépassé') : error;
        if (attempt < retries) await new Promise((resolve) => window.setTimeout(resolve, 350 * (attempt + 1)));
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw lastError;
  })().finally(() => pendingJsonRequests.delete(url));
  pendingJsonRequests.set(url, task);
  return task;
}

async function fetchHomeCatalog(limit = 8) {
  try {
    const data = await fetchJson(`/api/catalog/bootstrap?limit=${limit}`);
    return {
      moviesData: data.movies || { items: [] },
      seriesData: data.series || { items: [] }
    };
  } catch (error) {
    console.warn('[CATALOG] /api/catalog/bootstrap indisponible, fallback /all.', error);
    const [moviesData, seriesData] = await Promise.all([
      fetchCatalogAll('movies', limit),
      fetchCatalogAll('series', limit)
    ]);
    return { moviesData, seriesData };
  }
}

async function fetchCatalogAll(kind, limit = 8) {
  const allEndpoint = kind === 'series'
    ? `/api/serie/all?limit=${limit}`
    : `/api/film/all?limit=${limit}`;
  try {
    return await fetchJson(allEndpoint);
  } catch (error) {
    console.warn(`[CATALOG] ${allEndpoint} indisponible, fallback legacy.`, error);
    const legacyEndpoint = `/api/${kind}/all?limit=${limit}`;
    const legacy = await fetchJson(legacyEndpoint).catch(() => null);
    if (legacy?.items) return legacy;
    const [first, second] = await Promise.all([
      fetchJson(kind === 'series' ? '/api/serie/page/1' : '/api/film/page/1'),
      fetchJson(kind === 'series' ? '/api/serie/page/2' : '/api/film/page/2').catch(() => ({ items: [] }))
    ]);
    return {
      type: kind === 'series' ? 'series' : 'movie',
      total: [...(first.items || []), ...(second.items || [])].length,
      items: [...(first.items || []), ...(second.items || [])]
    };
  }
}

function normalizeItems(items, fallbackType) {
  return items.map((item) => {
    const title = cleanRepeatedTitle(item.title || item.name || 'Sans titre');
    const seasonInfo = parseSeasonTitle(title);
    const type = inferItemType(item, fallbackType, seasonInfo);

    return {
      id: item.id || item.newsId || item.newsid || '',
      title: seasonInfo.baseTitle || title,
      originalTitle: title,
      poster: fixUrl(item.poster || item.image || item.img || item.affiche || ''),
      backdrop: fixUrl(item.backdrop || item.cover || ''),
      quality: item.quality || 'HD',
      version: item.version || 'VF',
      year: item.year || '',
      rating: item.rating || item.note || '',
      genres: normalizeMediaGenres(item.genres || item.genre || item.categories),
      description: item.description || item.synopsis || '',
      type,
      seasonNumber: seasonInfo.seasonNumber,
      seriesTitle: type === 'series' ? (seasonInfo.baseTitle || title) : undefined
    };
  }).filter((item) => item.id && item.title);
}

function normalizeMediaGenres(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
  return String(value || '').split(/[,|/]/).map((entry) => entry.trim()).filter(Boolean);
}

function inferItemType(item, fallbackType, seasonInfo) {
  const rawType = String(item.type || fallbackType || '').toLowerCase();
  const id = String(item.id || item.newsId || item.newsid || '');
  const link = String(item.link || item.url || '');

  if (item.isSeries === true || seasonInfo.seasonNumber) return 'series';
  if (rawType.includes('series') || rawType.includes('serie') || fallbackType === 'series') return 'series';
  if (id.includes('s-tv') || id.includes('serie') || link.includes('/s-tv/')) return 'series';
  return 'movies';
}

function groupSeriesItems(items) {
  const groups = new Map();
  const others = [];

  items.forEach((item) => {
    const isSeriesLike = item.type === 'series' || item.seasonNumber;
    if (!isSeriesLike) {
      others.push(item);
      return;
    }

    const key = normalizeTitleKey(item.seriesTitle || item.title);
    if (!groups.has(key)) {
      groups.set(key, {
        ...item,
        title: item.seriesTitle || item.title,
        type: 'series',
        seasons: []
      });
    }

    const group = groups.get(key);
    group.seasons.push({
      id: item.id,
      title: item.originalTitle || item.title,
      number: item.seasonNumber || group.seasons.length + 1,
      poster: item.poster,
      backdrop: item.backdrop,
      quality: item.quality,
      version: item.version,
      year: item.year
    });

    if (!group.poster && item.poster) group.poster = item.poster;
    if (!group.backdrop && item.backdrop) group.backdrop = item.backdrop;
  });

  return [...others, ...Array.from(groups.values()).map((group) => {
    group.seasons.sort((a, b) => Number(a.number) - Number(b.number));
    const preferredSeason = group.seasons[0];
    return {
      ...group,
      id: preferredSeason?.id || group.id,
      seasonNumber: preferredSeason?.number || group.seasonNumber
    };
  })];
}

function parseSeasonTitle(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  const patterns = [
    /^(.*?)\s*[-–—:|]\s*(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
    /^(.*?)\s+(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
    /^(.*?)\s*[-–—:|]\s*S(\d{1,2})(?=\D|$)/i,
    /^(.*?)\s+\bS(\d{1,2})(?=\D|$)/i
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1] && match?.[2]) {
      return {
        baseTitle: match[1].trim(),
        seasonNumber: Number(match[2])
      };
    }
  }

  return { baseTitle: clean, seasonNumber: null };
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function renderHomeRows() {
  const pageCount = getHomePageCount();
  currentPage = Math.min(Math.max(1, currentPage), pageCount);
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;
  const movies = movieItems.slice(offset, offset + ITEMS_PER_PAGE);
  const series = seriesItems.slice(offset, offset + ITEMS_PER_PAGE);
  const continueItems = dedupeMediaItems(MadradorStorage.continueWatching()).slice(0, 8);
  const favoriteItems = dedupeMediaItems(MadradorStorage.favorites()).slice(0, 12);
  const historyItems = dedupeMediaItems(MadradorStorage.history()).slice(0, 6);

  const homeRows = [
    { title: 'Continuer à regarder', items: continueItems, layout: 'land', variant: 'continue' },
    { title: 'Ma liste', items: favoriteItems, layout: 'poster', variant: 'favorites' },
    { title: 'Films du moment', items: movies.slice(0, 8), layout: 'land' },
    { title: 'Derniers Films', items: movies.slice(0, 10), layout: 'poster' },
    { title: 'Dernières Séries', items: series.slice(0, 10), layout: 'poster' },
    { title: 'Séries du moment', items: series.slice(0, 8), layout: 'land' },
    { title: 'Action', items: pickEvery(movies, 1, 12), layout: 'poster' },
    { title: 'Manga', items: pickEvery(series, 3, 12), layout: 'poster' },
    { title: 'New VOD', items: pickEvery(movies, 4, 12), layout: 'poster' },
    { title: 'Animés', items: pickEvery(series, 5, 12), layout: 'poster' },
    { title: 'Horreur', items: pickEvery(movies, 6, 12), layout: 'poster' },
    { title: 'Science-fiction', items: pickEvery([...series, ...movies], 8, 12), layout: 'poster' },
    { title: 'Populaires', items: pickEvery([...movies, ...series], 9, 12), layout: 'poster' },
    { title: 'Séries à reprendre', items: pickEvery(series, 7, 8), layout: 'land' },
    { title: 'Vu récemment', items: historyItems, layout: 'land', variant: 'history' }
  ];

  const movieRows = [
    { title: 'Films du moment', items: movies.slice(0, 8), layout: 'land' },
    { title: 'Tous les films', items: movies.slice(0, ITEMS_PER_PAGE), layout: 'poster' },
    { title: 'Action', items: pickEvery(movies, 1, 12), layout: 'poster' },
    { title: 'Horreur', items: pickEvery(movies, 6, 12), layout: 'poster' },
    { title: 'Science-fiction', items: pickEvery(movies, 8, 12), layout: 'poster' },
    { title: 'New VOD', items: pickEvery(movies, 4, 12), layout: 'poster' }
  ];

  const seriesRows = [
    { title: 'Séries du moment', items: series.slice(0, 8), layout: 'land' },
    { title: 'Toutes les séries', items: series.slice(0, ITEMS_PER_PAGE), layout: 'poster' },
    { title: 'Dernières Séries', items: series.slice(0, 14), layout: 'poster' },
    { title: 'Animés', items: pickEvery(series, 5, 12), layout: 'poster' },
    { title: 'Manga', items: pickEvery(series, 3, 12), layout: 'poster' },
    { title: 'Populaires', items: pickEvery(series, 9, 12), layout: 'poster' }
  ];

  const availableRows = (currentTab === 'movies' ? movieRows : currentTab === 'series' ? seriesRows : homeRows)
    .filter((row) => row.items.length);
  const rowDefs = currentTab === 'home' ? availableRows.slice(0, 4) : availableRows;

  lastItems = dedupeMediaItems(currentTab === 'movies' ? movies : currentTab === 'series' ? series : [...movies, ...series]);
  renderRows(rowDefs);
}

function renderRows(rowDefs) {
  rows.innerHTML = '';
  empty.classList.toggle('hidden', rowDefs.some((row) => row.items.length));

  rowDefs.forEach((row, rowIndex) => {
    const section = document.createElement('section');
    section.className = `content-row ${row.variant ? `row-${row.variant}` : ''}`;
    section.innerHTML = `
      <div class="row-head">
        <h2>${escapeHtml(row.title)}</h2>
        <button class="see-all" type="button">Tout voir</button>
      </div>
      <div class="row-track-wrap">
        <button class="row-arrow row-arrow-left" type="button" aria-label="Défiler à gauche"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="row-track ${row.layout === 'land' ? 'land-track' : 'poster-track'}"></div>
        <button class="row-arrow row-arrow-right" type="button" aria-label="Défiler à droite"><i class="fa-solid fa-chevron-right"></i></button>
      </div>`;

    const track = section.querySelector('.row-track');
    dedupeMediaItems(row.items).forEach((item, itemIndex) => track.appendChild(createCard(item, row.layout, rowIndex, itemIndex)));

    const leftArrow = section.querySelector('.row-arrow-left');
    const rightArrow = section.querySelector('.row-arrow-right');
    const updateArrows = () => {
      const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
      leftArrow.disabled = track.scrollLeft <= 4;
      rightArrow.disabled = track.scrollLeft >= maxScroll - 4;
    };
    leftArrow.addEventListener('click', () => {
      track.scrollBy({ left: -Math.max(track.clientWidth * 0.86, 320), behavior: 'smooth' });
    });
    rightArrow.addEventListener('click', () => {
      track.scrollBy({ left: Math.max(track.clientWidth * 0.86, 320), behavior: 'smooth' });
    });
    track.addEventListener('scroll', updateArrows, { passive: true });
    requestAnimationFrame(updateArrows);
    section.querySelector('.see-all').addEventListener('click', () => {
      renderFullCollection(row.title, row.items, row.layout);
    });

    rows.appendChild(section);
  });
}

function renderFullCollection(title, items, layout = 'poster') {
  stopHeroCarousel();
  const cleanItems = dedupeMediaItems(items);
  lastItems = cleanItems.slice(0, ITEMS_PER_PAGE);
  rows.innerHTML = '';
  empty.classList.toggle('hidden', !!cleanItems.length);

  const section = document.createElement('section');
  section.className = 'catalog-view';
  section.innerHTML = `
    <div class="catalog-head">
      <button class="btn glass" type="button" id="catalogBack"><i class="fa-solid fa-arrow-left"></i><span>Retour</span></button>
      <div>
        <span>Catalogue</span>
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="page-pill">${cleanItems.length} titre${cleanItems.length > 1 ? 's' : ''}</div>
    </div>
    <div class="catalog-grid ${layout === 'land' ? 'catalog-grid-land' : ''}"></div>`;

  const grid = section.querySelector('.catalog-grid');
  cleanItems.forEach((item, index) => grid.appendChild(createCard(item, layout === 'land' ? 'land' : 'poster', 0, index)));
  rows.appendChild(section);

  $('catalogBack').addEventListener('click', () => {
    renderHomeRows();
    startHeroCarousel();
  });
  $('pageNum').textContent = formatVisibleCount(cleanItems.length);
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getSearchRows(query, movies, series) {
  const mode = getEffectiveSearchMode();
  if (mode === 'movies') {
    return [{ title: `Films : ${query}`, items: movies, layout: 'poster' }].filter((row) => row.items.length);
  }
  if (mode === 'series') {
    return [{ title: `Séries : ${query}`, items: series, layout: 'poster' }].filter((row) => row.items.length);
  }
  return [
    { title: `Films : ${query}`, items: movies, layout: 'poster' },
    { title: `Séries : ${query}`, items: series, layout: 'poster' }
  ].filter((row) => row.items.length);
}

function getEffectiveSearchMode() {
  if (searchMode !== 'all') return searchMode;
  if (currentTab === 'movies' || currentTab === 'series') return currentTab;
  return 'all';
}

function getActiveItems() {
  if (currentTab === 'movies') return movieItems;
  if (currentTab === 'series') return seriesItems;
  return [...movieItems.slice(0, 12), ...seriesItems.slice(0, 12)];
}

function dedupeMediaItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = getMediaDedupeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMediaDedupeKey(item) {
  const type = String(item?.type || '').toLowerCase();
  if (type.includes('series') || type.includes('serie') || item?.seriesTitle || item?.season || item?.episode) {
    return `series:${normalizeTitleKey(getCleanSeriesTitle(item || {}))}`;
  }
  return `movie:${item?.id || normalizeTitleKey(item?.title || '')}`;
}

function renderSearchSuggestions() {
  const box = $('searchSuggest');
  const input = $('search');
  const q = input.value.trim();
  searchSuggestIndex = -1;

  const history = getSearchHistory();
  const pool = [...movieItems, ...seriesItems];
  const mode = getEffectiveSearchMode();
  const filteredPool = mode === 'movies' ? movieItems : mode === 'series' ? seriesItems : pool;
  const matches = q ? rankSearchItems(filteredPool, parseSearchIntent(q)).slice(0, 7) : [];
  const recent = q
    ? history.filter((term) => normalizeTitleKey(term).includes(normalizeTitleKey(q))).slice(0, 3)
    : history.slice(0, 5);
  const quick = q ? getQuickSearches(q, mode) : [];

  if (!q && !recent.length) {
    hideSearchSuggestions();
    renderTopSearchLoading(false);
    return;
  }

  box.innerHTML = `
    ${recent.length ? `<div class="suggest-group"><span>Recherches récentes</span>${recent.map((term) => `
      <button type="button" class="suggest-item suggest-term" data-term="${escapeHtml(term)}">
        <i class="fa-solid fa-clock-rotate-left"></i>
        <b>${escapeHtml(term)}</b>
        <small>Relancer</small>
      </button>`).join('')}</div>` : ''}
    ${quick.length ? `<div class="suggest-group"><span>Recherche rapide</span>${quick.map((term) => `
      <button type="button" class="suggest-item suggest-term" data-term="${escapeHtml(term)}">
        <i class="fa-solid fa-magnifying-glass"></i>
        <b>${escapeHtml(term)}</b>
        <small>${mode === 'series' ? 'Séries' : mode === 'movies' ? 'Films' : 'Tout'}</small>
      </button>`).join('')}</div>` : ''}
    ${matches.length ? `<div class="suggest-group"><span>Résultats du catalogue</span>${matches.map((item) => `
      <button type="button" class="suggest-item" data-item="${escapeHtml(item.id)}">
        <span class="suggest-cover">${getCardImage(item, 'poster') ? `<img src="${escapeHtml(getCardImage(item, 'poster'))}" alt="">` : '<i class="fa-solid fa-film"></i>'}</span>
        <b>${escapeHtml(item.title)}</b>
        <small>${item.type === 'series' ? 'Série' : 'Film'} • ${escapeHtml(item.quality || 'HD')} • ${escapeHtml(item.version || 'VF')}</small>
      </button>`).join('')}</div>` : ''}
    ${q && !matches.length && !quick.length ? '<div class="suggest-state"><span class="search-loader"></span><b>Recherche en ligne...</b></div>' : ''}`;

  box.classList.remove('hidden');
  input.setAttribute('aria-expanded', 'true');

  box.querySelectorAll('[data-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = filteredPool.find((entry) => String(entry.id) === String(button.dataset.item));
      if (item) {
        saveSearchHistory(item.title);
        openDetailsPage(item);
      }
    });
  });
  box.querySelectorAll('[data-term]').forEach((button) => {
    button.addEventListener('click', () => {
      $('search').value = button.dataset.term;
      search();
    });
  });

  if (q.length >= 2) {
    renderBackendSuggestions(parseSearchIntent(q).words.join(' ') || q, mode);
  } else {
    renderTopSearchLoading(false);
  }
}

async function renderBackendSuggestions(q, mode) {
  const token = ++backendSuggestToken;
  const box = $('searchSuggest');
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(q)}`);
    if (token !== backendSuggestToken || box.classList.contains('hidden')) return;

    const backendItems = normalizeItems(data.items || [], 'movies')
      .filter((item) => mode === 'all' || item.type === mode)
      .slice(0, 8);
    if (!backendItems.length) return;

    const existingIds = new Set([...box.querySelectorAll('[data-item]')].map((node) => String(node.dataset.item)));
    const fresh = backendItems.filter((item) => !existingIds.has(String(item.id))).slice(0, 6);
    if (!fresh.length) {
      if (!box.querySelector('[data-item]')) {
        box.innerHTML = '<div class="suggest-state empty"><span></span><b>Aucun résultat trouvé</b></div>';
      }
      return;
    }

    const group = document.createElement('div');
    group.className = 'suggest-group';
    group.innerHTML = `<span>Recherche en ligne</span>${fresh.map((item) => `
      <button type="button" class="suggest-item" data-item="${escapeHtml(item.id)}" data-backend="true">
        <span class="suggest-cover">${getCardImage(item, 'poster') ? `<img src="${escapeHtml(getCardImage(item, 'poster'))}" alt="">` : '<i class="fa-solid fa-film"></i>'}</span>
        <b>${escapeHtml(item.title)}</b>
        <small>${item.type === 'series' ? 'Série' : 'Film'} • ${escapeHtml(item.quality || 'HD')} • ${escapeHtml(item.version || 'VF')}</small>
      </button>`).join('')}`;
    box.appendChild(group);
    group.querySelectorAll('[data-item]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = fresh.find((entry) => String(entry.id) === String(button.dataset.item));
        if (item) {
          saveSearchHistory(item.title);
          openDetailsPage(item);
        }
      });
    });
  } catch (err) {
    console.warn('Suggestions backend indisponibles.', err);
    if (!box.querySelector('[data-item]')) {
      box.innerHTML = '<div class="suggest-state empty"><span></span><b>Aucun résultat trouvé</b></div>';
    }
  } finally {
    renderTopSearchLoading(false);
  }
}

function getQuickSearches(q, mode) {
  const suffix = mode === 'series' ? ['série', 'saison'] : mode === 'movies' ? ['film', 'HD'] : ['film', 'série'];
  return suffix.map((label) => `${q} ${label}`).slice(0, 2);
}

function hideSearchSuggestions() {
  const box = $('searchSuggest');
  if (!box) return;
  box.classList.add('hidden');
  $('search').setAttribute('aria-expanded', 'false');
  searchSuggestIndex = -1;
  renderTopSearchLoading(false);
}

function renderTopSearchLoading(show) {
  $('topSearchLoader')?.classList.toggle('hidden', !show);
}

function moveSuggestion(direction) {
  const items = [...$('searchSuggest').querySelectorAll('.suggest-item')];
  if (!items.length) return;
  $('searchSuggest').classList.remove('hidden');
  searchSuggestIndex = (searchSuggestIndex + direction + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle('active', index === searchSuggestIndex));
  items[searchSuggestIndex].scrollIntoView({ block: 'nearest' });
}

function getActiveSuggestion() {
  return $('searchSuggest').querySelector('.suggest-item.active');
}

function chooseSuggestion(button) {
  if (button.dataset.term) {
    $('search').value = button.dataset.term;
    search();
    return;
  }
  if (button.dataset.item) {
    const item = [...movieItems, ...seriesItems].find((entry) => String(entry.id) === String(button.dataset.item));
    if (item) {
      saveSearchHistory(item.title);
      openDetailsPage(item);
    }
  }
}

function getSearchHistory() {
  try {
    return JSON.parse(localStorage.getItem('madrador:search-history') || '[]');
  } catch (err) {
    return [];
  }
}

function saveSearchHistory(term) {
  const clean = String(term || '').trim();
  if (!clean) return;
  const next = [clean, ...getSearchHistory().filter((item) => normalizeTitleKey(item) !== normalizeTitleKey(clean))].slice(0, 8);
  localStorage.setItem('madrador:search-history', JSON.stringify(next));
}

function createCard(item, layout, rowIndex, itemIndex) {
  const card = document.createElement('article');
  const displayTitle = getDisplayTitle(item);
  const image = getCardImage(item, layout);
  const isFav = MadradorStorage.isFavorite(item.id);
  const progress = getProgressLabel(item);
  const prefs = MadradorStorage.getPrefs();
  const shouldLoadImage = image && !prefs.dataSaver;
  const loadingMode = prefs.preloadPosters ? 'eager' : 'lazy';

  card.className = `media-card ${layout === 'land' ? 'media-card-land' : 'media-card-poster'}`;
  card.style.animationDelay = `${Math.min((rowIndex * 35) + (itemIndex * 18), 520)}ms`;

  card.innerHTML = `
    <div class="media-thumb">
      ${shouldLoadImage ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(displayTitle)}" loading="${loadingMode}" data-media-id="${escapeHtml(item.id)}" data-media-type="${escapeHtml(item.type || 'movie')}" data-image-role="${layout === 'land' ? 'land' : 'poster'}">` : `<div class="no-poster"><i class="fa-solid ${prefs.dataSaver ? 'fa-gauge-high' : 'fa-film'}"></i></div>`}
      <div class="media-fade"></div>
      <div class="media-badges">
        <span>${item.type === 'series' ? 'Série' : 'Film'}</span>
        ${item.version ? `<span>${escapeHtml(item.version)}</span>` : ''}
        <span>${escapeHtml(item.quality || 'HD')}</span>
      </div>
      <button type="button" class="media-card-open" data-action="info" aria-label="Ouvrir les informations de ${escapeHtml(displayTitle)}"></button>
      <div class="media-actions">
        <button type="button" class="media-action primary-action" data-action="play" title="Regarder" aria-label="Regarder"><i class="fa-solid fa-play"></i></button>
        <button type="button" class="media-action" data-action="info" title="En savoir plus" aria-label="En savoir plus"><i class="fa-solid fa-circle-info"></i></button>
        <button type="button" class="media-action ${isFav ? 'active' : ''}" data-action="favorite" title="Ma liste" aria-label="Ma liste"><i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>
      </div>
      <h3>${escapeHtml(displayTitle)}</h3>
      ${progress ? `<div class="watch-progress"><span style="width:${progress.percent}%"></span><small>${escapeHtml(progress.label)}</small></div>` : ''}
    </div>`;
  bindImageFallback(card);

  card.querySelectorAll('[data-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = button.dataset.action;
      if (action === 'play') openPlayer(item, true);
      if (action === 'info') openQuickDetails(item);
      if (action === 'favorite') {
        toggleFavoriteItem(item);
        button.classList.toggle('active', MadradorStorage.isFavorite(item.id));
        button.innerHTML = `<i class="${MadradorStorage.isFavorite(item.id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
      }
    });
  });

  return card;
}

function getDisplayTitle(item) {
  if (!item) return 'Sans titre';
  const type = String(item.type || '').toLowerCase();
  if (type.includes('series') || type.includes('serie') || item.seriesTitle || item.season || item.episode) {
    return getCleanSeriesTitle(item);
  }
  return item.title || 'Sans titre';
}

function getProgressLabel(item) {
  if (!item?.playbackStartedAt && !Number(item?.playbackSeconds)) return null;
  const seconds = Math.max(0, Number(item.playbackSeconds) || 0);
  const percent = Math.max(2, Math.min(95, Number(item.progressPercent) || 2));
  const parts = [];
  if (item.season) parts.push(`S${item.season}`);
  if (item.episode) parts.push(`E${item.episode}`);
  if (seconds >= 60) parts.push(`${Math.floor(seconds / 60)} min`);
  return {
    percent,
    label: parts.length ? `Reprendre • ${parts.join(' • ')}` : 'Lecture commencée'
  };
}

function pickEvery(items, offset, count) {
  if (!items.length) return [];
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(index + offset) % items.length]);
}

function openPlayer(item, autoplay = false) {
  MadradorStorage.rememberMedia(item);
  const query = new URLSearchParams({
    id: item.id,
    type: item.type === 'series' ? 'series' : 'movie'
  });

  if (item.type === 'series') {
    query.set('seriesTitle', getCleanSeriesTitle(item));
  }
  if (autoplay) query.set('autoplay', '1');

  location.href = `./player.html?${query.toString()}`;
}

function openDetailsPage(item) {
  openPlayer(item, false);
}

function getCleanSeriesTitle(item) {
  const parsed = parseSeasonTitle(item.seriesTitle || item.title || '');
  return parsed.baseTitle || item.seriesTitle || item.title;
}

async function openQuickDetails(item) {
  quickItem = item;
  renderQuickShell(item);
  $('quickModal').classList.remove('hidden');
  document.body.classList.add('modal-open');

  try {
    const details = await fetchJson(getItemDetailsEndpoint(item));
    quickItem = normalizeDetailItem(item, details);
    renderQuickShell(quickItem, details);
  } catch (err) {
    console.warn('Détails rapides indisponibles.', err);
    $('quickDesc').textContent = 'Les détails complets sont indisponibles pour le moment, mais tu peux lancer la lecture.';
  }
}

function getItemDetailsEndpoint(item) {
  const apiItemId = encodeURIComponent(getApiId(item.id));
  return item.type === 'series'
    ? `/api/serie/${apiItemId}`
    : `/api/film/${apiItemId}`;
}

function closeQuickDetails() {
  closeQuickTrailer();
  $('quickModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  quickItem = null;
}

function renderQuickShell(item, details = {}) {
  const image = fixUrl(details.backdrop || item.backdrop || item.poster || '');
  const poster = fixUrl(details.poster || item.poster || item.backdrop || '');
  const typeLabel = item.type === 'series' || details.isSeries ? 'Série' : 'Film';
  const title = item.type === 'series' ? (item.seriesTitle || item.title) : (details.title || item.title);
  const desc = details.description || details.synopsis || details.desc || `${typeLabel} disponible dans Madrador TV.`;
  const genres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];
  const meta = [
    details.year || item.year,
    details.quality || item.quality || 'HD',
    details.version || item.version || 'VF'
  ].filter(Boolean);

  $('quickBackdrop').style.backgroundImage = image ? getQuickBackground(image) : '';
  $('quickPoster').innerHTML = poster
    ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(title)}">`
    : '<i class="fa-solid fa-film"></i>';
  bindImageFallback($('quickPoster'));
  $('quickType').innerHTML = `<i class="fa-solid ${typeLabel === 'Série' ? 'fa-tv' : 'fa-film'}"></i> ${typeLabel}`;
  $('quickTitle').textContent = title;
  $('quickMeta').innerHTML = meta.map((value) => `<span>${escapeHtml(value)}</span>`).join('');
  $('quickDesc').textContent = desc;
  $('quickGenres').innerHTML = genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('');
  const trailer = normalizeQuickTrailer(details.trailer || details.youtube || item.trailer || '');
  quickTrailerEmbed = trailer.embed;
  quickTrailerWatch = trailer.watch;
  $('quickTrailer').classList.toggle('hidden', !quickTrailerEmbed);
  renderQuickFavorite();
}

function normalizeQuickTrailer(value) {
  const raw = String(value || '').trim();
  if (!raw) return { embed: '', watch: '' };
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return getQuickYoutubeTrailerUrls(raw);

  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = '';
    if (hostname === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0] || '';
    if (hostname === 'youtube.com' || hostname === 'youtube-nocookie.com') {
      videoId = parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1] || '';
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? getQuickYoutubeTrailerUrls(videoId) : { embed: '', watch: '' };
  } catch (error) {
    return { embed: '', watch: '' };
  }
}

function getQuickYoutubeTrailerUrls(videoId) {
  const origin = encodeURIComponent(location.origin);
  return {
    embed: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&playsinline=1&origin=${origin}&widget_referrer=${encodeURIComponent(location.href)}`,
    watch: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function openQuickTrailer() {
  if (!quickTrailerEmbed) return;
  $('quickTrailerFrame').src = quickTrailerEmbed;
  $('quickTrailerExternal').href = quickTrailerWatch || quickTrailerEmbed;
  $('quickTrailerModal').classList.remove('hidden');
}

function closeQuickTrailer() {
  if (!$('quickTrailerModal')) return;
  $('quickTrailerFrame').src = 'about:blank';
  $('quickTrailerModal').classList.add('hidden');
}

function normalizeDetailItem(item, details) {
  const isSeries = details?.isSeries === true || item.type === 'series';
  return {
    ...item,
    title: isSeries ? (item.seriesTitle || parseSeasonTitle(details.title || item.title).baseTitle || item.title) : (details.title || item.title),
    poster: fixUrl(details.poster || item.poster || ''),
    backdrop: fixUrl(details.backdrop || item.backdrop || ''),
    quality: details.quality || item.quality,
    version: details.version || item.version,
    year: details.year || item.year,
    type: isSeries ? 'series' : 'movies',
    seriesTitle: isSeries ? (item.seriesTitle || parseSeasonTitle(details.title || item.title).baseTitle || item.title) : item.seriesTitle
  };
}

function renderQuickFavorite() {
  const active = quickItem && MadradorStorage.isFavorite(quickItem.id);
  $('quickFavorite').classList.toggle('is-favorite', active);
  $('quickFavorite').innerHTML = active
    ? '<i class="fa-solid fa-heart"></i><span>Dans ma liste</span>'
    : '<i class="fa-regular fa-heart"></i><span>Ma liste</span>';
}

function toggleFavoriteItem(item) {
  if (!item?.id) return;
  if (MadradorStorage.isFavorite(item.id)) {
    MadradorStorage.removeFavorite(item.id);
    showToast('Retiré de Ma liste');
  } else {
    MadradorStorage.addFavorite(item);
    showToast('Ajouté à Ma liste');
  }
}

function getQuickBackground(image) {
  return [
    'linear-gradient(90deg, rgba(5,7,17,.96), rgba(5,7,17,.66) 52%, rgba(5,7,17,.28))',
    'linear-gradient(0deg, rgba(5,7,17,.94), rgba(5,7,17,.12))',
    `url("${cssUrl(image)}")`
  ].join(', ');
}

function getApiId(value) {
  const clean = String(value || '').trim();
  const numericPrefix = clean.match(/^\d+/);
  return numericPrefix ? numericPrefix[0] : clean;
}

function setTab(tab) {
  currentTab = tab;
  currentPage = 1;
  isSearching = false;
  $('search').value = '';
  const active = document.querySelector(`[data-tab="${tab}"]`);
  if (active) setActiveNav(active);
  $('sidebar').classList.remove('open');
  loadHome();
}

function quickSearch(query, navButton) {
  setActiveNav(navButton);
  $('sidebar').classList.remove('open');
  openFilteredCatalog(query, 'genreFilters');
}

function setActiveNav(activeButton) {
  document.querySelectorAll('.nav').forEach((btn) => btn.classList.toggle('active', btn === activeButton));
  document.querySelectorAll('[data-side-filter]').forEach((btn) => btn.classList.toggle('active', btn === activeButton));
}

function renderLocalEmpty(title, message) {
  setActiveNav(document.activeElement);
  stopHeroCarousel();
  rows.innerHTML = `
    <section class="local-panel">
      <i class="fa-solid fa-circle-info"></i>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </section>`;
  empty.classList.add('hidden');
  $('pageNum').textContent = title;
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('sidebar').classList.remove('open');
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDashboardPanel(title, stats, message) {
  stopHeroCarousel();
  rows.innerHTML = `
    <section class="local-panel dashboard-panel">
      <i class="fa-solid fa-chart-simple"></i>
      <h2>${escapeHtml(title)}</h2>
      <div class="dashboard-stats">
        ${stats.map(([label, value]) => `
          <span><b>${escapeHtml(value)}</b><small>${escapeHtml(label)}</small></span>
        `).join('')}
      </div>
      <p>${escapeHtml(message)}</p>
      <div class="dashboard-actions">
        <button class="btn primary" type="button" id="dashHome"><i class="fa-solid fa-house"></i><span>Accueil</span></button>
        <button class="btn glass" type="button" id="dashSettings"><i class="fa-solid fa-gear"></i><span>Paramètres</span></button>
      </div>
    </section>`;
  empty.classList.add('hidden');
  $('pageNum').textContent = title;
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('dashHome').addEventListener('click', () => {
    currentTab = 'home';
    setActiveNav($('homeBtn'));
    loadHome();
  });
  $('dashSettings').addEventListener('click', () => {
    location.href = './settings.html';
  });
  $('sidebar').classList.remove('open');
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLocalCollection(title, items, activeButton) {
  setActiveNav(activeButton);
  stopHeroCarousel();
  const cleanItems = dedupeMediaItems(items);
  const stats = getCollectionStats(cleanItems);
  lastItems = cleanItems.slice(0, ITEMS_PER_PAGE);

  if (!cleanItems.length) {
    renderLocalEmpty(title, `Aucun élément dans ${title.toLowerCase()} pour le moment.`);
    return;
  }

  rows.innerHTML = `
    <section class="catalog-view local-collection">
      <div class="catalog-head">
        <button class="btn glass" type="button" id="localBack"><i class="fa-solid fa-house"></i><span>Accueil</span></button>
        <div>
          <span>Bibliothèque locale</span>
          <h2>${escapeHtml(title)}</h2>
          <p class="catalog-subtitle">${stats.total} titre${stats.total > 1 ? 's' : ''} • ${stats.movies} film${stats.movies > 1 ? 's' : ''} • ${stats.series} série${stats.series > 1 ? 's' : ''}</p>
        </div>
        <div class="catalog-actions">
          <button class="btn glass" type="button" id="localMovies"><i class="fa-solid fa-film"></i><span>Films</span></button>
          <button class="btn glass" type="button" id="localSeries"><i class="fa-solid fa-tv"></i><span>Séries</span></button>
          <button class="btn glass danger-btn" type="button" id="localClear"><i class="fa-solid fa-trash"></i><span>Vider</span></button>
        </div>
      </div>
      <div class="catalog-grid"></div>
    </section>`;
  const grid = rows.querySelector('.catalog-grid');
  const paintItems = (nextItems) => {
    grid.innerHTML = '';
    lastItems = nextItems.slice(0, ITEMS_PER_PAGE);
    if (!lastItems.length) {
      grid.innerHTML = `
        <div class="local-panel local-filter-empty">
          <i class="fa-solid fa-layer-group"></i>
          <h2>Rien ici</h2>
          <p>Aucun contenu ne correspond à ce filtre.</p>
        </div>`;
      $('pageNum').textContent = formatVisibleCount(0);
      return;
    }

    lastItems.forEach((item, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'local-card-wrap';
    wrap.appendChild(createCard(item, 'poster', 0, index));
    const remove = document.createElement('button');
    remove.className = 'local-remove';
    remove.type = 'button';
    remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    remove.setAttribute('aria-label', 'Retirer');
    remove.addEventListener('click', () => {
      if (title === 'Ma liste') MadradorStorage.removeFavorite(item.id);
      if (title === 'Historique') removeLocalItem(MadradorStorage.KEYS.history, item);
      renderLocalCollection(title, title === 'Ma liste' ? MadradorStorage.favorites() : MadradorStorage.history(), activeButton);
    });
    wrap.appendChild(remove);
    grid.appendChild(wrap);
  });
    $('pageNum').textContent = formatVisibleCount(lastItems.length);
  };
  paintItems(cleanItems);
  $('localBack').addEventListener('click', () => {
    currentTab = 'home';
    setActiveNav($('homeBtn'));
    loadHome();
  });
  $('localMovies').addEventListener('click', () => paintItems(cleanItems.filter((item) => item.type !== 'series')));
  $('localSeries').addEventListener('click', () => paintItems(cleanItems.filter((item) => item.type === 'series')));
  $('localClear').addEventListener('click', () => {
    if (title === 'Ma liste') MadradorStorage.clearFavorites();
    if (title === 'Historique') MadradorStorage.clearHistory();
    renderLocalCollection(title, [], activeButton);
    showToast(`${title} vidé`);
  });
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('sidebar').classList.remove('open');
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getCollectionStats(items) {
  const total = items.length;
  const series = items.filter((item) => item.type === 'series').length;
  return {
    total,
    series,
    movies: total - series
  };
}

function removeLocalItem(key, target) {
  try {
    const targetKey = getMediaDedupeKey(target);
    const items = JSON.parse(localStorage.getItem(key) || '[]').filter((item) => item.id !== target.id && getMediaDedupeKey(item) !== targetKey);
    localStorage.setItem(key, JSON.stringify(items));
  } catch (err) {
    console.warn('Suppression locale impossible.', err);
  }
}

async function ensureCatalogLoaded() {
  if (movieItems.length || seriesItems.length) return true;
  await loadHome();
  return movieItems.length || seriesItems.length;
}

async function renderNewReleases() {
  setActiveNav($('newBtn'));
  if (!(await ensureCatalogLoaded())) {
    renderLocalEmpty('Nouveautés indisponibles', 'Le catalogue local ne répond pas encore. Réessaie après actualisation.');
    return;
  }

  stopHeroCarousel();
  const mixed = dedupeMediaItems([...movieItems, ...seriesItems])
    .sort((a, b) => Number(b.year || 0) - Number(a.year || 0))
    .slice(0, ITEMS_PER_PAGE);
  lastItems = mixed;
  renderRows([{ title: 'Nouveautés', items: mixed, layout: 'poster' }]);
  $('pageNum').textContent = formatVisibleCount(mixed.length);
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('sidebar').classList.remove('open');
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function renderPopular() {
  setActiveNav($('popularBtn'));
  if (!(await ensureCatalogLoaded())) {
    renderLocalEmpty('Populaires indisponibles', 'Le catalogue local ne répond pas encore. Réessaie après actualisation.');
    return;
  }

  stopHeroCarousel();
  const popular = pickEvery(dedupeMediaItems([...movieItems, ...seriesItems]), 3, ITEMS_PER_PAGE);
  lastItems = popular;
  renderRows([{ title: 'Populaires', items: popular, layout: 'poster' }]);
  $('pageNum').textContent = formatVisibleCount(popular.length);
  $('prevBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('sidebar').classList.remove('open');
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function changePage(dir) {
  if (isSearching) return;
  const pageCount = getHomePageCount();
  const nextPage = autoBrowseEnabled && currentPage >= pageCount && dir > 0
    ? 1
    : Math.min(pageCount, Math.max(1, currentPage + dir));
  if (nextPage === currentPage && !autoBrowseEnabled) return;
  currentPage = nextPage;
  renderHomeRows();
  updatePager();
  startHeroCarousel();
  rows.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePager() {
  const pageCount = getHomePageCount();
  $('prevBtn').disabled = currentPage <= 1 || isSearching;
  $('nextBtn').disabled = isSearching || (!autoBrowseEnabled && currentPage >= pageCount) || !lastItems.length;
  $('pageNum').textContent = isSearching
    ? formatVisibleCount(lastItems.length)
    : `Page ${currentPage}/${pageCount} · ${formatVisibleCount(lastItems.length)}`;
}

function getHomePageCount() {
  const total = currentTab === 'movies'
    ? movieItems.length
    : currentTab === 'series' ? seriesItems.length : Math.max(movieItems.length, seriesItems.length);
  return Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
}

function setAutoBrowse(enabled) {
  autoBrowseEnabled = Boolean(enabled);
  localStorage.setItem('madrador:auto-browse', String(autoBrowseEnabled));
  updateAutoBrowseButton();
  window.clearInterval(autoBrowseTimer);
  autoBrowseTimer = null;
  if (autoBrowseEnabled) {
    autoBrowseTimer = window.setInterval(() => {
      if (!document.hidden && !isSearching && !document.querySelector('.quick-modal:not(.hidden)')) changePage(1);
    }, 10000);
  }
  updatePager();
}

function updateAutoBrowseButton() {
  const button = $('autoBrowseBtn');
  if (!button) return;
  button.classList.toggle('active', autoBrowseEnabled);
  button.setAttribute('aria-pressed', String(autoBrowseEnabled));
  button.querySelector('span').textContent = autoBrowseEnabled ? 'Auto activé' : 'Défilement auto';
}

function getCardImage(item, layout = 'land') {
  return layout === 'land' ? (item.backdrop || item.poster) : (item.poster || item.backdrop);
}

function updateHero(item, query = '') {
  const hero = $('hero');
  const title = $('heroTitle');
  const text = $('heroText');
  const token = ++heroDetailsToken;
  currentHeroItem = item || null;

  if (!item) {
    hero.classList.remove('hero-ready', 'hero-fit');
    hero.style.backgroundImage = '';
    hero.style.setProperty('--hero-background', 'none');
    $('heroEyebrow').innerHTML = '<i class="fa-solid fa-bolt"></i> À la une';
    title.textContent = query ? `Recherche : ${query}` : 'Madrador TV';
    text.textContent = 'Une interface cinéma rapide, responsive et compatible avec ton backend actuel.';
    return;
  }

  const prefs = MadradorStorage.getPrefs();
  const image = prefs.dataSaver ? '' : (item.backdrop || item.poster);
  hero.classList.remove('hero-ready', 'hero-fit');
  hero.style.backgroundImage = image ? getHeroBackground(image) : '';
  hero.style.setProperty('--hero-background', image ? getHeroBackground(image) : 'none');
  $('heroEyebrow').innerHTML = `<i class="fa-solid fa-bolt"></i> À la une${String(image || '').includes('image.tmdb.org') ? ' • TMDB HD' : ''}`;
  title.textContent = item.title;
  text.textContent = `${item.type === 'series' ? 'Série' : 'Film'} • ${item.quality || 'HD'}${item.version ? ` • ${item.version}` : ''}${item.year ? ` • ${item.year}` : ''}`;
  setHeroImageMode(hero, image, !item.backdrop);
  renderHeroDots();
  window.setTimeout(() => hero.classList.add('hero-ready'), 30);

  if (!prefs.dataSaver && shouldUpgradeHeroImage(item, image)) {
    enrichHeroSlide(item, query, token);
  }
}

function shouldUpgradeHeroImage(item, image) {
  if (!item || item.heroEnriched) return false;
  if (!image) return true;
  if (String(image).includes('image.tmdb.org')) {
    return !item.backdrop || /\/t\/p\/(?:w92|w154|w185|w300|w342|w500)\//i.test(String(image));
  }
  return !item.backdrop || /\/uploads\/|\/thumb|\/resize|\/cache|\/poster_/i.test(String(image));
}

async function enrichHeroSlide(item, query, token) {
  item.heroEnriched = true;
  const startedAt = performance.now();
  try {
    const request = new URLSearchParams({
      title: item.seriesTitle || item.title || query || '',
      type: item.type === 'series' ? 'series' : 'movie'
    });
    if (item.year) request.set('year', item.year);
    const response = await fetchJson(`/api/tmdb/enrich?${request.toString()}`);
    const details = response?.item || {};
    const nextBackdrop = fixUrl(details.backdrop || '');
    const nextPoster = fixUrl(details.poster || '');
    const nextImage = nextBackdrop || nextPoster;

    if (!nextImage || token !== heroDetailsToken || currentHeroItem?.id !== item.id) return;

    const enriched = {
      ...item,
      title: item.type === 'series' ? (item.seriesTitle || parseSeasonTitle(details.title || item.title).baseTitle || item.title) : (details.title || item.title),
      poster: nextPoster || item.poster,
      backdrop: nextBackdrop || item.backdrop,
      description: details.description || item.description,
      year: details.year || item.year,
      quality: details.quality || item.quality,
      version: details.version || item.version,
      heroEnriched: true
    };

    const index = heroItems.findIndex((entry) => String(entry.id) === String(item.id));
    if (index !== -1) heroItems[index] = enriched;
    if (performance.now() - startedAt > 1500) return;
    currentHeroItem = enriched;

    const hero = $('hero');
    hero.classList.remove('hero-ready', 'hero-fit');
    hero.style.backgroundImage = getHeroBackground(nextImage);
    hero.style.setProperty('--hero-background', getHeroBackground(nextImage));
    $('heroEyebrow').innerHTML = '<i class="fa-solid fa-bolt"></i> À la une • TMDB HD';
    $('heroTitle').textContent = enriched.title;
    $('heroText').textContent = `${enriched.type === 'series' ? 'Série' : 'Film'} • ${enriched.quality || 'HD'}${enriched.version ? ` • ${enriched.version}` : ''}${enriched.year ? ` • ${enriched.year}` : ''}`;
    setHeroImageMode(hero, nextImage, !nextBackdrop);
    window.setTimeout(() => hero.classList.add('hero-ready'), 30);
  } catch (error) {
    console.warn('Image TMDB hero indisponible.', error);
  }
}

function getHeroBackground(image) {
  const heroImage = getHighResHeroImage(image);
  return [
    'linear-gradient(90deg, rgba(5,7,17,.68), rgba(5,7,17,.36) 52%, rgba(5,7,17,.10))',
    'linear-gradient(0deg, rgba(5,7,17,.70), rgba(5,7,17,.05) 52%, rgba(5,7,17,.08))',
    `url("${cssUrl(heroImage)}")`
  ].join(', ');
}

function getHighResHeroImage(image) {
  const url = String(image || '');
  if (!url.includes('image.tmdb.org')) return url;
  return url.replace(/\/t\/p\/[^/]+\//, '/t/p/w780/');
}

function setHeroImageMode(hero, image, isPosterFallback) {
  if (!image) return;

  if (isPosterFallback) {
    hero.classList.add('hero-fit');
    return;
  }

  const preview = new Image();
  preview.onload = () => {
    const ratio = preview.naturalWidth / Math.max(preview.naturalHeight, 1);
    if (preview.naturalWidth < 720 || ratio < .72) {
      hero.classList.add('hero-fit');
    }
  };
  preview.src = image;
}

function startHeroCarousel(query = '') {
  stopHeroCarousel();

  if (!lastItems.length) {
    heroItems = [];
    updateHero(null, query);
    return;
  }

  heroItems = lastItems.slice(0, Math.min(lastItems.length, 6));
  heroIndex = 0;
  updateHero(heroItems[heroIndex], query);

  resumeHeroCarousel(query);
}

function resumeHeroCarousel(query = '') {
  stopHeroCarousel();
  if (!heroInteractionStarted || heroItems.length < 2 || document.hidden) return;
  heroTimer = window.setInterval(() => changeHero(1, query), 10000);
}

function changeHero(direction, query = '') {
  if (!heroItems.length) return;
  heroIndex = (heroIndex + direction + heroItems.length) % heroItems.length;
  updateHero(heroItems[heroIndex], query);
}

function renderHeroDots() {
  const box = $('heroDots');
  if (!box) return;
  box.innerHTML = heroItems.map((_, index) => (
    `<button class="${index === heroIndex ? 'active' : ''}" type="button" data-hero="${index}" aria-label="Slide ${index + 1}"></button>`
  )).join('');

  box.querySelectorAll('[data-hero]').forEach((button) => {
    button.addEventListener('click', () => {
      heroIndex = Number(button.dataset.hero);
      updateHero(heroItems[heroIndex]);
    });
  });
}

function stopHeroCarousel() {
  if (!heroTimer) return;
  window.clearInterval(heroTimer);
  heroTimer = null;
}

function renderSkeletons() {
  loading.innerHTML = Array.from({ length: ITEMS_PER_PAGE }, () => '<div class="skeleton-card"></div>').join('');
}

function renderFilters() {
  Object.entries(FILTER_GROUPS).forEach(([id, labels]) => {
    const box = $(id);
    if (!box) return;
    box.innerHTML = labels.map((label) => `
      <button type="button" data-filter="${escapeHtml(label)}" data-filter-group="${escapeHtml(id)}">
        <i class="fa-solid fa-angle-right"></i>${escapeHtml(label)}
      </button>`).join('');

    box.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        openFilteredCatalog(button.dataset.filter, button.dataset.filterGroup);
      });
    });
  });
}

function bindBrowsePanels() {
  const tabs = [...document.querySelectorAll('[data-browse-tab]')];
  const panels = [...document.querySelectorAll('[data-browse-panel]')];
  if (!tabs.length || !panels.length) return;
  const activate = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.browseTab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    panels.forEach((panel) => {
      const active = panel.dataset.browsePanel === name;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    localStorage.setItem('madrador:browse-tab', name);
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.browseTab)));
  const saved = localStorage.getItem('madrador:browse-tab');
  activate(tabs.some((tab) => tab.dataset.browseTab === saved) ? saved : 'genres');
}

function openFilteredCatalog(label, group) {
  const url = new URL('./catalog.html', location.href);
  const value = String(label || '').trim();

  url.searchParams.set('type', 'all');

  if (group === 'genreFilters') {
    url.searchParams.set('genre', value);
  } else if (group === 'languageFilters') {
    url.searchParams.set('lang', value);
  } else if (group === 'collectionFilters') {
    const match = value.match(/^(Films|Séries)\s+(\d{4})$/i);
    if (match) {
      url.searchParams.set('type', match[1].toLowerCase().startsWith('s') ? 'series' : 'movies');
      url.searchParams.set('year', match[2]);
    } else if (normalizeKey(value).includes('top imdb')) {
      url.searchParams.delete('type');
      url.searchParams.set('view', 'popular');
      url.searchParams.set('sort', 'quality');
    } else {
      url.searchParams.set('q', value);
    }
  } else if (group === 'themeFilters') {
    const themeGenres = {
      animation: 'Animation',
      'super heros': 'Action',
      famille: 'Famille',
      epouvante: 'Horreur',
      manga: 'Animation',
      guerre: 'Guerre',
      suspense: 'Thriller'
    };
    const mappedGenre = themeGenres[normalizeKey(value)];
    if (mappedGenre) url.searchParams.set('genre', mappedGenre);
    else url.searchParams.set('q', value);
  } else {
    url.searchParams.set('q', value);
  }

  location.href = `${url.pathname}${url.search}`;
}

function showLoading(show) {
  loading.classList.toggle('hidden', !show);
  rows.classList.toggle('is-loading', show);
}

function showApiStatus(title, message) {
  const status = $('apiStatus');
  if (!status) return;

  $('apiStatusTitle').textContent = title;
  $('apiStatusText').textContent = message;
  status.classList.remove('hidden');
}

function hideApiStatus() {
  $('apiStatus')?.classList.add('hidden');
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.add('hidden'), 2200);
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return location.protocol + url;
  return url;
}

function cleanRepeatedTitle(value) {
  const title = String(value || '').replace(/\\'/g, "'").replace(/\s+/g, ' ').trim();
  if (title.length % 2 === 0) {
    const half = title.length / 2;
    if (title.slice(0, half).toLowerCase() === title.slice(half).toLowerCase()) return title.slice(0, half).trim();
  }
  return title;
}

function cssUrl(url) {
  return String(url).replace(/"/g, '\\"');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function bindImageFallback(root) {
  root.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => replaceBrokenImage(img), { once: true });
  });
}

function replaceBrokenImage(img) {
  const fallback = document.createElement('div');
  fallback.className = 'no-poster image-fallback';
  fallback.innerHTML = '<i class="fa-solid fa-film"></i>';
  img.replaceWith(fallback);
}
