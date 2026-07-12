const params = new URLSearchParams(location.search);
const ITEMS_PER_PAGE = 48;

let results = [];
let toastTimer = null;
let instantTimer = null;
let lastSearchTerm = '';
let localCatalog = [];
let lastFilteredItems = [];

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  $('searchLoading').innerHTML = Array.from({ length: 24 }, () => '<div class="skeleton-card"></div>').join('');
  bindSearch();
  renderQuickTerms();
  paintSearchInsights([]);
  warmSearchCatalog();
  const initial = params.get('q') || getSearchHistory()[0] || '';
  $('advancedQuery').value = initial;
  if (initial) runSearch();
  else renderEmpty('Lance une recherche', 'Tape un titre ou choisis une recherche rapide.');
});

function bindSearch() {
  $('mobileMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('advancedSubmit').addEventListener('click', runSearch);
  $('searchRetry')?.addEventListener('click', () => {
    hideSearchApiStatus();
    runSearch();
  });
  $('searchFilterToggle')?.addEventListener('click', () => document.body.classList.toggle('search-filters-open'));
  $('advancedQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runSearch();
  });
  $('advancedQuery').addEventListener('input', scheduleInstantSearch);
  document.querySelectorAll('[data-type-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      $('searchType').value = button.dataset.typeTab;
      syncTypeTabs();
      renderResults();
    });
  });
  ['searchType', 'searchLang', 'searchQuality', 'searchYear', 'searchSort', 'searchLocal'].forEach((id) => {
    $(id).addEventListener('change', () => {
      if (id === 'searchType') syncTypeTabs();
      renderResults();
    });
  });
  $('searchReset').addEventListener('click', () => {
    $('searchType').value = 'all';
    $('searchLang').value = '';
    $('searchQuality').value = '';
    $('searchYear').value = '';
    $('searchSort').value = 'relevance';
    $('searchLocal').value = '';
    syncTypeTabs();
    renderResults();
  });
  $('saveSearch').addEventListener('click', () => {
    const q = $('advancedQuery').value.trim();
    if (!q) return;
    saveSearchHistory(q);
    renderQuickTerms();
    showToast('Recherche mémorisée');
  });
  $('clearSearchHistory').addEventListener('click', () => {
    localStorage.removeItem('madrador:search-history');
    renderQuickTerms();
    showToast('Historique de recherche vidé');
  });
}

async function runSearch() {
  const q = $('advancedQuery').value.trim();
  if (!q) {
    renderEmpty('Recherche vide', 'Entre un mot-clé pour lancer la recherche.');
    return;
  }

  saveSearchHistory(q);
  lastSearchTerm = q;
  hideSearchApiStatus();
  setLoading(true);
  const localResults = searchLocalCatalog(q);

  try {
    const data = await cachedFetchJson(`/api/search?q=${encodeURIComponent(q)}`, `search:${q}`, 1000 * 60 * 3);
    const onlineResults = rankItemsForQuery(normalizeItems(data.items || [], 'movies'), q);
    results = groupSeries(dedupeMediaItems([
      ...localResults,
      ...onlineResults
    ]));
    renderResults();
    renderQuickTerms();
    const url = new URL(location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url);
  } catch (err) {
    console.error(err);
    results = groupSeries(localResults);
    if (results.length) {
      renderResults();
    } else {
      renderEmpty('Recherche impossible', 'Le backend ne répond pas pour cette recherche.');
    }
    showSearchApiStatus(
      results.length ? 'Résultats locaux affichés' : 'Recherche indisponible',
      results.length
        ? 'La recherche en ligne ne répond pas, mais les résultats du catalogue chargé restent utilisables.'
        : 'Impossible de joindre /api/search pour le moment. Vérifie le serveur local puis réessaie.'
    );
  } finally {
    setLoading(false);
  }
}

async function warmSearchCatalog() {
  try {
    const data = await cachedFetchJson('/api/catalog/bootstrap?limit=80', 'search:catalog:bootstrap:80', 1000 * 60 * 10);
    const movies = normalizeItems(data.movies?.items || [], 'movies');
    const series = normalizeItems(data.series?.items || [], 'series');
    localCatalog = groupSeries(dedupeMediaItems([...movies, ...series]));
    paintLocalCatalogState();
    if (!$('advancedQuery').value.trim()) {
      renderDiscovery();
    }
  } catch (err) {
    console.warn('Catalogue local recherche indisponible.', err);
    localCatalog = [];
    paintLocalCatalogState('Indisponible');
  }
}

