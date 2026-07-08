const ITEMS_PER_PAGE = 24;
const CATALOG_FAST_LIMIT = 4;
const CATALOG_ALL_LIMIT = 80;
const params = new URLSearchParams(location.search);

let catalogType = params.get('type') || 'all';
let catalogView = params.get('view') || '';
let catalogPage = 1;
let catalogItems = [];
let visibleCatalogItems = [];
let renderedCount = ITEMS_PER_PAGE;
let allCatalogCache = {};
let isCatalogLoading = false;
let searchTimer = null;
let suggestTimer = null;
let catalogSuggestIndex = -1;
let catalogSuggestToken = 0;
let catalogSuggestionItems = [];
let catalogViewMode = localStorage.getItem('madrador:catalog-view') || 'grid';

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  hydrateCatalog();
  bindCatalog();
  loadCatalog();
});

function hydrateCatalog() {
  if (hasExplicitCatalogNavigation()) {
    clearSavedCatalogFilters();
  } else {
    restoreCatalogFilters();
  }
  $('catalogType').value = ['movies', 'series'].includes(catalogType) ? catalogType : 'all';
  applyCatalogParams();
  document.body.dataset.catalog = catalogType;
  setActiveChrome();
  updateTitle();
  $('catalogLoading').innerHTML = Array.from({ length: ITEMS_PER_PAGE }, () => '<div class="skeleton-card"></div>').join('');
  applyCatalogViewMode();
}

function hasExplicitCatalogNavigation() {
  return ['type', 'view', 'q', 'genre', 'lang', 'quality', 'year', 'sort'].some((key) => params.has(key));
}

function applyCatalogParams() {
  const mappings = [
    ['q', 'catalogSearch'],
    ['genre', 'catalogGenre'],
    ['lang', 'catalogLang'],
    ['quality', 'catalogQuality'],
    ['year', 'catalogYear'],
    ['sort', 'catalogSort']
  ];

  mappings.forEach(([param, id]) => {
    const value = params.get(param);
    if (value !== null && $(id)) setSelectOrInputValue($(id), value);
  });

  const type = params.get('type');
  if (type && $('catalogType')) {
    catalogType = ['movies', 'series', 'all'].includes(type) ? type : 'all';
    $('catalogType').value = catalogType;
  }
}

function setSelectOrInputValue(node, value) {
  if (!node) return;
  if (node.tagName === 'SELECT') {
    const normalized = normalizeKey(value);
    const option = Array.from(node.options).find((item) => normalizeKey(item.value || item.textContent) === normalized);
    node.value = option ? option.value : '';
    return;
  }
  node.value = value;
}

function clearSavedCatalogFilters() {
  localStorage.removeItem('madrador:catalog-filters');
}

function bindCatalog() {
  $('mobileMenu').addEventListener('click', () => $('sidebar').classList.toggle('open'));
  $('filterToggle')?.addEventListener('click', () => document.body.classList.add('filters-open'));
  $('filterClose')?.addEventListener('click', () => document.body.classList.remove('filters-open'));
  ['catalogType', 'catalogGenre', 'catalogLang', 'catalogQuality', 'catalogYear', 'catalogSort'].forEach((id) => {
    $(id).addEventListener('change', () => {
      catalogType = $('catalogType').value;
      if (!isLocalView()) catalogView = '';
      catalogPage = 1;
      saveCatalogFilters();
      updateUrl();
      document.body.classList.remove('filters-open');
      loadCatalog();
    });
  });
  $('catalogSearch').addEventListener('input', () => {
    renderCatalogSearchLoading(true);
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(renderCatalogSuggestions, 120);
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      catalogPage = 1;
      saveCatalogFilters();
      loadCatalog();
    }, 250);
  });
  $('catalogSearch').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveCatalogSuggestion(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveCatalogSuggestion(-1);
      return;
    }
    if (event.key === 'Escape') {
      hideCatalogSuggestions();
      return;
    }
    if (event.key === 'Enter') {
      const active = getActiveCatalogSuggestion();
      if (active) {
        event.preventDefault();
        chooseCatalogSuggestion(active);
        return;
      }
      loadCatalog();
    }
  });
  $('catalogSearch').addEventListener('focus', renderCatalogSuggestions);
  document.addEventListener('click', (event) => {
    if (!$('catalogSearch')?.closest('.catalog-search')?.contains(event.target)) {
      hideCatalogSuggestions();
    }
  });
  $('catalogClear').addEventListener('click', () => {
    $('catalogSearch').value = '';
    catalogPage = 1;
    saveCatalogFilters();
    hideCatalogSuggestions();
    loadCatalog();
  });
  $('catalogReset').addEventListener('click', () => {
    $('catalogSearch').value = '';
    $('catalogGenre').value = '';
    $('catalogLang').value = '';
    $('catalogQuality').value = '';
    $('catalogYear').value = '';
    $('catalogSort').value = 'new';
    if (!isLocalView()) catalogView = '';
    catalogPage = 1;
    saveCatalogFilters();
    updateUrl();
    document.body.classList.remove('filters-open');
    loadCatalog();
  });
  $('catalogPrev').addEventListener('click', () => changePage(-1));
  $('catalogNext').addEventListener('click', () => changePage(1));
  $('catalogViewToggle').addEventListener('click', toggleCatalogView);
  $('catalogClearLocal').addEventListener('click', clearLocalView);
  $('scrollTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  $('catalogRetry')?.addEventListener('click', () => {
    hideCatalogApiStatus();
    loadCatalog();
  });
  window.addEventListener('scroll', handleInfiniteCatalogScroll, { passive: true });
}

