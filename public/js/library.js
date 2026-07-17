let libraryView = new URLSearchParams(location.search).get('view') || 'all';
let toastTimer = null;

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  bindLibrary();
  renderLibrary();
});

function bindLibrary() {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  document.querySelectorAll('[data-library-view]').forEach((button) => {
    button.addEventListener('click', () => {
      libraryView = button.dataset.libraryView;
      updateLibraryUrl(true);
      renderLibrary();
    });
  });
  $('librarySearch').addEventListener('input', renderLibrary);
  $('libraryType').addEventListener('change', renderLibrary);
  $('libraryClear').addEventListener('click', () => {
    $('librarySearch').value = '';
    renderLibrary();
  });
  $('libraryReset').addEventListener('click', () => {
    libraryView = 'all';
    $('librarySearch').value = '';
    $('libraryType').value = 'all';
    renderLibrary();
  });
  $('clearAllLibrary').addEventListener('click', () => {
    MadradorStorage.clearContinue();
    MadradorStorage.clearFavorites();
    MadradorStorage.clearHistory();
    renderLibrary();
    showToast('Bibliothèque locale vidée');
  });
  window.addEventListener('popstate', () => {
    libraryView = new URLSearchParams(location.search).get('view') || 'all';
    renderLibrary();
  });
}

function updateLibraryUrl(push) {
  const url = new URL(location.href);
  if (libraryView === 'all') url.searchParams.delete('view');
  else url.searchParams.set('view', libraryView);
  history[push ? 'pushState' : 'replaceState']({ view: libraryView }, '', url);
}

function getLibrarySets() {
  return {
    continue: normalizeStoredItems(MadradorStorage.continueWatching(), 'continue'),
    favorites: normalizeStoredItems(MadradorStorage.favorites(), 'favorites'),
    history: normalizeStoredItems(MadradorStorage.history(), 'history')
  };
}

function renderLibrary() {
  const sets = getLibrarySets();
  const all = dedupeLibraryItems([...sets.continue, ...sets.favorites, ...sets.history]);
  const source = libraryView === 'continue'
    ? sets.continue
    : libraryView === 'favorites'
      ? sets.favorites
      : libraryView === 'history'
        ? sets.history
        : all;

  const items = applyLibraryFilters(source);
  paintStats(sets, all);
  paintTabs();
  paintGrid(items);
}

function normalizeStoredItems(items, bucket) {
  return (items || []).map((item) => {
    const type = inferType(item);
    return {
      id: item.id || '',
      title: item.title || item.seriesTitle || 'Sans titre',
      seriesTitle: item.seriesTitle || item.title || '',
      poster: fixUrl(item.poster || item.backdrop || ''),
      backdrop: fixUrl(item.backdrop || item.poster || ''),
      quality: item.quality || 'HD',
      version: item.version || 'VF',
      year: item.year || '',
      type,
      bucket,
      updatedAt: item.updatedAt || item.savedAt || item.time || item.timestamp || '',
      season: item.season || item.lastSeason || '',
      episode: item.episode || item.lastEpisode || '',
      lastSource: item.lastSource || item.source || ''
    };
  }).filter((item) => item.id);
}

function applyLibraryFilters(items) {
  const q = normalizeKey($('librarySearch').value);
  const type = $('libraryType').value;
  return dedupeLibraryItems(items).filter((item) => {
    const hay = normalizeKey(`${item.title} ${item.seriesTitle} ${item.year} ${item.quality} ${item.version}`);
    if (q && !hay.includes(q)) return false;
    if (type !== 'all' && item.type !== type) return false;
    return true;
  });
}

function paintStats(sets, all) {
  $('statContinue').textContent = String(sets.continue.length);
  $('statFavorites').textContent = String(sets.favorites.length);
  $('statHistory').textContent = String(sets.history.length);
  $('statTotal').textContent = String(all.length);
}

function paintTabs() {
  document.querySelectorAll('[data-library-view]').forEach((button) => {
    button.classList.toggle('active', button.dataset.libraryView === libraryView);
  });
}

function paintGrid(items) {
  const grid = $('libraryGrid');
  grid.innerHTML = '';
  $('libraryCount').textContent = `${items.length} titre${items.length > 1 ? 's' : ''}`;

  if (!items.length) {
    grid.innerHTML = renderEmptyState();
    return;
  }

  if (libraryView === 'history') {
    const groups = groupHistoryByDate(items);
    groups.forEach((group) => {
      const heading = document.createElement('h2');
      heading.className = 'library-date-heading';
      heading.textContent = group.label;
      grid.appendChild(heading);
      group.items.forEach((item, index) => grid.appendChild(createLibraryCard(item, index)));
    });
    return;
  }

  items.forEach((item, index) => grid.appendChild(createLibraryCard(item, index)));
}

function groupHistoryByDate(items) {
  const order = ['Aujourd’hui', 'Hier', 'Cette semaine', 'Plus ancien'];
  const groups = new Map(order.map((label) => [label, []]));
  items.forEach((item) => groups.get(getHistoryDateLabel(item.updatedAt)).push(item));
  return order.map((label) => ({ label, items: groups.get(label) })).filter((group) => group.items.length);
}