function searchLocalCatalog(query) {
  if (!normalizeKey(query) || !localCatalog.length) return [];
  return rankItemsForQuery(localCatalog, query);
}

function rankItemsForQuery(items, query) {
  const needle = normalizeKey(query);
  const words = needle.split(/\s+/).filter((word) => word.length >= 3);
  return (items || []).map((item) => {
    const haystack = normalizeKey([
      item.title,
      item.originalTitle,
      item.seriesTitle,
      item.year,
      item.quality,
      item.version
    ].filter(Boolean).join(' '));
    const hayWords = haystack.split(/\s+/).filter(Boolean);
    let matchedWords = 0;
    const exact = haystack.includes(needle) ? 50 : 0;
    const score = words.reduce((total, word) => {
      if (hayWords.some((candidate) => candidate === word || candidate.startsWith(word))) {
        matchedWords += 1;
        return total + 12;
      }
      const fuzzy = getFuzzyWordScore(word, hayWords);
      if (fuzzy) matchedWords += 1;
      return total + fuzzy;
    }, exact);
    const minimumWords = words.length <= 1 ? 1 : Math.ceil(words.length / 2);
    return { item, score, valid: exact > 0 || matchedWords >= minimumWords };
  })
    .filter((entry) => entry.valid && entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}

function getFuzzyWordScore(word, candidates) {
  if (word.length < 4) return 0;
  const limit = word.length >= 8 ? 2 : 1;
  return candidates.some((candidate) => Math.abs(candidate.length - word.length) <= limit && levenshtein(word, candidate, limit) <= limit) ? 6 : 0;
}

function levenshtein(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function scheduleInstantSearch() {
  window.clearTimeout(instantTimer);
  const q = $('advancedQuery').value.trim();
  if (!q) {
    results = [];
    hideSearchApiStatus();
    renderEmpty('Lance une recherche', 'Tape un titre ou choisis une recherche rapide.');
    return;
  }
  if (q.length < 2) return;
  instantTimer = window.setTimeout(() => {
    if (q !== lastSearchTerm) runSearch();
  }, 420);
}

function renderResults() {
  let items = applyFilters(results);
  items = sortItems(items);
  lastFilteredItems = items;
  const grid = $('searchResults');
  grid.innerHTML = '';

  if (!items.length) {
    renderEmpty('Aucun résultat', 'Essaie un autre mot-clé ou enlève certains filtres.');
    paintSearchInsights([]);
    return;
  }

  hideSearchApiStatus();
  items.slice(0, ITEMS_PER_PAGE).forEach((item, index) => grid.appendChild(createCard(item, index)));
  $('resultCount').textContent = `${items.length} résultat${items.length > 1 ? 's' : ''}`;
  paintSearchInsights(items);
  syncTypeTabs();
}

function renderEmpty(title, message) {
  $('searchResults').innerHTML = `
    <section class="local-panel rich-empty">
      <i class="fa-solid fa-magnifying-glass"></i>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
      <a class="btn primary" href="./catalog.html?type=all"><i class="fa-solid fa-layer-group"></i><span>Voir le catalogue</span></a>
    </section>`;
  $('resultCount').textContent = '0 résultat';
  lastFilteredItems = [];
}

function renderDiscovery() {
  const quick = dedupeMediaItems([
    ...MadradorStorage.continueWatching(),
    ...MadradorStorage.favorites(),
    ...localCatalog.slice(0, 18)
  ]).slice(0, 24);

  if (!quick.length) {
    renderEmpty('Lance une recherche', 'Tape un titre ou choisis une recherche rapide.');
    return;
  }

  $('searchResults').innerHTML = '';
  quick.forEach((item, index) => $('searchResults').appendChild(createCard(item, index)));
  $('resultCount').textContent = `${quick.length} suggestion${quick.length > 1 ? 's' : ''}`;
  paintSearchInsights(quick);
}

function createCard(item, index) {
  const card = document.createElement('article');
  const image = item.poster || item.backdrop;
  card.className = 'media-card media-card-poster';
  card.style.animationDelay = `${Math.min(index * 16, 420)}ms`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Ouvrir ${item.title}`);
  card.addEventListener('click', () => openDetails(item));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openDetails(item);
  });
  card.innerHTML = `
    <div class="media-thumb">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" loading="lazy" data-media-id="${escapeHtml(item.id)}" data-media-type="${escapeHtml(item.type || 'movie')}" data-image-role="poster">` : '<div class="no-poster"><i class="fa-solid fa-film"></i></div>'}
      <div class="media-fade"></div>
      <div class="media-badges">
        <span>${item.type === 'series' ? 'Série' : 'Film'}</span>
        <span>${escapeHtml(item.quality || 'HD')}</span>
        ${item.version ? `<span>${escapeHtml(item.version)}</span>` : ''}
      </div>
      <div class="media-actions">
        <button type="button" class="media-action primary-action" data-play><i class="fa-solid fa-play"></i></button>
        <button type="button" class="media-action" data-info><i class="fa-solid fa-circle-info"></i></button>
        <button type="button" class="media-action" data-fav><i class="${MadradorStorage.isFavorite(item.id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
    </div>`;
  bindImageFallback(card);
  card.querySelector('[data-play]').addEventListener('click', (event) => {
    event.stopPropagation();
    openPlayer(item, true);
  });
  card.querySelector('[data-info]').addEventListener('click', (event) => {
    event.stopPropagation();
    openDetails(item);
  });
  card.querySelector('[data-fav]').addEventListener('click', (event) => {
    event.stopPropagation();
    if (MadradorStorage.isFavorite(item.id)) MadradorStorage.removeFavorite(item.id);
    else MadradorStorage.addFavorite(item);
    event.currentTarget.innerHTML = `<i class="${MadradorStorage.isFavorite(item.id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
  });
  return card;
}