async function loadCatalog() {
  updateTitle();
  hideCatalogApiStatus();
  setLoading(true);
  isCatalogLoading = true;

  try {
    const q = $('catalogSearch').value.trim();
    let items = await getCatalogItems(q);
    items = applyFilters(items);
    items = sortItems(items);
    catalogItems = items;
    visibleCatalogItems = dedupeMediaItems(catalogItems);
    renderedCount = ITEMS_PER_PAGE;
    renderCatalog();
    hydrateCatalogInBackground(q);
  } catch (err) {
    console.error(err);
    catalogItems = [];
    renderCatalog();
    showCatalogApiStatus(
      'Catalogue indisponible',
      isLocalView()
        ? 'Les données locales sont lisibles, mais le catalogue distant ne répond pas pour compléter cette vue.'
        : 'Impossible de joindre les routes du catalogue. Vérifie le serveur local puis réessaie.'
    );
  } finally {
    isCatalogLoading = false;
    setLoading(false);
  }
}

async function hydrateCatalogInBackground(query) {
  if (query || isLocalView()) return;

  try {
    const before = visibleCatalogItems.length;
    let items = await fetchCatalogPages(CATALOG_ALL_LIMIT, true);
    items = applyFilters(items);
    items = sortItems(items);
    const nextVisible = dedupeMediaItems(items);
    if (nextVisible.length > before) {
      catalogItems = items;
      visibleCatalogItems = nextVisible;
      renderCatalog();
    }
  } catch (error) {
    console.warn('Catalogue large indisponible en arrière-plan.', error);
  }
}

async function getCatalogItems(query) {
  if (catalogView === 'favorites') return filterLocalItems(MadradorStorage.favorites(), query);
  if (catalogView === 'history') return filterLocalItems(MadradorStorage.history(), query);
  if (query) return searchCatalog(query);
  const items = await fetchCatalogPages(CATALOG_FAST_LIMIT);
  if (catalogView === 'popular') return getPopularItems(items);
  if (catalogView === 'new') return items;
  return items;
}

function filterLocalItems(items, query) {
  if (!query) return items;
  const q = normalizeKey(query);
  return items.filter((item) => normalizeKey(`${item.title || ''} ${item.originalTitle || ''}`).includes(q));
}

async function fetchCatalogPages(limit = CATALOG_FAST_LIMIT, forceRefresh = false) {
  const jobs = [];
  if (catalogType === 'movies' || catalogType === 'all') {
    jobs.push(fetchCatalogAll('movies', limit, forceRefresh));
  }
  if (catalogType === 'series' || catalogType === 'all') {
    jobs.push(fetchCatalogAll('series', limit, forceRefresh));
  }
  const results = await Promise.all(jobs);
  const raw = results.flatMap((data) => data.items || []);
  const fallback = catalogType === 'series' ? 'series' : catalogType === 'movies' ? 'movies' : 'movies';
  const normalized = normalizeItems(raw, fallback);
  return catalogType === 'all' ? groupSeries(normalized) : groupSeries(normalized.filter((item) => item.type === catalogType));
}

