const params = new URLSearchParams(location.search);
const id = params.get('id');
const apiId = getApiId(id);
const routeType = params.get('type');
const routeSeriesTitle = params.get('seriesTitle');

let streams = [];
let selectedIndex = -1;
let trailerUrl = '';
let trailerWatchUrl = '';
let currentMedia = null;
let currentDetails = null;
let currentStreamData = null;
let contentType = 'movie';
let seasons = [];
let selectedSeasonIndex = 0;
let selectedEpisodeIndex = 0;
let baseSeriesTitle = '';
let selectedSeriesVersion = 'vf';
let sourceAttemptId = 0;
let automaticFallbacks = 0;
const SERIES_VERSIONS = ['vf', 'vostfr', 'vo'];
const SERIES_VERSION_LABELS = { vf: 'VF', vostfr: 'VOSTFR', vo: 'VO' };
const SERIES_VERSION_VALUES = { VF: 'vf', VOSTFR: 'vostfr', VO: 'vo', 'VF+VOSTFR': 'vf' };
const SOURCE_PRIORITY = ['premium', 'vidzy', 'voe', 'uqload', 'netu'];

const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  bindPlayerUI();
  loadPlayer();
});

function bindPlayerUI() {
  $('playFirst').addEventListener('click', () => playSource(getPreferredSourceIndex()));
  $('favoriteBtn').addEventListener('click', toggleFavorite);
  $('trailerBtn').addEventListener('click', openTrailer);
  $('cinemaMode').addEventListener('click', toggleCinemaMode);
  $('focusPlayer').addEventListener('click', () => $('screen').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  $('fullscreenBtn').addEventListener('click', enterFullscreen);
  $('openSource').addEventListener('click', openCurrentSource);
  $('prevSource').addEventListener('click', () => playRelativeSource(-1));
  $('nextSource').addEventListener('click', () => playRelativeSource(1));
  $('copySource').addEventListener('click', copyCurrentSource);
  $('nextEpisode').addEventListener('click', playNextEpisode);
  $('episodeNowNext')?.addEventListener('click', playNextEpisode);
  $('player').addEventListener('load', handlePlayerLoad);
  $('closeTrailer').addEventListener('click', closeTrailer);
  $('trailerModal').addEventListener('click', (event) => {
    if (event.target === $('trailerModal')) closeTrailer();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTrailer();
  });
}

function toggleCinemaMode() {
  document.body.classList.toggle('cinema-mode');
  const active = document.body.classList.contains('cinema-mode');
  $('cinemaMode').classList.toggle('is-favorite', active);
  $('cinemaMode').innerHTML = active
    ? '<i class="fa-solid fa-compress"></i><span>Quitter cinéma</span>'
    : '<i class="fa-solid fa-expand"></i><span>Mode cinéma</span>';
  $('screen').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function enterFullscreen() {
  const target = $('screen');
  if (!target.requestFullscreen) return;
  try {
    await target.requestFullscreen();
  } catch (err) {
    console.warn('Plein écran indisponible.', err);
  }
}

async function loadPlayer() {
  if (!id) return setError('Aucun identifiant fourni.');

  try {
    const details = await fetchJson(getInitialDetailsEndpoint());

    currentDetails = details || {};
    contentType = detectContentType(currentDetails, {});

    renderDetails(currentDetails);

    if (contentType === 'series') {
      currentStreamData = {};
      await renderSeriesLayout(currentDetails);
    } else {
      const streamData = await fetchJson(`/api/film/${encodeURIComponent(apiId)}/sources`).catch((err) => {
        console.warn('Sources initiales indisponibles.', err);
        return fetchJson(`/api/stream/${encodeURIComponent(apiId)}`).catch(() => ({ sources: [], links: [] }));
      });
      currentStreamData = streamData || {};
      renderMovieLayout(currentStreamData);
    }
  } catch (err) {
    console.error(err);
    setError('Impossible de charger la page lecteur.');
  }
}

function getInitialDetailsEndpoint() {
  return routeType === 'series'
    ? `/api/serie/${encodeURIComponent(apiId)}`
    : `/api/film/${encodeURIComponent(apiId)}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur ${res.status}`);
  return res.json();
}

function detectContentType(details, streamData) {
  if (details?.isSeries === true) return 'series';
  if (String(details?.type || routeType || '').toLowerCase() === 'series') return 'series';
  if (parseSeasonTitle(details?.title || '').seasonNumber) return 'series';
  if (Array.isArray(details?.seasons) || Array.isArray(streamData?.seasons)) return 'series';
  if (Array.isArray(details?.episodes) || Array.isArray(streamData?.episodes)) return 'series';
  return 'movie';
}

function renderDetails(details) {
  const parsedTitle = parseSeasonTitle(details.title || details.name || '');
  const parsedRouteTitle = parseSeasonTitle(routeSeriesTitle || '');
  baseSeriesTitle = parsedRouteTitle.baseTitle || parsedTitle.baseTitle || details.title || details.name || 'Sans titre';
  const title = contentType === 'series' ? baseSeriesTitle : (details.title || details.name || 'Sans titre');
  const desc = details.description || details.synopsis || details.desc || 'Aucune description disponible.';
  const poster = fixUrl(details.poster || details.affiche || details.image || '');
  const backdrop = fixUrl(details.backdrop || details.cover || poster || '');
  const genres = Array.isArray(details.genres) ? details.genres.filter(Boolean) : [];

  currentMedia = MadradorStorage.media({ ...details, id, isSeries: contentType === 'series' });
  currentMedia.type = contentType === 'series' ? 'series' : 'movies';
  MadradorStorage.addHistory(currentMedia);

  $('title').textContent = title;
  $('desc').textContent = desc;
  $('year').textContent = details.year || '-';
  $('quality').textContent = details.quality || 'HD';
  $('version').textContent = details.version || 'VF';

  renderGenres(genres);
  renderPoster(poster, title);
  renderBackdrop(backdrop);
  renderTrailer(details.trailer || details.youtube || '');
  renderFavoriteButton();
  loadRecommendations(details);

  document.body.dataset.layout = contentType;
  document.title = `${title} - Madrador TV`;
}

async function loadRecommendations(details) {
  const section = $('playerRecommendations');
  const track = $('recommendationTrack');
  const tmdbId = details?.tmdb?.id;
  if (!section || !track || !tmdbId) return;
  const type = details.isSeries || contentType === 'series' ? 'series' : 'movie';

  try {
    const data = await fetchJson(`/api/tmdb/recommendations/${type}/${encodeURIComponent(tmdbId)}`);
    const items = Array.isArray(data.items) ? data.items.slice(0, 12) : [];
    if (!items.length) return;
    track.innerHTML = items.map((item, index) => `
      <button class="recommendation-card" type="button" data-recommendation="${index}">
        <span class="recommendation-image">
          ${item.backdrop || item.poster ? `<img src="${escapeHtml(item.backdrop || item.poster)}" alt="" loading="lazy" data-image-role="land">` : '<i class="fa-solid fa-film"></i>'}
        </span>
        <span class="recommendation-copy">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.year || (type === 'series' ? 'Série' : 'Film'))}${item.rating ? ` • ${Number(item.rating).toFixed(1)}/10` : ''}</small>
        </span>
      </button>`).join('');
    section.classList.remove('hidden');
    track.querySelectorAll('[data-recommendation]').forEach((button) => {
      button.addEventListener('click', () => openRecommendation(items[Number(button.dataset.recommendation)]));
    });
    window.MadradorImages?.scan(track);
  } catch (error) {
    console.warn('Recommandations indisponibles.', error);
  }
}

async function openRecommendation(item) {
  if (!item?.title) return;
  showPlayerNotice(`Recherche de ${item.title} dans Madrador...`);
  try {
    const data = await fetchJson(`/api/search?q=${encodeURIComponent(item.title)}`);
    const pools = [data.items, data.movies, data.series, data.results]
      .flatMap((value) => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : []);
    const wanted = normalizeTitleKey(item.title);
    const match = pools.find((candidate) => normalizeTitleKey(candidate.title || candidate.name || '') === wanted)
      || pools.find((candidate) => normalizeTitleKey(candidate.title || candidate.name || '').includes(wanted));
    if (!match?.id) {
      showPlayerNotice('Ce titre recommandé n’est pas encore dans le catalogue.');
      return;
    }
    const isSeries = Boolean(match.isSeries || String(match.type || '').toLowerCase().includes('series'));
    const params = new URLSearchParams({ id: match.id, type: isSeries ? 'series' : 'movie' });
    if (isSeries) params.set('seriesTitle', match.seriesTitle || match.title || item.title);
    location.href = `./player.html?${params.toString()}`;
  } catch (error) {
    showPlayerNotice('Recherche de recommandation indisponible.');
  }
}

function renderMovieLayout(streamData) {
  $('seriesPanel').classList.add('hidden');
  streams = normalizeStreams(extractSources(streamData));
  renderSources();
  autoplayPreferredSource();
}

async function renderSeriesLayout(details) {
  $('seriesPanel').classList.remove('hidden');
  seasons = await buildSeriesSeasons(details);

  if (!seasons.length) {
    const parsed = parseSeasonTitle(details.title || details.name || '');
    const seasonNumber = parsed.seasonNumber || 1;
    seasons = [{
      number: seasonNumber,
      title: `Saison ${seasonNumber}`,
      seasonId: apiId,
      loaded: false,
      episodes: [],
      episodeData: null
    }];
  }

  const prefs = MadradorStorage.getPrefs();
  const progress = prefs.resumePlayback ? getSeriesProgress() : null;
  selectedSeriesVersion = progress?.version || SERIES_VERSION_VALUES[prefs.preferredVersion] || selectedSeriesVersion;
  selectedSeasonIndex = clampIndex(seasons.findIndex((season) => String(season.number) === String(progress?.season)), seasons.length);
  const savedSeason = seasons[selectedSeasonIndex];
  await ensureSeasonLoaded(savedSeason);
  selectedSeriesVersion = pickAvailableVersion(savedSeason.episodeData, selectedSeriesVersion);
  savedSeason.episodes = normalizeSeriesEpisodeList(savedSeason.episodeData, selectedSeriesVersion);
  selectedEpisodeIndex = clampIndex(savedSeason.episodes.findIndex((episode) => String(episode.number) === String(progress?.episode)), savedSeason.episodes.length);

  renderSeasonSelect();
  renderVersionButtons();
  await selectEpisode(selectedEpisodeIndex, false);
}

function normalizeSeasons(details, streamData) {
  const rawSeasons = details.seasons || streamData.seasons;
  if (Array.isArray(rawSeasons) && rawSeasons.length) {
    return rawSeasons.map((season, seasonIndex) => ({
      number: season.number || season.season || season.seasonNumber || seasonIndex + 1,
      title: season.title || season.name || `Saison ${season.number || seasonIndex + 1}`,
      episodes: normalizeEpisodes(season.episodes || season.items || [], seasonIndex)
    })).filter((season) => season.episodes.length);
  }

  const rawEpisodes = details.episodes || streamData.episodes;
  if (Array.isArray(rawEpisodes) && rawEpisodes.length) {
    const grouped = new Map();
    normalizeEpisodes(rawEpisodes, 0).forEach((episode) => {
      const seasonNumber = episode.season || 1;
      if (!grouped.has(seasonNumber)) {
        grouped.set(seasonNumber, {
          number: seasonNumber,
          title: `Saison ${seasonNumber}`,
          episodes: []
        });
      }
      grouped.get(seasonNumber).episodes.push(episode);
    });
    return Array.from(grouped.values());
  }

  return [];
}

async function buildSeriesSeasons(details) {
  const structuredSeasons = normalizeSeasons(details, {}).map((season) => ({
    ...season,
    seasonId: season.seasonId || apiId,
    loaded: false,
    episodeData: null,
    episodes: []
  }));
  const discoveredSeasons = await discoverSiblingSeasons(details);

  if (!discoveredSeasons.length) return structuredSeasons;

  const merged = new Map();
  structuredSeasons.forEach((season) => merged.set(String(season.number), season));
  discoveredSeasons.forEach((season) => {
    const key = String(season.number);
    merged.set(key, { ...merged.get(key), ...season });
  });

  return Array.from(merged.values()).sort((a, b) => Number(a.number) - Number(b.number));
}

async function discoverSiblingSeasons(details) {
  const titleInfo = parseSeasonTitle(details.title || details.name || routeSeriesTitle || '');
  const seriesTitle = routeSeriesTitle || titleInfo.baseTitle;
  if (!seriesTitle) return [];

  try {
    const data = await fetchJson(`/api/serie/${encodeURIComponent(apiId)}/seasons`).catch(() => fetchJson(`/api/seasons/${encodeURIComponent(seriesTitle)}`));
    const items = (data.seasons || [])
      .map((season) => ({
        id: season.id,
        title: season.title || `Saison ${season.season}`,
        number: season.season,
        quality: details.quality || 'HD',
        version: details.version || 'VF',
        year: details.year || ''
      }))
      .filter((item) => item.id && item.number);

    const bySeason = new Map();
    items.forEach((item) => {
      if (!bySeason.has(String(item.number))) bySeason.set(String(item.number), item);
    });

    return Array.from(bySeason.values()).map((item) => ({
      number: item.number,
      title: `Saison ${item.number}`,
      seasonId: item.id,
      loaded: false,
      details: String(getApiId(item.id)) === String(apiId) ? details : null,
      streamData: null,
      episodeData: null,
      episodes: []
    }));
  } catch (err) {
    console.warn('Recherche des saisons indisponible.', err);
    return [];
  }
}

function normalizeEpisodes(rawEpisodes, seasonIndex) {
  return rawEpisodes.map((episode, episodeIndex) => ({
    id: episode.id || episode.newsId || episode.newsid || episode.episodeId || episode.streamId || '',
    number: episode.number || episode.episode || episode.episodeNumber || episodeIndex + 1,
    season: episode.season || episode.seasonNumber || seasonIndex + 1,
    title: episode.title || episode.name || `Épisode ${episode.number || episodeIndex + 1}`,
    description: episode.description || episode.synopsis || episode.desc || '',
    duration: episode.duration || episode.duree || '',
    poster: episode.poster || episode.image || episode.backdrop || '',
    sources: extractSources(episode)
  }));
}

function renderSeasonSelect() {
  const box = $('seasonButtons');
  box.innerHTML = seasons.map((season, index) => (
    `<button class="season-btn ${index === selectedSeasonIndex ? 'active' : ''}" type="button" data-season="${index}">
      ${escapeHtml(season.title || `Saison ${season.number}`)}
    </button>`
  )).join('');
  box.querySelectorAll('[data-season]').forEach((button) => {
    button.addEventListener('click', () => selectSeason(Number(button.dataset.season)));
  });
  renderEpisodeList();
}

function renderVersionButtons() {
  const season = seasons[selectedSeasonIndex];
  const versions = getAvailableVersions(season?.episodeData);
  const box = $('versionButtons');

  selectedSeriesVersion = versions.includes(selectedSeriesVersion) ? selectedSeriesVersion : (versions[0] || 'vf');
  box.innerHTML = versions.map((version) => (
    `<button class="version-btn ${version === selectedSeriesVersion ? 'active' : ''}" type="button" data-version="${version}">
      ${SERIES_VERSION_LABELS[version] || version.toUpperCase()}
    </button>`
  )).join('');

  box.querySelectorAll('[data-version]').forEach((button) => {
    button.addEventListener('click', () => selectSeriesVersion(button.dataset.version));
  });
}

function renderEpisodeList() {
  const season = seasons[selectedSeasonIndex];
  const episodes = season?.episodes || [];
  const watched = getWatchedEpisodes();
  const nextIndex = getNextEpisodeIndex(season, watched);
  $('episodeCount').textContent = `${episodes.length} épisode${episodes.length > 1 ? 's' : ''}`;
  renderSeriesProgress(season, episodes, watched);
  $('episodeList').innerHTML = episodes.map((episode, index) => `
    <button class="episode-btn ${index === selectedEpisodeIndex ? 'active' : ''} ${watched.has(getEpisodeWatchKey(season, episode)) ? 'watched' : ''} ${index === nextIndex ? 'next-up' : ''}" type="button" data-episode="${index}">
      <span class="episode-thumb">
        ${episode.poster ? `<img src="${escapeHtml(fixUrl(episode.poster))}" alt="">` : ''}
        <span class="episode-number">${String(episode.number).padStart(2, '0')}</span>
        ${getEpisodeBadgeMarkup(season, episode, index, watched, nextIndex)}
      </span>
      <span class="episode-copy">
        <span>${escapeHtml(getEpisodeShortTitle(episode))}</span>
        <small>${escapeHtml(episode.description || 'Sources disponibles pour cet épisode.')}</small>
        <em>${escapeHtml(getEpisodeMetaLabel(season, episode, index, watched, nextIndex))}</em>
      </span>
    </button>
  `).join('');
  bindImageFallback($('episodeList'), { removeOnly: true });

  $('episodeList').querySelectorAll('[data-episode]').forEach((button) => {
    button.addEventListener('click', () => selectEpisode(Number(button.dataset.episode), true));
  });
  updateEpisodeNowPanel();
}

function getEpisodeBadgeMarkup(season, episode, index, watched, nextIndex) {
  const key = getEpisodeWatchKey(season, episode);
  if (index === selectedEpisodeIndex) return '<span class="episode-state state-current">En cours</span>';
  if (watched.has(key)) return '<span class="episode-state state-watched">Vu</span>';
  if (index === nextIndex) return '<span class="episode-state state-next">Suivant</span>';
  return '';
}

function getEpisodeMetaLabel(season, episode, index, watched, nextIndex) {
  const labels = [SERIES_VERSION_LABELS[selectedSeriesVersion] || selectedSeriesVersion.toUpperCase()];
  if (watched.has(getEpisodeWatchKey(season, episode))) labels.push('Vu');
  else if (index === selectedEpisodeIndex) labels.push('En cours');
  else if (index === nextIndex) labels.push('Suivant');
  if (episode.sources?.length) labels.push(`${episode.sources.length} source${episode.sources.length > 1 ? 's' : ''}`);
  return labels.join(' • ');
}

function getEpisodeShortTitle(episode) {
  return episode.title || `Épisode ${episode.number}`;
}

function renderSeriesProgress(season, episodes, watched) {
  const box = $('seriesProgress');
  if (!box) return;
  const total = episodes.length;
  const viewed = episodes.filter((episode) => watched.has(getEpisodeWatchKey(season, episode))).length;
  box.textContent = total ? `${viewed}/${total} vu` : '0 vu';
}

async function selectSeason(index) {
  selectedSeasonIndex = clampIndex(index, seasons.length);
  selectedEpisodeIndex = 0;
  await ensureSeasonLoaded(seasons[selectedSeasonIndex]);
  selectedSeriesVersion = pickAvailableVersion(seasons[selectedSeasonIndex].episodeData, selectedSeriesVersion);
  seasons[selectedSeasonIndex].episodes = normalizeSeriesEpisodeList(seasons[selectedSeasonIndex].episodeData, selectedSeriesVersion);
  renderSeasonSelect();
  renderVersionButtons();
  renderEpisodeList();
  await selectEpisode(0, true);
}

async function selectSeriesVersion(version) {
  const season = seasons[selectedSeasonIndex];
  selectedSeriesVersion = pickAvailableVersion(season?.episodeData, version);
  selectedEpisodeIndex = 0;
  if (season) season.episodes = normalizeSeriesEpisodeList(season.episodeData, selectedSeriesVersion);
  renderVersionButtons();
  renderEpisodeList();
  await selectEpisode(0, true);
}

async function selectEpisode(index, shouldAutoplay) {
  const season = seasons[selectedSeasonIndex];
  await ensureSeasonLoaded(season);
  season.episodes = normalizeSeriesEpisodeList(season.episodeData, selectedSeriesVersion);
  const episode = season?.episodes?.[clampIndex(index, season?.episodes?.length || 0)];
  if (!episode) return;

  selectedEpisodeIndex = clampIndex(index, season.episodes.length);
  renderEpisodeList();
  renderEpisodeInfo(season, episode);

  streams = normalizeStreams(await resolveEpisodeSources(episode));
  renderSources();
  saveSeriesProgress(season, episode, { markWatched: false, addContinue: false });
  updateSourceToolState();

  if (shouldAutoplay || MadradorStorage.getPrefs().autoplay) {
    autoplayPreferredSource();
  }
}

function renderEpisodeInfo(season, episode) {
  $('episodeInfo').innerHTML = `
    <strong>${escapeHtml(baseSeriesTitle)} • ${escapeHtml(season.title || `Saison ${season.number}`)} • Épisode ${escapeHtml(episode.number)}</strong>
    <em>${escapeHtml(SERIES_VERSION_LABELS[selectedSeriesVersion] || selectedSeriesVersion.toUpperCase())} • ${escapeHtml(episode.title)}</em>
    <p>${escapeHtml(episode.description || 'Sélectionne une source pour lancer cet épisode.')}</p>
  `;
  updateEpisodeNowPanel(season, episode);
}

function updateEpisodeNowPanel(season = seasons[selectedSeasonIndex], episode = season?.episodes?.[selectedEpisodeIndex]) {
  const next = getNextEpisodeTarget();
  const versionLabel = SERIES_VERSION_LABELS[selectedSeriesVersion] || selectedSeriesVersion.toUpperCase();

  if (!episode) {
    $('episodeNowTitle').textContent = 'Aucun épisode sélectionné';
    $('episodeNowMeta').textContent = 'Choisis une saison et une version.';
  } else {
    $('episodeNowTitle').textContent = `${season?.title || `Saison ${season?.number || 1}`} • Épisode ${episode.number} - ${getEpisodeShortTitle(episode)}`;
    $('episodeNowMeta').textContent = `${versionLabel} • ${streams.length || episode.sources?.length || 0} source${(streams.length || episode.sources?.length || 0) > 1 ? 's' : ''} disponible${(streams.length || episode.sources?.length || 0) > 1 ? 's' : ''}`;
  }

  const disabled = !next;
  $('episodeNowNext').disabled = disabled;
  $('nextEpisode').disabled = disabled;
  const label = next
    ? `Épisode ${next.episode.number}`
    : 'Épisode suivant';
  $('episodeNowNext').innerHTML = `<i class="fa-solid fa-forward"></i><span>${escapeHtml(label)}</span>`;
  $('nextEpisode').innerHTML = `<i class="fa-solid fa-forward"></i><span>${escapeHtml(label)}</span>`;
}

function getNextEpisodeTarget() {
  if (contentType !== 'series') return null;
  const season = seasons[selectedSeasonIndex];
  if (!season?.episodes?.length) return null;
  if (selectedEpisodeIndex + 1 < season.episodes.length) {
    return {
      seasonIndex: selectedSeasonIndex,
      episodeIndex: selectedEpisodeIndex + 1,
      episode: season.episodes[selectedEpisodeIndex + 1]
    };
  }
  const nextSeason = seasons[selectedSeasonIndex + 1];
  if (nextSeason) {
    const episode = nextSeason.episodes?.[0] || { number: 1, title: `Saison ${nextSeason.number}` };
    return {
      seasonIndex: selectedSeasonIndex + 1,
      episodeIndex: 0,
      episode
    };
  }
  return null;
}

function getNextEpisodeIndex(season, watched) {
  const episodes = season?.episodes || [];
  return episodes.findIndex((episode) => !watched.has(getEpisodeWatchKey(season, episode)));
}

async function resolveEpisodeSources(episode) {
  if (episode.sources?.length) return episode.sources;

  if (contentType === 'series') return [];

  const episodeId = episode.id && String(getApiId(episode.id)) !== String(apiId) ? getApiId(episode.id) : '';
  if (episodeId) {
    try {
      const data = await fetchJson(`/api/film/${encodeURIComponent(episodeId)}/sources`).catch(() => fetchJson(`/api/stream/${encodeURIComponent(episodeId)}`));
      return extractSources(data);
    } catch (err) {
      console.warn('Sources épisode indisponibles, fallback série.', err);
    }
  }

  return extractSources(currentStreamData);
}

async function ensureSeasonLoaded(season) {
  if (!season || season.loaded) return;

  if (season.seasonId) {
    const seasonApiId = getApiId(season.seasonId);
    const [details, episodeData] = await Promise.all([
      fetchJson(`/api/serie/${encodeURIComponent(seasonApiId)}`).catch(() => fetchJson(`/api/details/${encodeURIComponent(seasonApiId)}`).catch(() => season.details || currentDetails)),
      fetchJson(`/api/serie/${encodeURIComponent(seasonApiId)}/episodes`).catch(() => fetchJson(`/api/episodes/${encodeURIComponent(seasonApiId)}`).catch(() => season.episodeData || null))
    ]);

    season.details = details || {};
    season.episodeData = episodeData || {};
    selectedSeriesVersion = pickAvailableVersion(season.episodeData, selectedSeriesVersion);
    season.episodes = normalizeSeriesEpisodeList(season.episodeData, selectedSeriesVersion);
    season.loaded = true;
    currentDetails = season.details || currentDetails;
    currentStreamData = {};

    updateSeasonVisuals(season.details);
    return;
  }

  season.episodeData = {};
  season.episodes = [];
  season.loaded = true;
}

function normalizeSeasonEpisodes(season, details, streamData) {
  const structured = normalizeSeasons(details || {}, streamData || {}).find((item) => String(item.number) === String(season.number));
  if (structured?.episodes?.length) return structured.episodes;

  const directEpisodes = normalizeEpisodes(details?.episodes || streamData?.episodes || [], Number(season.number) - 1);
  if (directEpisodes.length) return directEpisodes;

  return [{
    id: season.seasonId || id,
    number: 1,
    season: season.number,
    title: details?.title ? `${parseSeasonTitle(details.title).baseTitle || details.title} - Saison ${season.number}` : `Saison ${season.number}`,
    description: details?.description || details?.synopsis || '',
    sources: extractSources(streamData || currentStreamData)
  }];
}

function normalizeSeriesEpisodeList(data, version) {
  const episodeMap = data?.[version] || {};
  const infoMap = data?.info || {};

  return Object.keys(episodeMap)
    .sort((a, b) => Number(a) - Number(b))
    .map((num) => {
      const info = infoMap[num] || {};
      return {
        id: num,
        number: Number(num),
        version,
        title: info.title || `Épisode ${num}`,
        description: info.synopsis || info.description || '',
        synopsis: info.synopsis || info.description || '',
        poster: info.poster || '',
        sources: normalizeEpisodePlayers(episodeMap[num], version)
      };
    })
    .filter((episode) => episode.sources.length);
}

function normalizeEpisodePlayers(players, version) {
  if (!players || typeof players !== 'object') return [];

  return Object.entries(players)
    .filter(([, url]) => url)
    .map(([provider, url]) => ({
      name: provider,
      url: fixUrl(url),
      quality: SERIES_VERSION_LABELS[version] || version.toUpperCase(),
      provider: normalizeProvider(provider),
      lang: version
    }));
}

function getAvailableVersions(data) {
  return SERIES_VERSIONS.filter((version) => Object.keys(data?.[version] || {}).length);
}

function pickAvailableVersion(data, wanted) {
  const versions = getAvailableVersions(data);
  if (!versions.length) return wanted || 'vf';
  return versions.includes(wanted) ? wanted : versions[0];
}

function updateSeasonVisuals(details) {
  if (!details) return;
  const poster = fixUrl(details.poster || details.affiche || details.image || '');
  const backdrop = fixUrl(details.backdrop || details.cover || poster || '');

  $('title').textContent = baseSeriesTitle || parseSeasonTitle(details.title || '').baseTitle || details.title || 'Série';
  $('desc').textContent = details.description || details.synopsis || details.desc || $('desc').textContent;
  $('year').textContent = details.year || $('year').textContent;
  $('quality').textContent = details.quality || $('quality').textContent;
  $('version').textContent = details.version || $('version').textContent;

  renderPoster(poster, $('title').textContent);
  renderBackdrop(backdrop);
}

function extractSources(data) {
  return data?.sources || data?.links || data?.streams || [];
}

function saveSeriesProgress(season, episode, options = {}) {
  const { markWatched: shouldMarkWatched = false, addContinue = true } = options;
  const progress = {
    season: season.number,
    episode: episode.number,
    version: selectedSeriesVersion,
    source: streams[selectedIndex]?.provider || streams[selectedIndex]?.name || null,
    updatedAt: Date.now()
  };
  localStorage.setItem(getSeriesProgressKey(), JSON.stringify(progress));
  if (shouldMarkWatched) markEpisodeWatched(season, episode);
  if (addContinue) {
    MadradorStorage.addContinue({
      ...currentMedia,
      season: season.number,
      episode: episode.number,
      version: selectedSeriesVersion,
      episodeTitle: episode.title,
      updatedAt: Date.now()
    });
  }
}

function getWatchedEpisodes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(getSeriesWatchedKey()) || '[]'));
  } catch (err) {
    return new Set();
  }
}