function paintSearchInsights(items) {
  const list = items || lastFilteredItems || [];
  const movies = list.filter((item) => item.type === 'movies').length;
  const series = list.filter((item) => item.type === 'series').length;
  $('searchTotal').textContent = String(list.length);
  $('searchMovies').textContent = String(movies);
  $('searchSeries').textContent = String(series);
  paintLocalCatalogState();
}

function paintLocalCatalogState(forcedLabel = '') {
  const target = $('searchLocalState');
  if (!target) return;
  target.textContent = forcedLabel || (localCatalog.length ? `${localCatalog.length}` : 'Chargement');
}

function applyFilters(items) {
  const type = $('searchType').value;
  const lang = normalizeKey($('searchLang').value);
  const quality = normalizeKey($('searchQuality').value);
  const year = $('searchYear').value;
  const local = $('searchLocal').value;
  const continueIds = new Set(MadradorStorage.continueWatching().map((item) => String(item.id)));
  return items.filter((item) => {
    const hay = normalizeKey(`${item.title} ${item.originalTitle || ''}`);
    if (type !== 'all' && item.type !== type) return false;
    if (lang && !normalizeKey(item.version || '').includes(lang)) return false;
    if (quality && !normalizeKey(item.quality || '').includes(quality)) return false;
    if (year && String(item.year || '').trim() !== year && !hay.includes(year)) return false;
    if (local === 'favorites' && !MadradorStorage.isFavorite(item.id)) return false;
    if (local === 'started' && !continueIds.has(String(item.id))) return false;
    if (local === 'not-started' && continueIds.has(String(item.id))) return false;
    return true;
  });
}

function sortItems(items) {
  const sort = $('searchSort').value;
  const copy = [...items];
  if (sort === 'az') copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'za') copy.sort((a, b) => b.title.localeCompare(a.title));
  if (sort === 'quality') copy.sort((a, b) => String(b.quality).localeCompare(String(a.quality)));
  return copy;
}