async function searchCatalog(query) {
  const q = normalizeKey(query);
  const localItems = await fetchCatalogPages(CATALOG_ALL_LIMIT);
  const localMatches = localItems.filter((item) => normalizeKey(`${item.title || ''} ${item.originalTitle || ''} ${item.year || ''} ${item.version || ''} ${item.quality || ''}`).includes(q));
  if (localMatches.length) return localMatches;

  const data = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
  const normalized = normalizeItems(data.items || [], 'movies');
  const filtered = catalogType === 'all' ? normalized : normalized.filter((item) => item.type === catalogType);
  return groupSeries(filtered);
}

function applyFilters(items) {
  const genre = normalizeKey($('catalogGenre').value);
  const lang = normalizeKey($('catalogLang').value);
  const quality = normalizeKey($('catalogQuality').value);
  const year = $('catalogYear').value;

  return items.filter((item) => {
    const hay = normalizeKey(`${item.title} ${item.originalTitle || ''}`);
    const version = normalizeKey(item.version || '');
    const itemQuality = normalizeKey(item.quality || '');
    if (catalogType !== 'all' && item.type !== catalogType) return false;
    if (genre && !hay.includes(genre)) return false;
    if (lang && !version.includes(lang)) return false;
    if (quality && !itemQuality.includes(quality)) return false;
    if (year && String(item.year || '').trim() !== year && !hay.includes(year)) return false;
    return true;
  });
}

function sortItems(items) {
  const sort = $('catalogSort').value;
  const copy = [...items];
  if (sort === 'az') copy.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'za') copy.sort((a, b) => b.title.localeCompare(a.title));
  if (sort === 'quality') copy.sort((a, b) => String(b.quality).localeCompare(String(a.quality)));
  return copy;
}

function renderCatalog() {
  const grid = $('catalogGrid');
  grid.innerHTML = '';
  applyCatalogViewMode();
  renderActiveFilters();
  visibleCatalogItems = dedupeMediaItems(catalogItems);
  const total = visibleCatalogItems.length;
  const itemsToRender = visibleCatalogItems.slice(0, renderedCount);

  itemsToRender.forEach((item, index) => {
    grid.appendChild(createCard(item, index));
  });

  if (!total) {
    grid.innerHTML = getEmptyState();
  }

  $('catalogCount').textContent = getCatalogCountLabel(total);
  $('catalogPage').textContent = total
    ? `${Math.min(renderedCount, total)} / ${total} affichés`
    : '0 résultat';
  $('catalogPrev').disabled = renderedCount <= ITEMS_PER_PAGE || isLocalView();
  $('catalogNext').disabled = renderedCount >= total || isLocalView();
  $('catalogNext').querySelector('span').textContent = renderedCount >= total ? 'Tout affiché' : 'Afficher plus';
  $('catalogPrev').querySelector('span').textContent = 'Afficher moins';
  $('catalogClearLocal').classList.toggle('hidden', !isLocalView() || !total);
  document.querySelectorAll('[data-local-remove]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      removeLocalItem(button.dataset.localRemove);
    });
  });
}

function getCatalogCountLabel(total) {
  if (catalogType === 'movies') return `${total} film${total > 1 ? 's' : ''}`;
  if (catalogType === 'series') return `${total} série${total > 1 ? 's' : ''}`;
  return `${total} titre${total > 1 ? 's' : ''}`;
}

function renderActiveFilters() {
  const box = $('activeFilters');
  if (!box) return;

  const filters = getActiveFilterList();
  box.classList.toggle('hidden', !filters.length);
  if (!filters.length) {
    box.innerHTML = '';
    return;
  }

  box.innerHTML = `
    <span><i class="fa-solid fa-sliders"></i> Filtres actifs</span>
    ${filters.map((filter) => `
      <button type="button" data-clear-filter="${escapeHtml(filter.id)}">
        ${escapeHtml(filter.label)}
        <i class="fa-solid fa-xmark"></i>
      </button>
    `).join('')}
  `;

  box.querySelectorAll('[data-clear-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      clearSingleFilter(button.dataset.clearFilter);
    });
  });
}