function markEpisodeWatched(season, episode) {
  const watched = getWatchedEpisodes();
  watched.add(getEpisodeWatchKey(season, episode));
  localStorage.setItem(getSeriesWatchedKey(), JSON.stringify([...watched].slice(-300)));
}

function getSeriesWatchedKey() {
  return `madrador:series-watched:${normalizeTitleKey(baseSeriesTitle || id)}`;
}

function getEpisodeWatchKey(season, episode) {
  return `${season?.number || 1}:${episode?.number || 1}:${selectedSeriesVersion}`;
}

function getSeriesProgress() {
  try {
    return JSON.parse(localStorage.getItem(getSeriesProgressKey()) || 'null');
  } catch (err) {
    return null;
  }
}

function getSeriesProgressKey() {
  return `madrador:series-progress:${normalizeTitleKey(baseSeriesTitle || id)}`;
}

function clampIndex(index, length) {
  if (!length || index < 0) return 0;
  return Math.min(index, length - 1);
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

function sameSeriesTitle(a, b) {
  return normalizeTitleKey(a) === normalizeTitleKey(b);
}

function normalizeTitleKey(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function renderPoster(poster, title) {
  const posterEl = $('poster');
  const fallback = $('posterFallback');
  poster = window.MadradorImages?.sharpUrl(poster, 'poster') || poster;

  if (!poster) {
    posterEl.removeAttribute('src');
    posterEl.classList.add('hidden');
    fallback.classList.remove('hidden');
    return;
  }

  posterEl.src = poster;
  posterEl.dataset.mediaId = apiId;
  posterEl.dataset.mediaType = contentType;
  posterEl.dataset.imageRole = 'poster';
  posterEl.alt = title;
  posterEl.classList.remove('hidden');
  fallback.classList.add('hidden');
  posterEl.onerror = () => {
    posterEl.removeAttribute('src');
    posterEl.classList.add('hidden');
    fallback.classList.remove('hidden');
  };
}

function renderBackdrop(backdrop) {
  if (!backdrop) return;
  backdrop = window.MadradorImages?.sharpUrl(backdrop, 'backdrop') || backdrop;
  $('backdrop').style.backgroundImage = `url("${cssUrl(backdrop)}")`;
}

function renderGenres(genres) {
  const box = $('genres');
  box.innerHTML = '';

  if (!genres.length) {
    box.classList.add('hidden');
    return;
  }

  box.classList.remove('hidden');
  genres.forEach((genre) => {
    const pill = document.createElement('span');
    pill.textContent = genre;
    box.appendChild(pill);
  });
}

function renderTrailer(url) {
  const trailer = normalizeTrailerUrl(fixUrl(url));
  trailerUrl = trailer.embed;
  trailerWatchUrl = trailer.watch;
  $('trailerBtn').classList.toggle('hidden', !trailerUrl);
}

function normalizeStreams(list) {
  return list.map((source, index) => ({
    name: source.name || source.provider || `Lecteur ${index + 1}`,
    url: fixUrl(source.url || source.src || ''),
    quality: source.quality || source.lang || 'HD',
    provider: normalizeProvider(source.provider || source.name || '')
  })).filter((source) => source.url)
    .sort((a, b) => getProviderRank(a) - getProviderRank(b));
}

function renderSources() {
  automaticFallbacks = 0;
  const box = $('sources');
  box.innerHTML = '';
  selectedIndex = -1;
  $('sourceCount').textContent = String(streams.length);

  if (!streams.length) {
    $('playFirst').disabled = true;
    updateSourceToolState();
    box.innerHTML = '<div class="source-empty"><i class="fa-solid fa-circle-info"></i> Aucune source disponible.</div>';
    renderSourceStatus(null, 'Aucune source', 'Aucun lecteur disponible pour ce contenu ou cet épisode.');
    resetPlayerFrame();
    return;
  }

  $('playFirst').disabled = false;
  const preferredIndex = getPreferredSourceIndex();
  streams.forEach((src, index) => {
    const btn = document.createElement('button');
    btn.className = 'source-btn';
    if (index === preferredIndex) btn.classList.add('recommended');
    btn.innerHTML = `
      <span><i class="fa-solid fa-play"></i>${escapeHtml(src.name)}${index === preferredIndex ? ' <em>Préférée</em>' : ''}</span>
      <b>${escapeHtml(src.quality)}</b>`;
    btn.onclick = () => playSource(index);
    box.appendChild(btn);
  });
  renderSourceStatus(streams[preferredIndex], 'Prêt à lire', 'La source prioritaire est sélectionnée automatiquement selon tes préférences.');
  updateSourceToolState();
}

function playSource(index) {
  if (!streams[index]) return;

  selectedIndex = index;
  const attemptId = ++sourceAttemptId;
  const prefs = MadradorStorage.getPrefs();
  $('player').src = streams[index].url;
  $('player').classList.add('active');
  $('placeholder').classList.add('hidden');
  $('openSource').disabled = false;
  $('copySource').disabled = false;

  const continueItem = {
    ...currentMedia,
    lastSource: streams[index].provider || streams[index].name,
    updatedAt: Date.now()
  };

  if (contentType === 'series') {
    const season = seasons[selectedSeasonIndex];
    const episode = season?.episodes?.[selectedEpisodeIndex];
    continueItem.season = season?.number;
    continueItem.episode = episode?.number;
    continueItem.version = selectedSeriesVersion;
    continueItem.episodeTitle = episode?.title;
    if (season && episode) {
      saveSeriesProgress(season, episode, { markWatched: true, addContinue: false });
      renderEpisodeList();
    }
  }

  MadradorStorage.addContinue(continueItem);
  if (prefs.miniPlayerEnabled) {
    MadradorStorage.setMiniPlayer({
      ...continueItem,
      sourceUrl: streams[index].url,
      sourceName: streams[index].name,
      playerUrl: location.href,
      savedAt: Date.now()
    });
  }

  if (prefs.rememberLastSource) {
    MadradorStorage.setPrefs({ lastSource: streams[index].provider || streams[index].name });
  }

  document.querySelectorAll('.source-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === selectedIndex);
  });
  renderSourceStatus(streams[index], 'Chargement du lecteur', 'Connexion à la source en cours. Si rien ne s’affiche, Madrador te proposera une autre source.');
  updateSourceToolState();
  watchSourceLoad(attemptId);

  $('screen').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetPlayerFrame() {
  sourceAttemptId++;
  window.clearTimeout(watchSourceLoad.timer);
  $('player').src = '';
  $('player').classList.remove('active');
  $('placeholder').classList.remove('hidden');
  $('openSource').disabled = true;
  if (streams.length) {
    renderSourceStatus(streams[getPreferredSourceIndex()], 'Prêt à lire', 'Choisis une source ou utilise Lire maintenant.');
  }
  updateSourceToolState();
}

function handlePlayerLoad() {
  window.clearTimeout(watchSourceLoad.timer);
  if (selectedIndex < 0 || !$('player').classList.contains('active')) return;
  renderSourceStatus(streams[selectedIndex], 'Lecteur chargé', getSourceHelpText(streams[selectedIndex]));
}

function autoplayPreferredSource() {
  if (!streams.length) return;

  const index = getPreferredSourceIndex();
  const prefs = MadradorStorage.getPrefs();

  if (prefs.autoplay) {
    playSource(index);
  } else {
    selectedIndex = index;
    document.querySelectorAll('.source-btn').forEach((btn, idx) => btn.classList.toggle('active', idx === index));
    $('openSource').disabled = !streams[index]?.url;
    updateSourceToolState();
  }
}

function getPreferredSourceIndex() {
  const prefs = MadradorStorage.getPrefs();
  const progress = prefs.resumePlayback && contentType === 'series' ? getSeriesProgress() : null;
  const progressSource = prefs.rememberLastSource && progress?.version === selectedSeriesVersion ? progress.source : '';
  const preferred = normalizeProvider(prefs.preferredSource || progressSource || prefs.lastSource || 'vidzy');
  const preferredIndex = streams.findIndex((source) => source.provider === preferred || normalizeProvider(source.name).includes(preferred));
  if (preferredIndex >= 0) return preferredIndex;
  for (const provider of SOURCE_PRIORITY) {
    const index = streams.findIndex((source) => source.provider === provider);
    if (index >= 0) return index;
  }
  return 0;
}

function getProviderRank(source) {
  const rank = SOURCE_PRIORITY.indexOf(source.provider);
  return rank >= 0 ? rank : SOURCE_PRIORITY.length + 1;
}

function playRelativeSource(direction) {
  if (!streams.length) return;
  const start = selectedIndex >= 0 ? selectedIndex : getPreferredSourceIndex();
  const next = (start + direction + streams.length) % streams.length;
  playSource(next);
}

async function copyCurrentSource() {
  const src = streams[selectedIndex];
  if (!src?.url) return;
  try {
    await navigator.clipboard.writeText(src.url);
    showPlayerNotice('Lien source copié');
  } catch (err) {
    showPlayerNotice('Copie indisponible');
  }
}

function openCurrentSource() {
  const src = streams[selectedIndex] || streams[getPreferredSourceIndex()];
  if (src?.url) {
    window.open(src.url, '_blank', 'noopener,noreferrer');
    showPlayerNotice('Source ouverte dans un nouvel onglet');
  } else {
    showPlayerNotice('Aucune source à ouvrir');
  }
}

async function playNextEpisode() {
  if (contentType !== 'series') return;
  const season = seasons[selectedSeasonIndex];
  if (!season?.episodes?.length) return;
  if (selectedEpisodeIndex + 1 < season.episodes.length) {
    await selectEpisode(selectedEpisodeIndex + 1, true);
    return;
  }
  if (selectedSeasonIndex + 1 < seasons.length) {
    await selectSeason(selectedSeasonIndex + 1);
    await selectEpisode(0, true);
  }
}

function updateSourceToolState() {
  const hasSources = streams.length > 0;
  $('prevSource').disabled = !hasSources || streams.length < 2;
  $('nextSource').disabled = !hasSources || streams.length < 2;
  $('copySource').disabled = !hasSources || selectedIndex < 0;
  $('openSource').disabled = !hasSources;
  updateEpisodeNowPanel();
}

function hasNextEpisode() {
  if (contentType !== 'series') return false;
  const season = seasons[selectedSeasonIndex];
  if (!season?.episodes?.length) return false;
  return selectedEpisodeIndex + 1 < season.episodes.length || selectedSeasonIndex + 1 < seasons.length;
}

function showPlayerNotice(message) {
  let notice = document.getElementById('playerNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'playerNotice';
    notice.className = 'toast';
    document.body.appendChild(notice);
  }
  notice.textContent = message;
  notice.classList.remove('hidden');
  window.clearTimeout(showPlayerNotice.timer);
  showPlayerNotice.timer = window.setTimeout(() => notice.classList.add('hidden'), 1700);
}

function renderSourceStatus(source, title, message, actions = []) {
  const box = $('sourceStatus');
  if (!box) return;
  const provider = source?.provider || normalizeProvider(source?.name || '');
  const icon = provider === 'vidzy'
    ? 'fa-circle-check'
    : source
      ? 'fa-shield-halved'
      : 'fa-circle-info';
  box.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <div>
      <strong>${escapeHtml(title)}${source?.name ? ` • ${escapeHtml(source.name)}` : ''}</strong>
      <p>${escapeHtml(message)}</p>
      ${actions.length ? `
        <div class="source-status-actions">
          ${actions.map((action, index) => `
            <button class="status-action" type="button" data-status-action="${index}" ${action.disabled ? 'disabled' : ''}>
              <i class="fa-solid ${escapeHtml(action.icon)}"></i><span>${escapeHtml(action.label)}</span>
            </button>
          `).join('')}
        </div>` : ''}
    </div>
  `;
  actions.forEach((action, index) => {
    const btn = box.querySelector(`[data-status-action="${index}"]`);
    if (btn && !action.disabled) btn.addEventListener('click', action.action);
  });
}

function getSourceHelpText(source) {
  if (!source) return 'Aucune source sélectionnée.';
  if (streams[selectedIndex] && selectedIndex === getPreferredSourceIndex()) return 'Source préférée. Si l’image reste noire, utilise Source suivante.';
  return 'Si ce lecteur bloque ou ouvre une publicité, utilise Source suivante ou Ouvrir la source.';
}

function watchSourceLoad(attemptId) {
  window.clearTimeout(watchSourceLoad.timer);
  watchSourceLoad.timer = window.setTimeout(() => {
    if (attemptId !== sourceAttemptId || selectedIndex < 0 || !$('player').classList.contains('active')) return;
    const prefs = MadradorStorage.getPrefs();
    const canFallback = prefs.autoSourceFallback && streams.length > 1 && automaticFallbacks < streams.length - 1;
    renderSourceStatus(
      streams[selectedIndex],
      canFallback ? 'Source lente, changement automatique' : 'Lecture à vérifier',
      canFallback
        ? 'Madrador essaie automatiquement le lecteur suivant.'
        : 'Si l’image reste noire ou si une publicité bloque le lecteur, change de source ou ouvre-la dans un nouvel onglet.',
      [
        { label: 'Source suivante', icon: 'fa-forward-step', action: () => playRelativeSource(1), disabled: streams.length < 2 },
        { label: 'Ouvrir', icon: 'fa-up-right-from-square', action: () => openCurrentSource(), disabled: !streams[selectedIndex]?.url }
      ]
    );
    if (canFallback) {
      automaticFallbacks += 1;
      showPlayerNotice('Source lente : passage au lecteur suivant.');
      window.setTimeout(() => {
        if (attemptId === sourceAttemptId) playRelativeSource(1);
      }, 1200);
    } else {
      showPlayerNotice('Lecteur à vérifier : essaie Source suivante si besoin.');
    }
  }, 7000);
}

function toggleFavorite() {
  if (!currentMedia) return;

  if (MadradorStorage.isFavorite(currentMedia.id)) {
    MadradorStorage.removeFavorite(currentMedia.id);
  } else {
    MadradorStorage.addFavorite(currentMedia);
  }

  renderFavoriteButton();
}

function renderFavoriteButton() {
  const btn = $('favoriteBtn');
  const active = currentMedia && MadradorStorage.isFavorite(currentMedia.id);
  btn.classList.toggle('is-favorite', active);
  btn.innerHTML = active
    ? '<i class="fa-solid fa-heart"></i><span>Dans ma liste</span>'
    : '<i class="fa-regular fa-heart"></i><span>Favori</span>';
}

function normalizeProvider(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function openTrailer() {
  if (!trailerUrl) return;
  $('trailerExternal').href = trailerWatchUrl || trailerUrl;
  $('trailerFrame').src = trailerUrl;
  $('trailerModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
}

function closeTrailer() {
  $('trailerFrame').src = '';
  $('trailerModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
}

function normalizeTrailerUrl(url) {
  if (!url) return { embed: '', watch: '' };

  const cleanUrl = String(url).trim();
  const directId = cleanUrl.replace(/^\/+/, '');

  if (/^[A-Za-z0-9_-]{11}$/.test(directId)) {
    return getYoutubeTrailerUrls(directId);
  }

  try {
    const parsed = new URL(cleanUrl, location.origin);
    if (parsed.hostname.includes('youtube.com')) {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return getYoutubeTrailerUrls(videoId);
      const embedMatch = parsed.pathname.match(/\/embed\/([A-Za-z0-9_-]{11})/);
      if (embedMatch) return getYoutubeTrailerUrls(embedMatch[1]);
    }
    if (parsed.hostname.includes('youtu.be')) {
      const videoId = parsed.pathname.replace('/', '');
      if (videoId) return getYoutubeTrailerUrls(videoId);
    }
    if (parsed.origin === location.origin) {
      const localId = parsed.pathname.replace(/^\/+/, '');
      if (/^[A-Za-z0-9_-]{11}$/.test(localId)) {
        return getYoutubeTrailerUrls(localId);
      }
    }
  } catch (err) {
    return { embed: cleanUrl, watch: cleanUrl };
  }

  return { embed: cleanUrl, watch: cleanUrl };
}

function getYoutubeTrailerUrls(videoId) {
  return {
    embed: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
    watch: `https://www.youtube.com/watch?v=${videoId}`
  };
}

function setError(msg) {
  $('title').textContent = 'Erreur';
  $('desc').textContent = msg;
  $('seriesPanel').classList.add('hidden');
  $('sources').innerHTML = `<div class="source-empty">${escapeHtml(msg)}</div>`;
  $('sourceCount').textContent = '0';
  $('playFirst').disabled = true;
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return location.protocol + url;
  return url;
}

function getApiId(value) {
  const clean = String(value || '').trim();
  const numericPrefix = clean.match(/^\d+/);
  return numericPrefix ? numericPrefix[0] : clean;
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

function bindImageFallback(root, options = {}) {
  root.querySelectorAll('img').forEach((img) => {
    img.addEventListener('error', () => {
      if (options.removeOnly) {
        img.remove();
        return;
      }
      replaceBrokenImage(img);
    }, { once: true });
  });
}

function replaceBrokenImage(img) {
  const fallback = document.createElement('div');
  fallback.className = 'no-poster image-fallback';
  fallback.innerHTML = '<i class="fa-solid fa-film"></i>';
  img.replaceWith(fallback);
}