function renderQuickTerms() {
  const terms = [...getSearchHistory(), 'Action', 'Horreur', 'Science-Fiction', '2026', 'Netflix'].slice(0, 10);
  $('quickTerms').innerHTML = terms.map((term) => `<button type="button" data-term="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join('');
  $('quickTerms').querySelectorAll('[data-term]').forEach((button) => {
    button.addEventListener('click', () => {
      $('advancedQuery').value = button.dataset.term;
      runSearch();
    });
  });
}

function syncTypeTabs() {
  const type = $('searchType').value;
  document.querySelectorAll('[data-type-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.typeTab === type);
  });
}

async function cachedFetchJson(url, cacheKey, ttl) {
  const key = `madrador:cache:${cacheKey}`;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.time < ttl) return cached.data;
  } catch (err) {
    localStorage.removeItem(key);
  }
  const data = await fetchJson(url);
  localStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
  return data;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

function normalizeItems(items, fallbackType) {
  return items.map((item) => {
    const title = cleanRepeatedTitle(item.title || item.name || 'Sans titre');
    const season = parseSeasonTitle(title);
    const type = inferType(item, fallbackType, season);
    return {
      id: item.id || item.newsId || item.newsid || '',
      title: season.baseTitle || title,
      originalTitle: title,
      poster: fixUrl(item.poster || item.image || item.img || ''),
      backdrop: fixUrl(item.backdrop || item.cover || ''),
      quality: item.quality || 'HD',
      version: item.version || 'VF',
      year: item.year || '',
      type,
      seasonNumber: season.seasonNumber,
      seriesTitle: season.baseTitle || title
    };
  }).filter((item) => item.id && item.title);
}

function inferType(item, fallbackType, season) {
  const raw = String(item.type || fallbackType || '').toLowerCase();
  if (item.isSeries === true || season.seasonNumber || raw.includes('series') || raw.includes('serie') || fallbackType === 'series') return 'series';
  return 'movies';
}

function groupSeries(items) {
  const groups = new Map();
  const movies = [];
  items.forEach((item) => {
    if (item.type !== 'series') {
      movies.push(item);
      return;
    }
    const key = normalizeKey(item.seriesTitle || item.title);
    if (!groups.has(key)) groups.set(key, { ...item, seasons: [] });
    groups.get(key).seasons.push({ id: item.id, number: item.seasonNumber || groups.get(key).seasons.length + 1 });
  });
  return [...movies, ...Array.from(groups.values()).map((group) => {
    group.seasons.sort((a, b) => Number(a.number) - Number(b.number));
    group.id = group.seasons[0]?.id || group.id;
    return group;
  })];
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
  if (type.includes('series') || type.includes('serie') || item?.seriesTitle || item?.seasonNumber) {
    return `series:${normalizeKey(item.seriesTitle || item.title || '')}`;
  }
  return `movie:${item?.id || normalizeKey(item?.title || '')}`;
}

function parseSeasonTitle(title) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim();
  const patterns = [
    /^(.*?)\s*[-–—:|]\s*(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
    /^(.*?)\s+(?:saison|season)\s*(\d{1,2})(?=\D|$)/i,
    /^(.*?)\s*[-–—:|]\s*S(\d{1,2})(?=\D|$)/i
  ];
  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match?.[1] && match?.[2]) return { baseTitle: match[1].trim(), seasonNumber: Number(match[2]) };
  }
  return { baseTitle: clean, seasonNumber: null };
}

function openDetails(item) {
  openPlayer(item, false);
}

function openPlayer(item, autoplay = false) {
  const query = new URLSearchParams({ id: item.id, type: item.type === 'series' ? 'series' : 'movie' });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  if (autoplay) query.set('autoplay', '1');
  location.href = `./player.html?${query.toString()}`;
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
  const next = [clean, ...getSearchHistory().filter((item) => normalizeKey(item) !== normalizeKey(clean))].slice(0, 10);
  localStorage.setItem('madrador:search-history', JSON.stringify(next));
}

function setLoading(show) {
  $('searchLoading').classList.toggle('hidden', !show);
  $('searchResults').classList.toggle('hidden', show);
}

function showSearchApiStatus(title, message) {
  const box = $('searchApiStatus');
  if (!box) return;
  $('searchApiTitle').textContent = title;
  $('searchApiText').textContent = message;
  box.classList.remove('hidden');
}

function hideSearchApiStatus() {
  $('searchApiStatus')?.classList.add('hidden');
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('toast').classList.add('hidden'), 1800);
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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

function escapeHtml(str) {
  return String(str || '').replace(/[&<>'"]/g, (char) => ({
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