function getActiveFilterList() {
  const filters = [];
  const search = $('catalogSearch').value.trim();
  if (search) filters.push({ id: 'catalogSearch', label: `Recherche : ${search}` });

  [
    ['catalogType', 'Type'],
    ['catalogGenre', 'Genre'],
    ['catalogLang', 'Version'],
    ['catalogQuality', 'Qualité'],
    ['catalogYear', 'Année']
  ].forEach(([id, label]) => {
    const value = $(id)?.value || '';
    if (value && !(id === 'catalogType' && value === 'all')) filters.push({ id, label: `${label} : ${getFilterLabel(id, value)}` });
  });

  const sort = $('catalogSort').value;
  if (sort && sort !== 'new') {
    const option = $('catalogSort').selectedOptions?.[0]?.textContent || sort;
    filters.push({ id: 'catalogSort', label: `Tri : ${option}` });
  }

  return filters;
}

function getFilterLabel(id, value) {
  if (id === 'catalogType') {
    return {
      movies: 'Films',
      series: 'Séries',
      all: 'Films + Séries'
    }[value] || value;
  }
  return value;
}

function clearSingleFilter(id) {
  if (id === 'catalogSearch') {
    $('catalogSearch').value = '';
    hideCatalogSuggestions();
  }
  else if (id === 'catalogType') {
    $('catalogType').value = 'all';
    catalogType = 'all';
    if (!isLocalView()) catalogView = '';
  } else if (id === 'catalogSort') {
    $('catalogSort').value = 'new';
  } else if ($(id)) {
    $(id).value = '';
  }

  catalogPage = 1;
  renderedCount = ITEMS_PER_PAGE;
  saveCatalogFilters();
  updateUrl();
  loadCatalog();
}

async function renderCatalogSuggestions() {
  const input = $('catalogSearch');
  const box = $('catalogSuggest');
  if (!input || !box) return;

  const query = input.value.trim();
  catalogSuggestIndex = -1;
  catalogSuggestionItems = [];

  if (!query) {
    renderCatalogSearchLoading(false);
    hideCatalogSuggestions();
    return;
  }

  const token = ++catalogSuggestToken;
  renderCatalogSuggestionState('Recherche dans le catalogue...');

  try {
    const localPool = await fetchCatalogPages();
    if (token !== catalogSuggestToken) return;

    const localMatches = getCatalogSuggestionMatches(localPool, query).slice(0, 7);
    catalogSuggestionItems = localMatches;

    if (localMatches.length) {
      box.innerHTML = getCatalogSuggestionMarkup('Résultats du catalogue', localMatches);
      bindCatalogSuggestionButtons();
      box.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      renderCatalogSearchLoading(false);
      return;
    }

    renderCatalogSuggestionState('Recherche en ligne...');
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
    if (token !== catalogSuggestToken) return;

    const backendMatches = getCatalogSuggestionMatches(normalizeItems(data.items || [], 'movies'), query).slice(0, 7);
    catalogSuggestionItems = backendMatches;

    if (!backendMatches.length) {
      renderCatalogSuggestionState('Aucun résultat trouvé', 'empty');
      return;
    }

    box.innerHTML = getCatalogSuggestionMarkup('Recherche en ligne', backendMatches);
    bindCatalogSuggestionButtons();
    box.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  } catch (error) {
    console.warn('Suggestions catalogue indisponibles.', error);
    renderCatalogSuggestionState('Aucun résultat trouvé', 'empty');
  } finally {
    if (token === catalogSuggestToken) renderCatalogSearchLoading(false);
  }
}

function getCatalogSuggestionMatches(items, query) {
  const q = normalizeKey(query);
  const filtered = (items || []).filter((item) => {
    if (catalogType !== 'all' && item.type !== catalogType) return false;
    return normalizeKey(`${item.title || ''} ${item.originalTitle || ''} ${item.year || ''} ${item.quality || ''} ${item.version || ''}`).includes(q);
  });
  return dedupeMediaItems(filtered);
}