function getHistoryDateLabel(value) {
  const date = new Date(Number(value) || value || 0);
  if (Number.isNaN(date.getTime())) return 'Plus ancien';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const days = Math.floor((today - target) / 86400000);
  if (days <= 0) return 'Aujourd’hui';
  if (days === 1) return 'Hier';
  if (days < 7) return 'Cette semaine';
  return 'Plus ancien';
}

function createLibraryCard(item, index) {
  const card = document.createElement('article');
  const label = getBucketLabel(item.bucket);
  card.className = 'media-card media-card-poster library-card';
  card.style.animationDelay = `${Math.min(index * 18, 440)}ms`;
  card.innerHTML = `
    <div class="media-thumb">
      ${item.poster ? `<img src="${escapeHtml(item.poster)}" alt="${escapeHtml(item.title)}" loading="lazy" data-media-id="${escapeHtml(item.id)}" data-media-type="${escapeHtml(item.type || 'movie')}" data-image-role="poster">` : '<div class="no-poster"><i class="fa-solid fa-film"></i></div>'}
      <div class="media-fade"></div>
      <div class="media-badges">
        <span>${item.type === 'series' ? 'Série' : 'Film'}</span>
        <span>${escapeHtml(item.quality || 'HD')}</span>
        ${item.version ? `<span>${escapeHtml(item.version)}</span>` : ''}
      </div>
      <button type="button" class="media-card-open" data-action="info" aria-label="Regarder ${escapeHtml(item.title)}"></button>
      <div class="media-actions">
        <button type="button" class="media-action primary-action" data-action="play" aria-label="Regarder ${escapeHtml(item.title)}"><i class="fa-solid fa-play"></i></button>
        <button type="button" class="media-action" data-action="info" aria-label="Regarder ${escapeHtml(item.title)}"><i class="fa-solid fa-circle-play"></i></button>
        <button type="button" class="media-action danger-action" data-action="remove" aria-label="Retirer ${escapeHtml(item.title)} de la bibliothèque"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <div class="library-card-meta">
        <span>${escapeHtml(label)}</span>
        ${item.episode ? `<span>S${escapeHtml(item.season || 1)} • E${escapeHtml(item.episode)}</span>` : ''}
      </div>
    </div>`;
  bindImageFallback(card);

  card.querySelector('[data-action="play"]').addEventListener('click', (event) => {
    event.stopPropagation();
    openPlayer(item);
  });
  card.querySelectorAll('[data-action="info"]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openDetails(item);
    });
  });
  card.querySelector('[data-action="remove"]').addEventListener('click', (event) => {
    event.stopPropagation();
    removeLibraryItem(item);
  });

  return card;
}

function renderEmptyState() {
  const data = {
    all: ['fa-bookmark', 'Bibliothèque vide', 'Ajoute des favoris ou ouvre un contenu pour remplir cet espace.'],
    continue: ['fa-play', 'Rien à reprendre', 'Le prochain épisode ou film commencé apparaîtra ici.'],
    favorites: ['fa-heart', 'Ma liste est vide', 'Ajoute un contenu avec le bouton coeur.'],
    history: ['fa-clock-rotate-left', 'Aucun historique', 'Ouvre une fiche ou un lecteur pour créer ton historique.']
  }[libraryView] || ['fa-bookmark', 'Bibliothèque vide', 'Aucun contenu disponible.'];

  return `
    <section class="local-panel rich-empty library-empty">
      <i class="fa-solid ${data[0]}"></i>
      <h2>${escapeHtml(data[1])}</h2>
      <p>${escapeHtml(data[2])}</p>
      <a class="btn primary" href="./catalog.html?type=all"><i class="fa-solid fa-layer-group"></i><span>Explorer</span></a>
    </section>`;
}

function removeLibraryItem(item) {
  if (libraryView === 'favorites' || item.bucket === 'favorites') MadradorStorage.removeFavorite(item.id);
  if (libraryView === 'history' || item.bucket === 'history') removeStorageItem(MadradorStorage.KEYS.history, item);
  if (libraryView === 'continue' || item.bucket === 'continue') removeStorageItem(MadradorStorage.KEYS.continue, item);
  renderLibrary();
  showToast('Élément retiré');
}

function removeStorageItem(key, target) {
  try {
    const targetKey = getLibraryKey(target);
    const next = JSON.parse(localStorage.getItem(key) || '[]')
      .filter((item) => item.id !== target.id && getLibraryKey(item) !== targetKey);
    localStorage.setItem(key, JSON.stringify(next));
  } catch (err) {
    console.warn('Suppression impossible.', err);
  }
}

function dedupeLibraryItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = getLibraryKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getLibraryKey(item) {
  if (inferType(item) === 'series') return `series:${normalizeKey(item.seriesTitle || item.title || '')}`;
  return `movie:${item.id || normalizeKey(item.title || '')}`;
}

function getBucketLabel(bucket) {
  if (bucket === 'continue') return 'À reprendre';
  if (bucket === 'favorites') return 'Ma liste';
  if (bucket === 'history') return 'Vu récemment';
  return 'Local';
}

function inferType(item) {
  return MadradorStorage.normalizeMediaType(item);
}

function openDetails(item) {
  openPlayer(item);
}

function openPlayer(item) {
  MadradorStorage.rememberMedia(item);
  const query = new URLSearchParams({
    id: item.id,
    type: item.type === 'series' ? 'series' : 'movie'
  });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  location.href = `./player.html?${query.toString()}`;
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

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({
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
