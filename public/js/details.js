const params = new URLSearchParams(location.search);
const rawId = params.get('id') || '';
const apiId = getApiId(rawId);
const routeType = params.get('type') || 'movie';
const routeSeriesTitle = params.get('seriesTitle') || '';

let currentItem = null;
let trailerEmbed = '';
let trailerWatch = '';
let currentDetailsData = {};
let currentGenres = [];

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  bindDetailsUI();
  loadDetailsPage();
});

function bindDetailsUI() {
  $('detailWatch').addEventListener('click', () => currentItem && openPlayer(currentItem));
  $('detailFavorite').addEventListener('click', toggleFavorite);
  $('detailShare').addEventListener('click', copyDetailLink);
  $('detailTrailer').addEventListener('click', openTrailer);
  $('detailActionStrip')?.addEventListener('click', handleDetailAction);
  $('detailCloseTrailer').addEventListener('click', closeTrailer);
  $('detailTrailerModal').addEventListener('click', (event) => {
    if (event.target === $('detailTrailerModal')) closeTrailer();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTrailer();
  });
}

async function copyDetailLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast('Lien copié');
  } catch (err) {
    showToast('Copie indisponible');
  }
}

async function loadDetailsPage() {
  if (!apiId) {
    setError('Aucun contenu sélectionné.');
    return;
  }

  try {
    const details = await fetchJson(getDetailsEndpoint());
    currentItem = buildItem(details);
    renderDetails(details);
    renderResume();
    renderFavorite();
    await Promise.all([
      renderSeriesSeasons(details),
      renderSuggestions()
    ]);
  } catch (err) {
    console.error(err);
    setError('Impossible de charger cette fiche.');
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

function buildItem(details) {
  const parsed = parseSeasonTitle(details.title || details.name || '');
  const routeSeries = parseSeasonTitle(routeSeriesTitle).baseTitle || routeSeriesTitle;
  const isSeries = details.isSeries === true || routeType === 'series' || parsed.seasonNumber;
  const title = isSeries ? (routeSeries || parsed.baseTitle || details.title || details.name) : (details.title || details.name || 'Sans titre');

  return {
    id: rawId || apiId,
    title,
    originalTitle: details.title || details.name || title,
    poster: fixUrl(details.poster || details.affiche || details.image || ''),
    backdrop: fixUrl(details.backdrop || details.cover || details.poster || ''),
    quality: details.quality || 'HD',
    version: details.version || 'VF',
    year: details.year || '',
    type: isSeries ? 'series' : 'movies',
    seriesTitle: isSeries ? title : ''
  };
}

function renderDetails(details) {
  const isSeries = currentItem.type === 'series';
  const backdrop = currentItem.backdrop || currentItem.poster;
  const poster = currentItem.poster || currentItem.backdrop;
  const desc = details.description || details.synopsis || details.desc || 'Aucune description disponible.';
  const genres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];
  const meta = [currentItem.year, currentItem.quality, currentItem.version].filter(Boolean);
  currentDetailsData = details || {};
  currentGenres = genres;

  document.title = `${currentItem.title} - Madrador TV`;
  $('detailBackdrop').style.backgroundImage = backdrop ? `url("${cssUrl(backdrop)}")` : '';
  $('detailPoster').innerHTML = poster ? `<img src="${escapeHtml(poster)}" alt="${escapeHtml(currentItem.title)}">` : '<i class="fa-solid fa-film"></i>';
  bindImageFallback($('detailPoster'));
  $('detailType').innerHTML = `<i class="fa-solid ${isSeries ? 'fa-tv' : 'fa-film'}"></i> ${isSeries ? 'Série' : 'Film'}`;
  $('detailTitle').textContent = currentItem.title;
  $('detailMeta').innerHTML = meta.map((value) => `<span>${escapeHtml(value)}</span>`).join('');
  $('detailGenres').innerHTML = genres.map((genre) => `<span>${escapeHtml(genre)}</span>`).join('');
  $('detailDesc').textContent = desc;
  renderDetailInfo(details, genres);

  const trailer = normalizeTrailerUrl(fixUrl(details.trailer || details.youtube || ''));
  trailerEmbed = trailer.embed;
  trailerWatch = trailer.watch;
  $('detailTrailer').classList.toggle('hidden', !trailerEmbed);
  renderDetailActionStrip();

  MadradorStorage.addHistory(currentItem);
}

function handleDetailAction(event) {
  const button = event.target.closest('[data-detail-action]');
  if (!button || button.disabled || !currentItem) return;

  const action = button.dataset.detailAction;
  if (action === 'watch') openPlayer(currentItem);
  if (action === 'favorite') toggleFavorite();
  if (action === 'trailer') openTrailer();
  if (action === 'explore') openRelatedCatalog();
}

function renderDetailActionStrip() {
  if (!currentItem) return;
  const progress = getResumeProgress();
  const favorite = MadradorStorage.isFavorite(currentItem.id);
  const genre = currentGenres[0] || '';
  const source = MadradorStorage.getPrefs().preferredSource || 'vidzy';
  const version = currentItem.version || MadradorStorage.getPrefs().preferredVersion || 'VF';
  const actions = {
    watch: $('detailActionStrip')?.querySelector('[data-detail-action="watch"]'),
    favorite: $('detailActionStrip')?.querySelector('[data-detail-action="favorite"]'),
    explore: $('detailActionStrip')?.querySelector('[data-detail-action="explore"]'),
    trailer: $('detailActionStrip')?.querySelector('[data-detail-action="trailer"]')
  };

  if (actions.watch) {
    actions.watch.innerHTML = `
      <i class="fa-solid ${progress ? 'fa-clock-rotate-left' : 'fa-play'}"></i>
      <span>
        <b>${escapeHtml(progress ? 'Reprendre' : 'Regarder')}</b>
        <small>${escapeHtml(progress?.episode ? `S${progress.season || 1} • E${progress.episode}` : `${version} • ${source}`)}</small>
      </span>`;
  }

  if (actions.favorite) {
    actions.favorite.classList.toggle('active', favorite);
    actions.favorite.innerHTML = `
      <i class="${favorite ? 'fa-solid' : 'fa-regular'} fa-heart"></i>
      <span>
        <b>${favorite ? 'Dans ma liste' : 'Ma liste'}</b>
        <small>${favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}</small>
      </span>`;
  }

  if (actions.explore) {
    actions.explore.disabled = !genre;
    actions.explore.innerHTML = `
      <i class="fa-solid fa-compass"></i>
      <span>
        <b>${genre ? `Explorer ${escapeHtml(genre)}` : 'Explorer'}</b>
        <small>${genre ? 'Ouvrir le catalogue filtré' : 'Aucun genre disponible'}</small>
      </span>`;
  }

  if (actions.trailer) {
    actions.trailer.disabled = !trailerEmbed;
    actions.trailer.innerHTML = `
      <i class="fa-solid fa-clapperboard"></i>
      <span>
        <b>Bande-annonce</b>
        <small>${trailerEmbed ? 'Lire sans quitter la fiche' : 'Indisponible'}</small>
      </span>`;
  }

  $('detailWatch').innerHTML = progress
    ? '<i class="fa-solid fa-clock-rotate-left"></i><span>Reprendre</span>'
    : '<i class="fa-solid fa-play"></i><span>Regarder</span>';
}

function openRelatedCatalog() {
  const genre = currentGenres[0] || '';
  if (!genre) return;
  const query = new URLSearchParams({
    type: 'all',
    genre
  });
  location.href = `./catalog.html?${query.toString()}`;
}

async function renderSeriesSeasons(details) {
  const panel = $('detailsSeriesPanel');
  if (currentItem.type !== 'series') {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  const seasons = await findSeasons(details);
  $('detailSeasonCount').textContent = `${seasons.length} saison${seasons.length > 1 ? 's' : ''}`;
  $('detailSeasons').innerHTML = seasons.map((season) => `
    <button class="detail-season-card ${String(season.id) === String(rawId) || String(getApiId(season.id)) === String(apiId) ? 'active' : ''}" type="button" data-id="${escapeHtml(season.id)}" data-number="${escapeHtml(season.number)}">
      <span>${escapeHtml(season.title)}</span>
      <small>${escapeHtml(season.quality || currentItem.quality)} • ${escapeHtml(season.version || currentItem.version)}</small>
    </button>
  `).join('');

  $('detailSeasons').querySelectorAll('[data-id]').forEach((button) => {
    button.addEventListener('click', () => {
      openPlayer({
        ...currentItem,
        id: button.dataset.id,
        seasonNumber: Number(button.dataset.number)
      });
    });
  });
}

async function findSeasons(details) {
  const parsed = parseSeasonTitle(details.title || details.name || routeSeriesTitle || '');
  const seriesTitle = routeSeriesTitle || parsed.baseTitle || currentItem.seriesTitle || currentItem.title;
  const fallback = [{
    id: rawId || apiId,
    number: parsed.seasonNumber || 1,
    title: `Saison ${parsed.seasonNumber || 1}`,
    quality: currentItem.quality,
    version: currentItem.version
  }];

  try {
    const data = await fetchJson(`/api/serie/${encodeURIComponent(apiId)}/seasons`).catch(() => fetchJson(`/api/seasons/${encodeURIComponent(seriesTitle)}`));
    const seasons = (data.seasons || [])
      .map((season) => ({
        id: season.id,
        number: season.season,
        title: `Saison ${season.season}`,
        quality: currentItem.quality,
        version: currentItem.version
      }))
      .filter((item) => item.id && item.number);

    const byNumber = new Map();
    [...fallback, ...seasons].forEach((season) => byNumber.set(String(season.number), season));
    return Array.from(byNumber.values()).sort((a, b) => Number(a.number) - Number(b.number));
  } catch (err) {
    console.warn('Saisons indisponibles.', err);
    return fallback;
  }
}

function getDetailsEndpoint() {
  return routeType === 'series'
    ? `/api/serie/${encodeURIComponent(apiId)}`
    : `/api/film/${encodeURIComponent(apiId)}`;
}

function renderResume() {
  const prefs = MadradorStorage.getPrefs();
  const progress = prefs.resumePlayback ? getResumeProgress() : null;
  const source = progress?.lastSource ? `Source : ${progress.lastSource}` : 'Source préférée automatique';
  const episode = progress?.episode ? `Saison ${progress.season || 1} • Épisode ${progress.episode}` : 'Lecture directe';
  $('resumeCard').innerHTML = `
    <i class="fa-solid fa-play"></i>
    <strong>${escapeHtml(progress ? 'Reprendre la lecture' : 'Prêt à regarder')}</strong>
    <p>${escapeHtml(episode)}<br>${escapeHtml(source)}</p>
  `;
  $('resumeCard').onclick = () => openPlayer(currentItem);
  renderDetailActionStrip();
}

async function renderSuggestions() {
  const query = currentItem.type === 'series' ? currentItem.seriesTitle || currentItem.title : currentItem.title.split(' ')[0];
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(query)}`);
    const normalized = (data.items || [])
      .map(normalizeSuggestion)
      .filter((item) => item.id && item.id !== currentItem.id && normalizeTitleKey(item.title) !== normalizeTitleKey(currentItem.title));
    const items = dedupeSuggestions(normalized)
      .slice(0, 10);
    $('suggestions').innerHTML = items.length ? items.map(renderSuggestionCard).join('') : '<div class="source-empty">Aucune suggestion disponible.</div>';
    bindImageFallback($('suggestions'));
    $('suggestions').querySelectorAll('[data-open]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = items.find((entry) => entry.id === button.dataset.open);
        if (item) openDetails(item);
      });
    });
  } catch (err) {
    $('suggestions').innerHTML = '<div class="source-empty">Suggestions indisponibles.</div>';
  }
}

function renderDetailInfo(details, genres) {
  const isFavorite = MadradorStorage.isFavorite(currentItem.id);
  const progress = getResumeProgress();
  const historyMatch = MadradorStorage.history().some((item) => sameMedia(item, currentItem));
  const info = [
    { label: 'Type', value: currentItem.type === 'series' ? 'Série' : 'Film', icon: currentItem.type === 'series' ? 'fa-tv' : 'fa-film' },
    { label: 'Année', value: currentItem.year || details.year || 'Non renseignée', icon: 'fa-calendar-days' },
    { label: 'Qualité', value: currentItem.quality || 'HD', icon: 'fa-wand-magic-sparkles' },
    { label: 'Version', value: currentItem.version || 'VF', icon: 'fa-language' },
    { label: 'Genres', value: genres.length ? genres.slice(0, 3).join(', ') : 'Non renseignés', icon: 'fa-masks-theater' },
    { label: 'Statut', value: progress ? 'Reprise disponible' : historyMatch ? 'Déjà ouvert' : 'Nouveau', icon: progress ? 'fa-clock-rotate-left' : 'fa-circle-play' },
    { label: 'Ma liste', value: isFavorite ? 'Ajouté' : 'Non ajouté', icon: isFavorite ? 'fa-heart' : 'fa-plus' }
  ];

  $('detailInfoGrid').innerHTML = info.map((item) => `
    <div class="detail-info-card">
      <i class="fa-solid ${escapeHtml(item.icon)}"></i>
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join('');
}

function getResumeProgress() {
  return MadradorStorage.continueWatching().find((item) => sameMedia(item, currentItem));
}

function sameMedia(item, target) {
  if (!item || !target) return false;
  if (String(item.id) === String(target.id)) return true;
  const itemTitle = item.seriesTitle || item.title;
  const targetTitle = target.seriesTitle || target.title;
  return normalizeTitleKey(itemTitle) === normalizeTitleKey(targetTitle);
}

function normalizeSuggestion(item) {
  const title = item.title || item.name || 'Sans titre';
  const season = parseSeasonTitle(title);
  const isSeries = item.isSeries === true || season.seasonNumber || String(item.type || '').toLowerCase().includes('series');
  return {
    id: item.id || item.newsId || item.newsid || '',
    title: season.baseTitle || title,
    poster: fixUrl(item.poster || item.image || item.img || ''),
    quality: item.quality || 'HD',
    version: item.version || 'VF',
    type: isSeries ? 'series' : 'movies',
    seriesTitle: season.baseTitle || title
  };
}

function dedupeSuggestions(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.type === 'series'
      ? `series:${normalizeTitleKey(item.seriesTitle || item.title)}`
      : `movie:${item.id || normalizeTitleKey(item.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderSuggestionCard(item) {
  return `
    <button class="suggestion-card" type="button" data-open="${escapeHtml(item.id)}">
      ${item.poster ? `<img src="${escapeHtml(item.poster)}" alt="">` : '<span><i class="fa-solid fa-film"></i></span>'}
      <b>${escapeHtml(item.title)}</b>
      <small>${item.type === 'series' ? 'Série' : 'Film'} • ${escapeHtml(item.quality)}</small>
    </button>
  `;
}

function openDetails(item) {
  const query = new URLSearchParams({
    id: item.id,
    type: item.type === 'series' ? 'series' : 'movie'
  });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  location.href = `./details.html?${query.toString()}`;
}

function openPlayer(item) {
  const query = new URLSearchParams({
    id: item.id,
    type: item.type === 'series' ? 'series' : 'movie'
  });
  if (item.type === 'series') query.set('seriesTitle', item.seriesTitle || item.title);
  location.href = `./player.html?${query.toString()}`;
}

function toggleFavorite() {
  if (!currentItem) return;
  if (MadradorStorage.isFavorite(currentItem.id)) {
    MadradorStorage.removeFavorite(currentItem.id);
    showToast('Retiré de Ma liste');
  } else {
    MadradorStorage.addFavorite(currentItem);
    showToast('Ajouté à Ma liste');
  }
  renderFavorite();
  renderDetailActionStrip();
  if (currentItem) renderDetailInfo(currentDetailsData, currentGenres);
}

function renderFavorite() {
  const active = currentItem && MadradorStorage.isFavorite(currentItem.id);
  $('detailFavorite').classList.toggle('is-favorite', active);
  $('detailFavorite').innerHTML = active
    ? '<i class="fa-solid fa-heart"></i><span>Dans ma liste</span>'
    : '<i class="fa-regular fa-heart"></i><span>Ma liste</span>';
}

function openTrailer() {
  if (!trailerEmbed) return;
  $('detailTrailerExternal').href = trailerWatch || trailerEmbed;
  $('detailTrailerFrame').src = trailerEmbed;
  $('detailTrailerModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeTrailer() {
  $('detailTrailerFrame').src = '';
  $('detailTrailerModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function normalizeTrailerUrl(url) {
  if (!url) return { embed: '', watch: '' };
  const cleanUrl = String(url).trim();
  const directId = cleanUrl.replace(/^\/+/, '');
  if (/^[A-Za-z0-9_-]{11}$/.test(directId)) return youtubeUrls(directId);

  try {
    const parsed = new URL(cleanUrl, location.origin);
    if (parsed.hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return youtubeUrls(videoId);
      const embedMatch = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
      if (embedMatch) return youtubeUrls(embedMatch[1]);
    }
    if (parsed.hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.replace('/', '');
      if (videoId) return youtubeUrls(videoId);
    }
  } catch (err) {
    return { embed: cleanUrl, watch: cleanUrl };
  }
  return { embed: cleanUrl, watch: cleanUrl };
}

function youtubeUrls(videoId) {
  return {
    embed: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
    watch: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function setError(message) {
  $('detailTitle').textContent = 'Erreur';
  $('detailDesc').textContent = message;
  $('detailWatch').disabled = true;
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
    if (match?.[1] && match?.[2]) return { baseTitle: match[1].trim(), seasonNumber: Number(match[2]) };
  }
  return { baseTitle: clean, seasonNumber: null };
}

function normalizeTitleKey(title) {
  return String(title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function getApiId(value) {
  const clean = String(value || '').trim();
  const numericPrefix = clean.match(/^\d+/);
  return numericPrefix ? numericPrefix[0] : clean;
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return location.protocol + url;
  return url;
}

function cssUrl(url) {
  return String(url).replace(/"/g, '\\"');
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 2000);
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