function getCatalogSuggestionMarkup(title, items) {
  return `
    <div class="suggest-group">
      <span>${escapeHtml(title)}</span>
      ${items.map((item) => {
        const displayTitle = getDisplayTitle(item);
        const image = item.poster || item.backdrop;
        const type = item.type === 'series' ? 'Série' : 'Film';
        const meta = [type, item.year, item.quality || 'HD', item.version || 'VF'].filter(Boolean).join(' • ');
        return `
          <button type="button" class="suggest-item rich-suggest-item" data-catalog-suggest="${escapeHtml(item.id)}">
            <span class="suggest-cover">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="fa-solid fa-film"></i>'}</span>
            <span class="suggest-copy">
              <b>${escapeHtml(displayTitle)}</b>
              <small>${escapeHtml(meta)}</small>
            </span>
            <span class="suggest-pill">${escapeHtml(type)}</span>
          </button>`;
      }).join('')}
    </div>`;
}

function renderCatalogSuggestionState(message, state = 'loading') {
  const box = $('catalogSuggest');
  if (!box) return;
  box.innerHTML = `
    <div class="suggest-state ${state}">
      <span class="${state === 'loading' ? 'search-loader' : ''}"></span>
      <b>${escapeHtml(message)}</b>
    </div>`;
  box.classList.remove('hidden');
  $('catalogSearch')?.setAttribute('aria-expanded', 'true');
  renderCatalogSearchLoading(state === 'loading');
}

function bindCatalogSuggestionButtons() {
  const box = $('catalogSuggest');
  box?.querySelectorAll('[data-catalog-suggest]').forEach((button) => {
    button.addEventListener('click', () => chooseCatalogSuggestion(button));
  });
  bindImageFallback(box);
}

function moveCatalogSuggestion(direction) {
  const box = $('catalogSuggest');
  const items = [...(box?.querySelectorAll('.suggest-item') || [])];
  if (!items.length) return;
  box.classList.remove('hidden');
  catalogSuggestIndex = (catalogSuggestIndex + direction + items.length) % items.length;
  items.forEach((item, index) => item.classList.toggle('active', index === catalogSuggestIndex));
  items[catalogSuggestIndex].scrollIntoView({ block: 'nearest' });
}

function getActiveCatalogSuggestion() {
  return $('catalogSuggest')?.querySelector('.suggest-item.active');
}

function chooseCatalogSuggestion(button) {
  const item = catalogSuggestionItems.find((entry) => String(entry.id) === String(button.dataset.catalogSuggest));
  if (!item) return;
  hideCatalogSuggestions();
  openDetails(item);
}

function hideCatalogSuggestions() {
  const box = $('catalogSuggest');
  if (!box) return;
  box.classList.add('hidden');
  $('catalogSearch')?.setAttribute('aria-expanded', 'false');
  catalogSuggestIndex = -1;
  renderCatalogSearchLoading(false);
}

function renderCatalogSearchLoading(show) {
  $('catalogSearchLoader')?.classList.toggle('hidden', !show);
}

function dedupeMediaItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = item.type === 'series'
      ? `series:${normalizeKey(item.seriesTitle || item.title)}`
      : `movie:${item.id || normalizeKey(item.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createCard(item, index) {
  const card = document.createElement('article');
  const displayTitle = getDisplayTitle(item);
  const image = item.poster || item.backdrop;
  const progress = getProgressLabel(item);
  const dateLabel = getLocalDateLabel(item);
  card.className = 'media-card media-card-poster';
  card.style.animationDelay = `${Math.min(index * 18, 420)}ms`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Ouvrir ${displayTitle}`);
  card.addEventListener('click', () => openDetails(item));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') openDetails(item);
  });
  card.innerHTML = `
    <div class="media-thumb">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(displayTitle)}" loading="lazy">` : '<div class="no-poster"><i class="fa-solid fa-film"></i></div>'}
      <div class="media-fade"></div>
      <div class="media-badges">
        <span>${item.type === 'series' ? 'Série' : 'Film'}</span>
        <span>${escapeHtml(item.quality || 'HD')}</span>
        ${item.version ? `<span>${escapeHtml(item.version)}</span>` : ''}
      </div>
      <div class="media-actions">
        <button type="button" class="media-action primary-action" data-play><i class="fa-solid fa-play"></i></button>
        <button type="button" class="media-action" data-fav><i class="${MadradorStorage.isFavorite(item.id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i></button>
        ${isLocalView() ? '<button type="button" class="media-action" data-local-remove="' + escapeHtml(item.id) + '"><i class="fa-solid fa-xmark"></i></button>' : ''}
      </div>
      <h3>${escapeHtml(displayTitle)}</h3>
      ${dateLabel ? `<div class="local-date">${escapeHtml(dateLabel)}</div>` : ''}
      ${progress ? `<div class="watch-progress"><span style="width:${progress.percent}%"></span><small>${escapeHtml(progress.label)}</small></div>` : ''}
    </div>`;
  bindImageFallback(card);
  card.querySelector('[data-play]').addEventListener('click', (event) => {
    event.stopPropagation();
    openPlayer(item);
  });
  card.querySelector('[data-fav]').addEventListener('click', (event) => {
    event.stopPropagation();
    if (MadradorStorage.isFavorite(item.id)) MadradorStorage.removeFavorite(item.id);
    else MadradorStorage.addFavorite(item);
    event.currentTarget.innerHTML = `<i class="${MadradorStorage.isFavorite(item.id) ? 'fa-solid' : 'fa-regular'} fa-heart"></i>`;
  });
  return card;
}

function getDisplayTitle(item) {
  if (!item) return 'Sans titre';
  if (item.type === 'series' || item.seriesTitle || item.season || item.episode) {
    return parseSeasonTitle(item.seriesTitle || item.title || '').baseTitle || item.seriesTitle || item.title;
  }
  return item.title || 'Sans titre';
}

function clearLocalView() {
  if (catalogView === 'favorites') MadradorStorage.clearFavorites();
  if (catalogView === 'history') MadradorStorage.clearHistory();
  loadCatalog();
}

function changePage(direction) {
  if (direction > 0) {
    showMoreCatalogItems();
    return;
  }
  renderedCount = Math.max(ITEMS_PER_PAGE, renderedCount - ITEMS_PER_PAGE);
  renderCatalog();
  window.scrollTo({ top: Math.max(0, document.documentElement.scrollTop - 520), behavior: 'smooth' });
}

function updateTitle() {
  const labels = {
    favorites: 'Ma liste',
    history: 'Historique',
    popular: 'Populaires',
    new: 'Nouveautés'
  };
  const label = labels[catalogView] || (catalogType === 'series' ? 'Séries' : catalogType === 'movies' ? 'Films' : 'Films et séries');
  $('catalogTitle').textContent = label;
  $('catalogSubtitle').textContent = getSubtitle();
  document.title = `${label} - Madrador TV`;
  setActiveChrome();
}

function updateUrl() {
  const url = new URL(location.href);
  if (catalogView) {
    url.searchParams.delete('type');
    url.searchParams.set('view', catalogView);
  } else {
    url.searchParams.delete('view');
    url.searchParams.set('type', catalogType);
  }
  url.searchParams.delete('page');
  syncFilterParams(url);
  history.replaceState(null, '', url);
}

function syncFilterParams(url) {
  const values = {
    q: $('catalogSearch')?.value.trim() || '',
    genre: $('catalogGenre')?.value || '',
    lang: $('catalogLang')?.value || '',
    quality: $('catalogQuality')?.value || '',
    year: $('catalogYear')?.value || '',
    sort: $('catalogSort')?.value === 'new' ? '' : $('catalogSort')?.value || ''
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  });
}

function setActiveChrome() {
  const activeMap = {
    catalogMoviesNav: !catalogView && catalogType === 'movies',
    catalogSeriesNav: !catalogView && catalogType === 'series',
    catalogNewNav: catalogView === 'new',
    catalogPopularNav: catalogView === 'popular',
    catalogFavoritesNav: catalogView === 'favorites',
    catalogHistoryNav: catalogView === 'history',
    quickAll: !catalogView && catalogType === 'all',
    quickMovies: !catalogView && catalogType === 'movies',
    quickSeries: !catalogView && catalogType === 'series',
    quickNew: catalogView === 'new',
    quickPopular: catalogView === 'popular',
    quickFavorites: catalogView === 'favorites',
    quickHistory: catalogView === 'history'
  };
  Object.entries(activeMap).forEach(([id, active]) => {
    const node = $(id);
    if (node) node.classList.toggle('active', active);
  });
  document.querySelector('.catalog-filters')?.classList.toggle('is-local-view', isLocalView());
  document.body.classList.toggle('catalog-local-view', isLocalView());
}

function restoreCatalogFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem('madrador:catalog-filters') || '{}');
    ['catalogGenre', 'catalogLang', 'catalogQuality', 'catalogYear', 'catalogSort'].forEach((id) => {
      if (saved[id] !== undefined && $(id)) $(id).value = saved[id];
    });
    if (saved.catalogSearch && $('catalogSearch')) $('catalogSearch').value = saved.catalogSearch;
  } catch (err) {
    localStorage.removeItem('madrador:catalog-filters');
  }
}

function saveCatalogFilters() {
  const saved = {};
  ['catalogGenre', 'catalogLang', 'catalogQuality', 'catalogYear', 'catalogSort', 'catalogSearch'].forEach((id) => {
    if ($(id)) saved[id] = $(id).value;
  });
  localStorage.setItem('madrador:catalog-filters', JSON.stringify(saved));
}

function toggleCatalogView() {
  catalogViewMode = catalogViewMode === 'grid' ? 'list' : 'grid';
  localStorage.setItem('madrador:catalog-view', catalogViewMode);
  applyCatalogViewMode();
}

function applyCatalogViewMode() {
  const list = catalogViewMode === 'list';
  $('catalogGrid')?.classList.toggle('catalog-list-view', list);
  if ($('catalogViewToggle')) {
    $('catalogViewToggle').innerHTML = list
      ? '<i class="fa-solid fa-table-cells-large"></i><span>Vue grille</span>'
      : '<i class="fa-solid fa-list"></i><span>Vue liste</span>';
  }
}

function getSubtitle() {
  if (catalogView === 'favorites') return 'Tous les titres sauvegardés localement dans Ma liste.';
  if (catalogView === 'history') return 'Tes derniers contenus ouverts, prêts à reprendre.';
  if (catalogView === 'popular') return 'Une sélection dynamique basée sur le catalogue chargé.';
  if (catalogView === 'new') return 'Les derniers titres disponibles dans le catalogue.';
  return 'Recherche, filtre et trie les films et séries sans mélanger les catalogues.';
}

function isLocalView() {
  return catalogView === 'favorites' || catalogView === 'history';
}

async function fetchCatalogAll(kind, limit = CATALOG_FAST_LIMIT, forceRefresh = false) {
  const cacheKey = `${kind}:${limit}`;
  if (!forceRefresh && allCatalogCache[cacheKey]) return allCatalogCache[cacheKey];

  const allEndpoint = `/api/${kind}/all?limit=${limit}`;
  const cleanEndpoint = kind === 'movies'
    ? `/api/film/all?limit=${limit}`
    : `/api/serie/all?limit=${limit}`;
  try {
    const data = await fetchJson(cleanEndpoint, 1000 * 60 * 30);
    allCatalogCache[cacheKey] = data;
    return data;
  } catch (error) {
    console.warn(`[CATALOG] ${cleanEndpoint} indisponible, fallback legacy.`, error);
    const legacyData = await fetchJson(allEndpoint, 1000 * 60 * 30).catch(() => null);
    if (legacyData?.items) {
      allCatalogCache[cacheKey] = legacyData;
      return legacyData;
    }
    const fallback = await fetchJson(kind === 'movies' ? '/api/movies?page=1' : '/api/series?page=1');
    allCatalogCache[cacheKey] = {
      type: kind === 'series' ? 'series' : 'movie',
      total: (fallback.items || []).length,
      items: fallback.items || [],
      fallback: true
    };
    return allCatalogCache[cacheKey];
  }
}

function showMoreCatalogItems() {
  const total = visibleCatalogItems.length;
  if (renderedCount >= total) return;
  renderedCount = Math.min(total, renderedCount + ITEMS_PER_PAGE);
  renderCatalog();
}

function handleInfiniteCatalogScroll() {
  if (isCatalogLoading || isLocalView()) return;
  if (!visibleCatalogItems.length || renderedCount >= visibleCatalogItems.length) return;
  const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 700;
  if (nearBottom) showMoreCatalogItems();
}

function getPopularItems(items) {
  if (!items.length) return [];
  const scored = items.map((item, index) => ({
    item,
    score: (MadradorStorage.isFavorite(item.id) ? 40 : 0)
      + (item.type === 'series' ? 8 : 0)
      + (String(item.quality || '').toLowerCase().includes('hd') ? 6 : 0)
      + ((items.length - index) % 11)
  }));
  return scored.sort((a, b) => b.score - a.score).map((entry) => entry.item);
}

function getProgressLabel(item) {
  if (!item?.updatedAt && !item?.episode && !item?.lastSource) return null;
  const percent = item.episode ? Math.min(94, 20 + (Number(item.episode) * 6)) : 46;
  const parts = [];
  if (item.season) parts.push(`S${item.season}`);
  if (item.episode) parts.push(`E${item.episode}`);
  if (item.lastSource) parts.push(String(item.lastSource).toUpperCase());
  return { percent, label: parts.length ? parts.join(' • ') : 'Reprendre' };
}

function getLocalDateLabel(item) {
  if (!isLocalView()) return '';
  const value = item.updatedAt || item.savedAt;
  if (!value) return catalogView === 'favorites' ? 'Ajouté localement' : 'Ouvert récemment';
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  } catch (err) {
    return '';
  }
}

function getEmptyState() {
  const data = {
    favorites: ['fa-heart', 'Ma liste est vide', 'Ajoute un film ou une série avec le bouton coeur.', './catalog.html?type=all', 'Explorer'],
    history: ['fa-clock-rotate-left', 'Aucun historique', 'Ouvre un contenu pour le retrouver ici.', './catalog.html?type=all', 'Explorer'],
    popular: ['fa-fire', 'Populaires indisponibles', 'Actualise ou réessaie quand le catalogue répond.', './index.html', 'Accueil'],
    new: ['fa-plus', 'Aucune nouveauté', 'Le catalogue ne renvoie rien pour le moment.', './index.html', 'Accueil']
  };
  const state = data[catalogView] || ['fa-circle-info', 'Aucun résultat', 'Essaie un autre filtre ou une autre recherche.', './catalog.html?type=all', 'Tout voir'];
  return `
    <section class="local-panel rich-empty">
      <i class="fa-solid ${state[0]}"></i>
      <h2>${state[1]}</h2>
      <p>${state[2]}</p>
      <a class="btn primary" href="${state[3]}"><i class="fa-solid fa-arrow-right"></i><span>${state[4]}</span></a>
    </section>`;
}

function removeLocalItem(id) {
  if (catalogView === 'favorites') MadradorStorage.removeFavorite(id);
  if (catalogView === 'history') {
    const next = MadradorStorage.history().filter((item) => item.id !== id);
    localStorage.setItem(MadradorStorage.KEYS.history, JSON.stringify(next));
  }
  loadCatalog();
}

async function fetchJson(url, ttl = 1000 * 60 * 3) {
  const cacheKey = `madrador:cache:${url}`;
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Date.now() - cached.time < ttl) return cached.data;
  } catch (err) {
    localStorage.removeItem(cacheKey);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  const data = await res.json();
  localStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), data }));
  return data;
}

function normalizeItems(items, fallbackType) {
  return items.map((item) => {
    const title = item.title || item.name || 'Sans titre';
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
  const query = new URLSearchParams({ id: item.id, type: item.type === 'series' ? 'series' : 'movie' });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  location.href = `./details.html?${query.toString()}`;
}

function openPlayer(item) {
  const query = new URLSearchParams({ id: item.id, type: item.type === 'series' ? 'series' : 'movie' });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  location.href = `./player.html?${query.toString()}`;
}

function setLoading(show) {
  $('catalogLoading').classList.toggle('hidden', !show);
  $('catalogGrid').classList.toggle('hidden', show);
}

function showCatalogApiStatus(title, message) {
  const box = $('catalogApiStatus');
  if (!box) return;
  $('catalogApiTitle').textContent = title;
  $('catalogApiText').textContent = message;
  box.classList.remove('hidden');
}

function hideCatalogApiStatus() {
  $('catalogApiStatus')?.classList.add('hidden');
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return location.protocol + url;
  return url;
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
