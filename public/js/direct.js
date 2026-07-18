const DIRECT_KEY = 'madrador:direct:recent';
const DIRECT_CHANNELS_KEY = 'madrador:direct:channels:madrador-no-ads-v6';
const DIRECT_PLAYLIST_KEY = 'madrador:direct:playlist';
const DIRECT_FAVORITES_KEY = 'madrador:direct:favorites';
const DIRECT_SOURCE_PREF_KEY = 'madrador:direct:source-preferences';
const DIRECT_HEALTH_KEY = 'madrador:direct:health-v1';
const DIRECT_HEALTH_TTL = 6 * 60 * 60 * 1000;
const DIRECT_BATCH_SIZE = 72;
const ALLOWED_HOSTS = ['cdnlivetv.tv', 'event.vedge.infomaniak.com'];
const BLOCKED_DIRECT_HOSTS = ['hesgoaler.com', 'livelive24.com', 'cartelive.club', 'freeshot.sbs', 'livewatch.top'];
const DIRECT_LANGUAGE_LABELS = {
  fra: 'Français', eng: 'Anglais', ara: 'Arabe', deu: 'Allemand', spa: 'Espagnol', ita: 'Italien',
  bul: 'Bulgare', ell: 'Grec', fas: 'Persan', gsw: 'Suisse allemand', kur: 'Kurde', pus: 'Pachto',
  prd: 'Dari', por: 'Portugais', rus: 'Russe', tur: 'Turc', nld: 'Néerlandais', ron: 'Roumain',
  pol: 'Polonais', ukr: 'Ukrainien', ber: 'Berbère', wol: 'Wolof'
};
const $ = (id) => document.getElementById(id);
let directChannels = [];
let directPlaylist = [];
let activeDirectCategory = 'Toutes';
let activeDirectView = 'france';
let currentDirectChannel = null;
let visibleDirectChannels = [];
let directRenderLimit = DIRECT_BATCH_SIZE;
let activeHls = null;
let selectedDirectSourceIndex = 0;
let directEpgRequestId = 0;
const directHealthQueue = [];
const directHealthCache = new Map();
let directHealthRunning = false;
let directHealthObserver = null;
let directPlaybackToken = 0;
const attemptedDirectSources = new Set();
const directSourceStates = new Map();
let iptvOrgLastSyncLabel = '';
let directStatusRefreshTimer = 0;

window.addEventListener('DOMContentLoaded', () => {
  restoreDirectHealthCache();
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directFile')?.addEventListener('change', handleDirectFile);
  $('directChannelsReload')?.addEventListener('click', () => loadDirectChannels(true));
  $('directChannelSearch')?.addEventListener('input', () => {
    directRenderLimit = DIRECT_BATCH_SIZE;
    renderDirectChannels();
  });
  ['directCountryFilter', 'directLanguageFilter', 'directQualityFilter', 'directProviderFilter', 'directAvailabilityFilter'].forEach((id) => $(id)?.addEventListener('change', () => {
    directRenderLimit = DIRECT_BATCH_SIZE;
    renderDirectChannels();
  }));
  $('directPlaylistSearch')?.addEventListener('input', renderDirectPlaylist);
  $('directPlaylistClear')?.addEventListener('click', clearDirectPlaylist);
  $('directSourceToggle')?.addEventListener('click', toggleDirectTools);
  $('directToolsClose')?.addEventListener('click', () => setDirectToolsOpen(false));
  $('directFavoriteChannel')?.addEventListener('click', toggleCurrentChannelFavorite);
  $('directPrevChannel')?.addEventListener('click', () => playRelativeChannel(-1));
  $('directNextChannel')?.addEventListener('click', () => playRelativeChannel(1));
  $('directFullscreen')?.addEventListener('click', enterDirectFullscreen);
  $('directNextSource')?.addEventListener('click', playNextChannelSource);
  $('directReloadSource')?.addEventListener('click', reloadCurrentChannelSource);
  $('directEpgRefresh')?.addEventListener('click', () => currentDirectChannel && loadChannelEpg(currentDirectChannel, true));
  $('directViewTabs')?.addEventListener('click', handleDirectViewClick);
  $('directLoadMore')?.addEventListener('click', () => {
    directRenderLimit += DIRECT_BATCH_SIZE;
    renderDirectChannels();
  });
  $('directClear')?.addEventListener('click', () => {
    $('directUrl').value = '';
    setHint('API locale : /api/direct/resolve');
    $('directUrl').focus();
  });
  $('directReset')?.addEventListener('click', () => {
    localStorage.removeItem(DIRECT_KEY);
    renderRecent();
    showToast('Directs effacés');
  });
  $('directUrl')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') playFromInput();
  });
  window.addEventListener('keydown', handleDirectKeyboard);
  window.addEventListener('pagehide', destroyDirectPlayback);
  enableHorizontalRail($('directViewTabs'));
  enableHorizontalRail($('directCategoryTabs'));

  renderRecent();
  loadCachedPlaylist();
  loadCachedChannels();
  const last = getRecent()[0];
  if (last?.url) $('directUrl').value = last.url;
  window.setTimeout(() => loadDirectChannels(false), 200);
});

function toggleDirectTools() {
  setDirectToolsOpen($('directTools')?.hidden !== false);
}

function setDirectToolsOpen(open) {
  const tools = $('directTools');
  if (!tools) return;
  tools.hidden = !open;
  $('directSourceToggle')?.setAttribute('aria-expanded', String(open));
  if (open) tools.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function handleDirectViewClick(event) {
  const button = event.target.closest('[data-direct-view]');
  if (!button) return;
  activeDirectView = button.dataset.directView;
  activeDirectCategory = 'Toutes';
  directRenderLimit = DIRECT_BATCH_SIZE;
  renderDirectChannels();
}

function handleDirectKeyboard(event) {
  if (event.target.matches('input,textarea,select')) return;
  const previousKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'ChannelDown', 'MediaTrackPrevious'];
  const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', 'ChannelUp', 'MediaTrackNext'];
  if (previousKeys.includes(event.key)) {
    event.preventDefault();
    playRelativeChannel(-1);
  }
  if (nextKeys.includes(event.key)) {
    event.preventDefault();
    playRelativeChannel(1);
  }
  if (event.key.toLowerCase() === 'f') enterDirectFullscreen();
}

function enableHorizontalRail(element) {
  if (!element) return;
  element.addEventListener('wheel', (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: 'smooth' });
  }, { passive: false });
}

async function playFromInput() {
  const raw = String($('directUrl')?.value || '').trim();
  const importedChannels = parseChannelsPayload(raw);
  if (importedChannels.length) {
    installImportedChannels(importedChannels);
    playChannel(importedChannels[0]);
    showToast(`${importedChannels.length} chaînes importées`);
    return;
  }

  if (isChannelsApiUrl(raw)) {
    const channels = await loadDirectChannels(true);
    if (channels.length) playChannel(channels[0]);
    return;
  }

  const direct = await resolveDirect({ url: raw });
  if (!direct.ok) {
    showToast('Colle une URL valide');
    return;
  }
  if (direct.type === 'playlist') {
    await loadDirectPlaylist({ url: direct.url });
    return;
  }
  $('directUrl').value = direct.url;
  playUrl(direct.url, direct);
  saveRecent(direct.url, direct);
  renderRecent();
}

async function openFromInput() {
  const popup = window.open('about:blank', '_blank', 'noopener,noreferrer');
  const direct = await resolveDirect({ url: $('directUrl').value });
  if (!direct.ok) {
    popup?.close();
    showToast('Colle une URL valide');
    return;
  }
  $('directUrl').value = direct.url;
  saveRecent(direct.url, direct);
  renderRecent();
  if (popup) popup.location.href = direct.url;
  else window.open(direct.url, '_blank', 'noopener,noreferrer');
}

async function handleDirectFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    if (file.size > 1024 * 1024) {
      showToast('Fichier trop grand');
      event.target.value = '';
      return;
    }

    setHint(`Lecture de ${file.name}...`);
    const content = await file.text();
    const importedChannels = parseChannelsPayload(content);
    if (importedChannels.length) {
      installImportedChannels(importedChannels);
      playChannel(importedChannels[0]);
      showToast(`${importedChannels.length} chaînes importées`);
      return;
    }
    if (/\.m3u$/i.test(file.name) || /^#EXTM3U/i.test(content)) {
      await loadDirectPlaylist({ content, filename: file.name });
      return;
    }
    const direct = await resolveDirect({ content, filename: file.name });
    if (!direct.ok) {
      showToast('Aucune URL trouvée dans le fichier');
      setHint('Aucune URL valide trouvée');
      return;
    }

    $('directUrl').value = direct.url;
    playUrl(direct.url, direct);
    saveRecent(direct.url, direct);
    renderRecent();
    setHint(`${file.name} -> ${direct.hostname || direct.title}`);
  } catch (error) {
    console.error(error);
    showToast('Impossible de lire le fichier');
    setHint('Erreur lecture fichier');
  } finally {
    event.target.value = '';
  }
}

function playUrl(url, direct = {}, lifecycle = {}) {
  const screen = $('directScreen');
  destroyDirectPlayback();
  const playbackToken = ++directPlaybackToken;
  const startedAt = Date.now();
  let settled = false;
  const ready = () => {
    if (settled || playbackToken !== directPlaybackToken) return;
    settled = true;
    window.clearTimeout(readinessTimer);
    lifecycle.onReady?.(Date.now() - startedAt);
  };
  const fail = (message) => {
    if (settled || playbackToken !== directPlaybackToken) return;
    settled = true;
    window.clearTimeout(readinessTimer);
    lifecycle.onFailure?.(message);
  };
  const readinessTimer = window.setTimeout(() => fail('Le lecteur ne répond pas dans le délai prévu.'), Number(lifecycle.timeout) || 14000);
  const type = direct.type || getDirectType(url);

  if (type === 'hls' || type === 'video') {
    const video = document.createElement('video');
    video.className = 'direct-frame direct-video';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', '');
    screen.appendChild(video);

    if (type === 'hls' && window.Hls?.isSupported()) {
      activeHls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
      let manifestParsed = false;
      let fragmentLoaded = false;
      let baselineTime = 0;
      let mediaRecoveryAttempted = false;
      const confirmProgress = () => {
        if (!manifestParsed || !fragmentLoaded) return;
        if (Number(video.currentTime) > baselineTime + 0.2) ready();
      };
      video.addEventListener('timeupdate', confirmProgress);
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          fail('Flux HLS indisponible.');
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          if (!mediaRecoveryAttempted) {
            mediaRecoveryAttempted = true;
            activeHls.recoverMediaError();
          } else {
            fail('Le flux HLS utilise un format vidéo non pris en charge.');
          }
        } else {
          destroyActiveHls();
          fail('Le lecteur HLS a rencontré une erreur fatale.');
        }
      });
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        baselineTime = Number(video.currentTime) || 0;
        video.play().catch(() => setHint('Flux prêt. Appuie sur Lecture pour démarrer.'));
      });
      activeHls.on(window.Hls.Events.FRAG_LOADED, () => {
        fragmentLoaded = true;
        baselineTime = Number(video.currentTime) || 0;
      });
    } else {
      video.src = url;
      let mediaLoaded = false;
      let baselineTime = 0;
      video.addEventListener('loadeddata', () => {
        mediaLoaded = true;
        baselineTime = Number(video.currentTime) || 0;
      }, { once: true });
      video.addEventListener('timeupdate', () => {
        if (mediaLoaded && Number(video.currentTime) > baselineTime + 0.2) ready();
      });
      video.addEventListener('error', () => fail('Flux vidéo indisponible.'), { once: true });
      video.play().catch(() => setHint('Flux prêt. Appuie sur Lecture pour démarrer.'));
    }
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'direct-frame';
    frame.src = url;
    frame.title = `Direct ${direct.name || direct.title || 'Madrador TV'}`;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
    frame.addEventListener('load', () => {
      setHint('Page du lecteur chargée, vérification de la lecture en cours...');
    }, { once: true });
    frame.addEventListener('error', () => fail('Lecteur intégré indisponible.'), { once: true });
    screen.appendChild(frame);
  }

  setHint(`Lecture : ${direct.name || direct.title || getTitleFromUrl(url)}`);
  if (!currentDirectChannel || currentDirectChannel.url !== direct.url) setCurrentChannel({ ...direct, url });
  showToast('Direct lancé');
}

function destroyDirectPlayback() {
  directPlaybackToken += 1;
  destroyActiveHls();
  const screen = $('directScreen');
  if (!screen) return;
  screen.querySelectorAll('video').forEach((video) => {
    video.pause();
    video.removeAttribute('src');
    video.load();
  });
  screen.querySelectorAll('iframe').forEach((frame) => {
    frame.src = 'about:blank';
  });
  screen.replaceChildren();
}

async function loadDirectPlaylist(payload) {
  setHint('Analyse de la playlist...');
  try {
    const response = await fetch('/api/direct/playlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
      throw new Error(data?.error || 'Playlist invalide');
    }

    directPlaylist = data.items;
    localStorage.setItem(DIRECT_PLAYLIST_KEY, JSON.stringify({
      title: data.filename || 'Playlist importée',
      items: directPlaylist.slice(0, 1000)
    }));
    showDirectPlaylist(data.filename || 'Playlist importée');
    if (directPlaylist[0]) playChannel(directPlaylist[0]);
    showToast(`${directPlaylist.length} flux importés`);
    return directPlaylist;
  } catch (error) {
    console.error(error);
    setHint(error.message || 'Impossible de lire la playlist');
    showToast('Playlist illisible');
    return [];
  }
}

function loadCachedPlaylist() {
  try {
    const cached = JSON.parse(localStorage.getItem(DIRECT_PLAYLIST_KEY) || '{}');
    if (!Array.isArray(cached.items) || !cached.items.length) return;
    directPlaylist = cached.items;
    showDirectPlaylist(cached.title || 'Playlist récente');
  } catch {}
}

function showDirectPlaylist(title) {
  const panel = $('directPlaylistPanel');
  if (panel) panel.hidden = false;
  if ($('directPlaylistTitle')) $('directPlaylistTitle').textContent = `${title} · ${directPlaylist.length}`;
  renderDirectPlaylist();
}

function clearDirectPlaylist() {
  directPlaylist = [];
  localStorage.removeItem(DIRECT_PLAYLIST_KEY);
  if ($('directPlaylistSearch')) $('directPlaylistSearch').value = '';
  if ($('directPlaylistPanel')) $('directPlaylistPanel').hidden = true;
  showToast('Playlist fermée');
}

function renderDirectPlaylist() {
  const box = $('directPlaylistList');
  if (!box) return;
  const query = String($('directPlaylistSearch')?.value || '').trim().toLowerCase();
  const items = directPlaylist.filter((item) => (
    !query || `${item.name || item.title} ${item.group || ''} ${item.language || ''}`.toLowerCase().includes(query)
  )).slice(0, 200);

  if (!items.length) {
    box.innerHTML = '<div class="direct-empty"><i class="fa-solid fa-list"></i><span>Aucun flux trouvé.</span></div>';
    return;
  }

  box.innerHTML = items.map((item) => `
    <button class="direct-channel" type="button" data-playlist-url="${escapeHtml(item.url)}">
      <span class="direct-channel-logo">
        <span class="direct-logo-fallback">${escapeHtml(getChannelInitials(item.name || item.title))}</span>
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy">` : ''}
      </span>
      <span class="direct-channel-copy">
        <b>${escapeHtml(item.name || item.title || 'Direct')}</b>
        <small>${escapeHtml(item.group || 'Playlist')} · ${escapeHtml(String(item.type || 'direct').toUpperCase())}</small>
      </span>
      <i class="fa-solid fa-play"></i>
    </button>
  `).join('');

  box.querySelectorAll('[data-playlist-url]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = directPlaylist.find((entry) => entry.url === button.dataset.playlistUrl);
      if (item) {
        focusDirectPlayer();
        playChannel(item);
      }
    });
  });
  bindDirectLogoFallbacks(box);
}

function destroyActiveHls() {
  if (!activeHls) return;
  try {
    activeHls.destroy();
  } catch {}
  activeHls = null;
}

function renderRecent() {
  const box = $('directList');
  const items = getRecent();
  if (!items.length) {
    box.innerHTML = `
      <div class="direct-empty">
        <i class="fa-solid fa-clock"></i>
        <span>Aucun direct récent</span>
      </div>`;
    return;
  }

  box.innerHTML = items.map((item) => `
    <button class="direct-item" type="button" data-url="${escapeHtml(item.url)}">
      <i class="fa-solid fa-play"></i>
      <span>
        <b>${escapeHtml(item.title)}</b>
        <small>${escapeHtml(item.url)}</small>
      </span>
    </button>
  `).join('');

  box.querySelectorAll('[data-url]').forEach((button) => {
    button.addEventListener('click', () => {
      const url = button.dataset.url;
      const item = items.find((entry) => entry.url === url) || {};
      $('directUrl').value = url;
      focusDirectPlayer();
      playChannel(item);
    });
  });
}

function loadCachedChannels() {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECT_CHANNELS_KEY) || '[]');
    if (Array.isArray(data) && data.length) {
      directChannels = getFrenchChannels(data);
      renderDirectChannels();
      setHint(`${directChannels.length} chaînes françaises prêtes depuis le cache local`);
    }
  } catch {}
}

async function loadDirectChannels(force = false) {
  const button = $('directChannelsReload');
  button?.classList.add('loading');
  if (button) button.disabled = true;
  setChannelsState('Préparation des chaînes françaises...');

  try {
    let cdnChannels = [];
    let publicMadradorChannels = [];
    let iptvOrgChannels = [];
    try {
      const response = await fetch('/api/direct/channels', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'API CDNLiveTV indisponible');
      const frenchApiChannels = getFrenchChannels(Array.isArray(data.channels) ? data.channels : []);
      cdnChannels = groupChannels(frenchApiChannels.map((channel) => ({
        ...channel,
        category: channel.category || classifyChannel(channel),
        logo: getReliableChannelLogo(channel) || channel.image
      })));
    } catch (apiError) {
      console.warn('[DIRECT] CDNLiveTV indisponible, catalogue local conservé.', apiError);
    }
    try {
      const response = await fetch('./data/madrador-public-channels.json', { cache: force ? 'reload' : 'default' });
      const data = await response.json();
      publicMadradorChannels = groupChannels((Array.isArray(data) ? data : []).map((channel) => ({
        name: channel.channel_name,
        category: channel.category,
        url: channel.url,
        logo: channel.image,
        code: 'fr',
        country: 'FR'
      })));
    } catch (publicSourceError) {
      console.warn('[DIRECT] Sources publiques Madrador indisponibles.', publicSourceError);
    }
    try {
      iptvOrgChannels = await loadIptvOrgChannels(force);
    } catch (iptvOrgError) {
      console.warn('[DIRECT] IPTV-org indisponible, catalogue Madrador conservé.', iptvOrgError);
      showToast('IPTV-org indisponible : dernière liste Madrador conservée');
    }
    const madradorChannels = mergeGroupedChannels(cdnChannels, publicMadradorChannels);
    directChannels = mergeGroupedChannels(madradorChannels, iptvOrgChannels);
    localStorage.setItem(DIRECT_CHANNELS_KEY, JSON.stringify(madradorChannels.slice(0, 800)));
    if ($('directChannelTotal')) $('directChannelTotal').textContent = `${directChannels.length} chaînes disponibles`;
    renderDirectChannels();
    setHint(`${directChannels.length} chaînes chargées${iptvOrgLastSyncLabel ? ` · IPTV-org ${iptvOrgLastSyncLabel}` : ''}`);
    return directChannels;
  } catch (error) {
    console.error(error);
    setChannelsState('Impossible de charger les chaînes pour le moment.');
    showToast('API chaînes indisponible');
    return directChannels;
  } finally {
    button?.classList.remove('loading');
    if (button) button.disabled = false;
  }
}

async function loadIptvOrgChannels(force = false) {
  const channels = [];
  let offset = 0;
  let hasMore = true;
  let updatedAt = null;
  while (hasMore && offset < 2000) {
    const response = await fetch(`/api/direct/iptv-org/channels?scope=all&offset=${offset}&limit=500&schema=3`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'Catalogue IPTV-org indisponible');
    updatedAt = data.updatedAt || updatedAt;
    channels.push(...(data.channels || []));
    offset += data.count || 0;
    hasMore = Boolean(data.hasMore && data.count);
  }
  if (updatedAt) {
    const date = new Date(updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    iptvOrgLastSyncLabel = `synchronisé le ${date}`;
    $('directChannelsReload')?.setAttribute('title', `IPTV-org synchronisé le ${date}`);
  }
  return channels.map((channel) => ({
    ...channel,
    catalog: 'iptv-org',
    provenance: 'IPTV-org',
    code: String(channel.country || 'fr').toLowerCase(),
    country: channel.country || 'FR',
    image: channel.logo || '',
    url: channel.sources?.find((source) => source.playable)?.url || channel.sources?.[0]?.url || '',
    status: 'unknown',
    sources: (channel.sources || []).map((source) => ({
      ...source,
      provider: source.provider || 'IPTV-org',
      provenance: 'IPTV-org',
      catalog: 'iptv-org',
      name: source.name || `${source.provider || 'IPTV-org'}${source.quality ? ` · ${source.quality}` : ''}`
    }))
  }));
}

function renderDirectChannels() {
  const box = $('directChannelList');
  if (!box) return;
  const query = String($('directChannelSearch')?.value || '').trim().toLowerCase();
  const normalized = directChannels.map((channel) => ({
    ...channel,
    category: channel.category || classifyChannel(channel),
    image: channel.logo || channel.image || getReliableChannelLogo(channel)
  }));
  const favoriteKeys = getDirectFavorites();
  const recentOrder = new Map(getRecent().map((item, index) => [getChannelKey(item), index]));
  const viewChannels = normalized
    .filter((channel) => !['france', 'francophone', 'international'].includes(activeDirectView) || getDirectChannelScope(channel) === activeDirectView)
    .filter((channel) => activeDirectView !== 'functional' || (channel.sources || []).some((source) => ['available', 'slow'].includes(source.status) || ['available', 'slow'].includes(directHealthCache.get(source.url)?.state)))
    .filter((channel) => activeDirectView !== 'favorites' || favoriteKeys.has(getChannelKey(channel)))
    .filter((channel) => activeDirectView !== 'recent' || recentOrder.has(getChannelKey(channel)));
  renderDirectCategoryTabs(viewChannels);
  renderDirectMetadataFilters(viewChannels);
  const language = $('directLanguageFilter')?.value || '';
  const country = $('directCountryFilter')?.value || '';
  const quality = $('directQualityFilter')?.value || '';
  const provider = $('directProviderFilter')?.value || '';
  const availability = $('directAvailabilityFilter')?.value || '';
  let filtered = viewChannels
    .filter((channel) => activeDirectCategory === 'Toutes' || channel.category === activeDirectCategory)
    .filter((channel) => !query || `${channel.name} ${(channel.altNames || []).join(' ')} ${channel.code} ${channel.country} ${channel.category}`.toLowerCase().includes(query))
    .filter((channel) => !country || String(channel.country || channel.code || '').toUpperCase() === country)
    .filter((channel) => !language || (channel.languages || []).includes(language) || (channel.sources || []).some((source) => (source.languages || []).includes(language)))
    .filter((channel) => !quality || (channel.sources || []).some((source) => String(source.quality || '').toLowerCase() === quality))
    .filter((channel) => !provider || (channel.sources || []).some((source) => normalizeProviderFilterValue(source.provider) === provider))
    .filter((channel) => !availability || channelMatchesAvailability(channel, availability));
  if (activeDirectView === 'recent') {
    filtered = filtered.sort((a, b) => recentOrder.get(getChannelKey(a)) - recentOrder.get(getChannelKey(b)));
  }
  visibleDirectChannels = filtered;
  if ($('directResultCount')) $('directResultCount').textContent = `${filtered.length} résultat${filtered.length > 1 ? 's' : ''}`;
  renderDirectViewTabs(normalized, favoriteKeys, recentOrder);
  const totalFiltered = filtered.length;
  const displayedChannels = filtered.slice(0, directRenderLimit);
  const loadMore = $('directLoadMore');
  if (loadMore) {
    loadMore.classList.toggle('hidden', displayedChannels.length >= totalFiltered);
    loadMore.querySelector('span').textContent = `Afficher plus · ${displayedChannels.length}/${totalFiltered}`;
  }

  if (!displayedChannels.length) {
    setChannelsState(directChannels.length ? 'Aucune chaîne trouvée.' : 'Charge les chaînes pour regarder la TV en direct.');
    return;
  }

  const groups = displayedChannels.reduce((result, channel) => {
    (result[channel.category] ||= []).push(channel);
    return result;
  }, {});

  box.innerHTML = Object.entries(groups).map(([category, channels]) => `
    <section class="direct-channel-group">
      <header><h3>${escapeHtml(category)}</h3><span>${channels.length} chaînes</span></header>
      <div class="direct-channel-grid">
        ${channels.map((channel) => `
          <article class="direct-channel-tile ${getChannelKey(currentDirectChannel) === getChannelKey(channel) ? 'is-playing' : ''}">
            <button class="direct-channel direct-channel-card" type="button" data-channel-id="${escapeHtml(channel.id || '')}" data-url="${escapeHtml(channel.url)}" data-name="${escapeHtml(channel.name)}" data-health-url="${escapeHtml(channel.url)}" data-health="${escapeHtml(getChannelHealthState(channel))}">
              <span class="direct-channel-logo ${getChannelLogoClass(channel)}">
                ${getChannelBrandMark(channel)}
                ${channel.image ? `<img src="${escapeHtml(channel.image)}" alt="" loading="lazy">` : ''}
                ${getChannelLogoVariant(channel) ? `<span class="direct-logo-variant">${escapeHtml(getChannelLogoVariant(channel))}</span>` : ''}
              </span>
              <span class="direct-channel-copy">
                <b>${escapeHtml(channel.name)}</b>
                <small><i class="direct-status ${getChannelHealthState(channel)}"></i><span>${escapeHtml(channel.country || channel.code || 'TV')}</span>${channel.maxQuality ? `<span>${escapeHtml(channel.maxQuality)}</span>` : ''}<span>${channel.sources?.length || 1} source${(channel.sources?.length || 1) > 1 ? 's' : ''}</span><em class="direct-health-label">${escapeHtml(getDirectHealthLabel(getChannelHealthState(channel)))}</em></small>
              </span>
              <i class="fa-solid fa-play"></i>
            </button>
            <button class="direct-card-favorite ${favoriteKeys.has(getChannelKey(channel)) ? 'active' : ''}" type="button" data-favorite-url="${escapeHtml(channel.url)}" aria-label="Favori">
              <i class="fa-${favoriteKeys.has(getChannelKey(channel)) ? 'solid' : 'regular'} fa-heart"></i>
            </button>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');

  box.querySelectorAll('.direct-channel').forEach((button) => {
    button.addEventListener('click', () => {
      const channel = directChannels.find((item) => item.url === button.dataset.url) || {
        url: button.dataset.url,
        name: button.dataset.name,
        title: button.dataset.name,
        type: getDirectType(button.dataset.url)
      };
      focusDirectPlayer();
      playChannel(channel);
    });
  });
  box.querySelectorAll('[data-favorite-url]').forEach((button) => {
    button.addEventListener('click', () => {
      const channel = directChannels.find((item) => item.url === button.dataset.favoriteUrl);
      if (channel) toggleChannelFavorite(channel);
    });
  });
  bindDirectLogoFallbacks(box);
  observeDirectHealth(box);
}

function observeDirectHealth(box) {
  directHealthObserver?.disconnect();
  directHealthQueue.length = 0;
  directHealthObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      directHealthObserver.unobserve(entry.target);
      enqueueDirectHealth(entry.target);
    });
  }, { rootMargin: '120px' });
  box.querySelectorAll('[data-health-url]').forEach((card) => directHealthObserver.observe(card));
}

function enqueueDirectHealth(card) {
  const url = card.dataset.healthUrl;
  if (!url) return;
  if (directHealthCache.has(url)) {
    paintDirectHealth(card, directHealthCache.get(url));
    return;
  }
  if (!directHealthQueue.some((entry) => entry.url === url)) directHealthQueue.push({ url, card });
  runDirectHealthQueue();
}

async function runDirectHealthQueue() {
  if (directHealthRunning || !directHealthQueue.length) return;
  directHealthRunning = true;
  const { url, card } = directHealthQueue.shift();
  try {
    const response = await fetch(`/api/direct/health?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
    const health = await response.json();
    updateDirectSourceState(url, health.state || 'unavailable', health.error || '');
    paintDirectHealth(card, health);
  } catch {
    const health = { state: 'unavailable', checkedAt: new Date().toISOString() };
    updateDirectSourceState(url, health.state, 'Vérification impossible');
    paintDirectHealth(card, health);
  } finally {
    window.setTimeout(() => {
      directHealthRunning = false;
      runDirectHealthQueue();
    }, 700);
  }
}

function paintDirectHealth(card, health) {
  if (!card?.isConnected) return;
  const labels = { available: 'Fonctionnelle', slow: 'Lente', unavailable: 'Indisponible' };
  const state = health?.state || 'unavailable';
  card.dataset.health = state;
  const dot = card.querySelector('.direct-status');
  if (dot) {
    dot.classList.remove('available', 'slow', 'unavailable', 'checking', 'unchecked');
    dot.classList.add(state);
  }
  const label = card.querySelector('.direct-health-label');
  if (label) {
    label.textContent = labels[state] || 'À vérifier';
    label.title = health?.checkedAt ? `Dernière vérification : ${new Date(health.checkedAt).toLocaleString('fr-FR')}` : '';
  }
}

function renderDirectViewTabs(channels, favoriteKeys, recentOrder) {
  const counts = {
    all: channels.length,
    france: channels.filter((channel) => getDirectChannelScope(channel) === 'france').length,
    francophone: channels.filter((channel) => getDirectChannelScope(channel) === 'francophone').length,
    international: channels.filter((channel) => getDirectChannelScope(channel) === 'international').length,
    functional: channels.filter((channel) => (channel.sources || []).some((source) => ['available', 'slow'].includes(source.status) || ['available', 'slow'].includes(directHealthCache.get(source.url)?.state))).length,
    favorites: channels.filter((channel) => favoriteKeys.has(getChannelKey(channel))).length,
    recent: channels.filter((channel) => recentOrder.has(getChannelKey(channel))).length
  };
  $('directViewTabs')?.querySelectorAll('[data-direct-view]').forEach((button) => {
    const view = button.dataset.directView;
    button.classList.toggle('active', view === activeDirectView);
    const labels = { all: 'Toutes', france: 'France', francophone: 'Francophones', international: 'International', functional: 'Fonctionnelles', favorites: 'Favoris', recent: 'Récentes' };
    button.querySelector('span').textContent = `${labels[view]} · ${counts[view]}`;
  });
}

function getDirectChannelScope(channel) {
  if (Array.isArray(channel?.scopes) && channel.scopes.length) {
    if (channel.scopes.includes('france')) return 'france';
    if (channel.scopes.includes('francophone')) return 'francophone';
    return 'international';
  }
  const country = String(channel?.country || channel?.code || '').trim().toUpperCase();
  const languages = channel?.languages || [];
  if (country === 'FR' || country === 'FRANCE') return 'france';
  if (languages.includes('fra')) return 'francophone';
  return 'international';
}

function renderDirectMetadataFilters(channels) {
  const fill = (id, values, labels = {}) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Toutes</option>' + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labels[value] || value.toUpperCase())}</option>`).join('');
    if (values.includes(current)) select.value = current;
  };
  const languages = [...new Set(channels.flatMap((channel) => channel.languages || []).filter(Boolean))].sort();
  const countries = [...new Set(channels.map((channel) => String(channel.country || channel.code || '').toUpperCase()).filter(Boolean))].sort();
  const qualities = [...new Set(channels.flatMap((channel) => (channel.sources || []).map((source) => String(source.quality || '').toLowerCase())).filter(Boolean))].sort();
  const providers = [...new Set(channels.flatMap((channel) => (channel.sources || []).map((source) => normalizeProviderFilterValue(source.provider))).filter(Boolean))].sort();
  fill('directCountryFilter', countries);
  fill('directLanguageFilter', languages, DIRECT_LANGUAGE_LABELS);
  fill('directQualityFilter', qualities);
  fill('directProviderFilter', providers, { 'iptv-org': 'IPTV-org', cdnlivetv: 'CDNLiveTV', infomaniak: 'Infomaniak' });
}

function normalizeProviderFilterValue(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalized.includes('iptv-org')) return 'iptv-org';
  if (normalized.includes('cdnlivetv')) return 'cdnlivetv';
  if (normalized.includes('infomaniak')) return 'infomaniak';
  return normalized;
}

function channelMatchesAvailability(channel, availability) {
  const sources = channel.sources || [];
  if (availability === 'available') return sources.some((source) => ['available', 'slow'].includes(directHealthCache.get(source.url)?.state || source.status));
  if (availability === 'unavailable') return sources.length > 0 && sources.every((source) => (directHealthCache.get(source.url)?.state || source.status) === 'unavailable');
  if (availability === 'geo') return sources.some((source) => source.geoBlocked);
  if (availability === 'intermittent') return sources.some((source) => source.intermittent);
  if (availability === 'unchecked') return sources.some((source) => !directHealthCache.has(source.url) && ['unchecked', 'idle'].includes(source.status || 'idle'));
  return true;
}

function bindDirectLogoFallbacks(scope) {
  scope.querySelectorAll('img').forEach((img) => {
    const removeBrokenImage = () => img.remove();
    if (img.complete && !img.naturalWidth) removeBrokenImage();
    else img.addEventListener('error', removeBrokenImage, { once: true });
  });
}

function getChannelInitials(value) {
  const words = String(value || 'TV').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'TV';
}

function createSlug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/\+/g, '-plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function detectProvider(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    if (hostname === 'cdnlivetv.tv' || hostname.endsWith('.cdnlivetv.tv')) return 'CDNLiveTV';
    if (hostname === 'hesgoaler.com' || hostname.endsWith('.hesgoaler.com')) return 'Hesgoaler';
    if (hostname === 'event.vedge.infomaniak.com') return 'Infomaniak';
    return hostname;
  } catch {
    return 'Source inconnue';
  }
}

function isAllowedSource(url, source = {}) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (BLOCKED_DIRECT_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return false;
    if (source.catalog === 'iptv-org' || source.provenance === 'IPTV-org') return parsed.protocol === 'https:' && source.playable !== false;
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function groupChannels(rawChannels) {
  const grouped = new Map();
  (rawChannels || []).forEach((channel) => {
    const name = String(channel?.name || '').trim();
    const url = String(channel?.url || '').trim();
    if (!name || !isAllowedSource(url) || isDisallowedChannelSource(name, url)) return;
    const key = name.toLocaleLowerCase('fr');
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: createSlug(name), name, category: normalizeChannelCategory(channel.category), code: 'fr', country: 'FR',
        logo: channel.logo || channel.image || '', image: channel.logo || channel.image || '', sources: [], status: 'online'
      });
    }
    const item = grouped.get(key);
    if (!item.sources.some((source) => source.url === url)) {
      item.sources.push({ name: `Source ${item.sources.length + 1}`, provider: detectProvider(url), provenance: 'Madrador', catalog: 'madrador', url });
    }
  });
  return [...grouped.values()].map((channel) => ({ ...channel, url: channel.sources[0]?.url || '' }));
}

function isDisallowedChannelSource(name, value) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
    return /^tf1(?:\s|$)/i.test(String(name || '').trim()) && (hostname === 'hesgoaler.com' || hostname.endsWith('.hesgoaler.com'));
  } catch {
    return true;
  }
}

function normalizeChannelCategory(value) {
  const category = String(value || 'TV').trim();
  if (/^sports?$/i.test(category)) return 'Sports';
  if (/^(france|télévision|television|tv)$/i.test(category)) return 'TV';
  return category;
}

function mergeGroupedChannels(...catalogs) {
  const merged = new Map();
  catalogs.flat().forEach((channel) => {
    const nameKey = getChannelMergeKey(channel?.name);
    const feedSuffix = channel?.feedId && channel.feedId !== 'main' ? `@${String(channel.feedId).toLowerCase()}` : '';
    const apiKey = channel?.catalog === 'iptv-org' && channel.channelId ? `iptv:${String(channel.channelId).toLowerCase()}${feedSuffix}` : '';
    const key = apiKey && !merged.has(nameKey) ? apiKey : nameKey;
    if (!key) return;
    if (!merged.has(key)) {
      merged.set(key, { ...channel, sources: [] });
    }
    const target = merged.get(key);
    target.scopes = [...new Set([...(target.scopes || []), ...(channel.scopes || [])])];
    target.languages = [...new Set([...(target.languages || []), ...(channel.languages || [])])];
    target.altNames = [...new Set([...(target.altNames || []), ...(channel.altNames || [])])];
    target.maxQuality ||= channel.maxQuality || '';
    if ((!target.logo && channel.logo) || (!target.image && channel.image)) {
      target.logo = channel.logo || target.logo;
      target.image = channel.image || target.image;
    }
    (channel.sources || []).forEach((source) => {
      if (isAllowedSource(source.url, source) && !target.sources.some((item) => item.url === source.url)) {
        target.sources.push({ ...source, name: `Source ${target.sources.length + 1}` });
      }
    });
    target.url = target.sources[0]?.url || target.url || '';
  });
  return [...merged.values()].map((channel) => {
    const sources = [...channel.sources]
      .sort((a, b) => getSourcePriority(a) - getSourcePriority(b))
      .map((source, index) => ({ ...source, name: `Source ${index + 1}` }));
    return { ...channel, sources, url: sources[0]?.url || channel.url || '' };
  });
}

function getChannelMergeKey(name) {
  return createSlug(name)
    .replace(/-sports?(?=-|$)/g, '-sport')
    .replace(/(?:-(?:france|fr|hd))+$/g, '');
}

function getSourcePriority(source) {
  const provider = String(source?.provider || '').toLowerCase();
  if (provider.includes('cdnlivetv')) return 0;
  if (provider.includes('iptv-org')) return 20;
  return 10;
}

function getFrenchChannels(channels) {
  return (channels || []).filter((channel) => {
    const code = String(channel?.code || '').toLowerCase();
    const country = String(channel?.country || '').toLowerCase();
    return code === 'fr' || country === 'fr' || country.includes('france') || country.includes('français');
  }).map((channel) => ({ ...channel, image: getReliableChannelLogo(channel) }));
}

function getReliableChannelLogo(channel) {
  const name = String(channel?.name || '').toLowerCase();
  const commons = 'https://commons.wikimedia.org/wiki/Special:Redirect/file/';
  if (/canal live\s*\d+/i.test(name)) return './logos/canal-plus-fr.png';
  if (/^dazn/.test(name)) return '';
  if (/^rmc sport 1/.test(name)) return './logos/rmc-sport-1-fr.png';
  if (/bein.*(?:sport|sports).*1/.test(name)) return './logos/bein-sports-1-french-fr.png';
  if (/bein.*(?:sport|sports).*2/.test(name)) return './logos/bein-sports-2-french-fr.png';
  if (/bein.*(?:sport|sports).*3/.test(name)) return './logos/bein-sports-3-french-fr.png';
  if (/bein.*(?:max|sport).*4/.test(name)) return './logos/bein-sports-4-max.png';
  if (/canal.*sport.*360|canal\+?\s*360/.test(name)) return './logos/canal-plus-sport-360-fr.png';
  if (/canal.*sport/.test(name)) return './logos/canal-plus-sport-fr.png';
  if (/canal.*foot/.test(name)) return './logos/canal-plus-foot-fr.png';
  if (/^tf1/.test(name)) return './logos/tf1-fr.png';
  if (/^m6/.test(name)) return './logos/m6-fr.png';
  if (/france\s*4/.test(name)) return './logos/france-4-fr.png';
  if (/equipe/.test(name)) return './logos/lequipe-fr.png';
  if (name.includes('canal premier league')) return './logos/canal-plus-fr.png';
  if (name.includes('canal foot')) return `${commons}Foot%2B%20(logo%2C%202011-).svg`;
  if (name.startsWith('canal')) return './logos/canal-plus-fr.png';
  if (name.includes('rmc sport 1')) return `${commons}Logo%20RMC%20Sport%201%202018.svg`;
  if (name.includes('rmc sport 2')) return `${commons}Logo%20RMC%20Sport%202%202018.svg`;
  if (name.includes('bein')) return `${commons}BeIN_Sports_logo_(2017).png`;
  return channel?.image || '';
}

function getChannelLogoVariant(channel) {
  const name = String(channel?.name || '');
  const canalLive = name.match(/canal live\s*(\d+)/i);
  const beinMax = name.match(/bein.*max\s*(\d+)/i);
  const rmc = name.match(/rmc sport\s*(\d+)/i);
  if (canalLive) return `LIVE ${canalLive[1]}`;
  if (beinMax) return `MAX ${beinMax[1]}`;
  if (rmc) return `SPORT ${rmc[1]}`;
  if (/motogp/i.test(name)) return 'MOTO GP';
  if (/formula|\bf1\b/i.test(name)) return 'F1';
  return '';
}

function getChannelBrandMark(channel) {
  const name = String(channel?.name || 'TV').trim();
  let brand = getChannelInitials(name);
  let variant = '';
  const canalLive = name.match(/canal live\s*(\d+)/i);
  const bein = name.match(/bein\s*(?:sports?)?\s*(?:max\s*)?(\d+)/i);
  const rmc = name.match(/rmc sport\s*(\d+)/i);
  const france = name.match(/france\s*(\d+)/i);
  if (/canal/i.test(name)) {
    brand = 'CANAL+';
    variant = canalLive ? `LIVE ${canalLive[1]}` : name.replace(/canal\+?/i, '').replace(/\bfr\b/gi, '').trim();
  } else if (bein) {
    brand = 'beIN';
    variant = /max/i.test(name) ? `MAX ${bein[1]}` : `SPORTS ${bein[1]}`;
  } else if (rmc) {
    brand = 'RMC';
    variant = `SPORT ${rmc[1]}`;
  } else if (france) {
    brand = 'france•tv';
    variant = france[1];
  } else if (/^tf1/i.test(name)) brand = 'TF1';
  else if (/^m6/i.test(name)) brand = 'M6';
  else if (/equipe/i.test(name)) brand = "L'ÉQUIPE";
  else if (/dazn/i.test(name)) brand = 'DAZN';
  return `<span class="direct-brand-mark"><strong>${escapeHtml(brand)}</strong>${variant ? `<small>${escapeHtml(variant)}</small>` : ''}</span>`;
}

function getChannelLogoClass(channel) {
  const name = String(channel?.name || '').toLowerCase();
  if (name.startsWith('canal')) return 'is-canal';
  if (name.includes('rmc')) return 'is-rmc';
  if (name.includes('bein')) return 'is-bein';
  return '';
}

function renderDirectCategoryTabs(channels) {
  const box = $('directCategoryTabs');
  if (!box) return;
  const counts = channels.reduce((result, channel) => {
    result[channel.category] = (result[channel.category] || 0) + 1;
    return result;
  }, {});
  const categories = ['Toutes', ...Object.keys(counts).sort((a, b) => a.localeCompare(b, 'fr'))];
  if (!categories.includes(activeDirectCategory)) activeDirectCategory = 'Toutes';
  box.innerHTML = categories.map((category) => `
    <button type="button" class="direct-category-tab ${category === activeDirectCategory ? 'active' : ''}" data-category="${escapeHtml(category)}">
      ${escapeHtml(category)} <span>${category === 'Toutes' ? channels.length : counts[category]}</span>
    </button>
  `).join('');
  box.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', () => {
      activeDirectCategory = button.dataset.category;
      directRenderLimit = DIRECT_BATCH_SIZE;
      renderDirectChannels();
    });
  });
}

function classifyChannel(channel) {
  const value = String(channel?.name || '').toLowerCase();
  if (/sport|espn|bein|racing|football|soccer|nba|nfl|tennis|golf/.test(value)) return 'Sports';
  if (/news|info|cnn|bbc|fox news|weather/.test(value)) return 'Information';
  if (/music|musique|mtv|radio|hits|vevo/.test(value)) return 'Musique';
  if (/kids|junior|cartoon|nick|disney|baby/.test(value)) return 'Jeunesse';
  if (/movie|movies|cinema|film|series|drama|action/.test(value)) return 'Cinéma & séries';
  const countries = {
    fr: 'France', us: 'États-Unis', gb: 'Royaume-Uni', uk: 'Royaume-Uni', ca: 'Canada',
    be: 'Belgique', ch: 'Suisse', de: 'Allemagne', es: 'Espagne', it: 'Italie',
    pt: 'Portugal', ma: 'Maroc', dz: 'Algérie', tn: 'Tunisie'
  };
  return countries[String(channel?.code || '').toLowerCase()] || 'International';
}

async function playChannel(channel) {
  if (!channel?.url) return;
  if (Array.isArray(channel.sources) && channel.sources.length) {
    attemptedDirectSources.clear();
    const preferredUrl = getDirectSourcePreferences()[getChannelKey(channel)];
    const preferredIndex = channel.sources.findIndex((source) => source.url === preferredUrl && getKnownDirectSourceState(source) !== 'unavailable');
    const availableIndex = channel.sources.findIndex((source) => getKnownDirectSourceState(source) !== 'unavailable');
    selectedDirectSourceIndex = preferredIndex >= 0 ? preferredIndex : availableIndex;
    if (selectedDirectSourceIndex < 0) {
      setCurrentChannel(channel);
      showDirectError(channel, 'Aucun flux public autorisé et lisible n’est disponible pour cette chaîne.');
      renderChannelSources(channel);
      return;
    }
    playChannelSource(channel, selectedDirectSourceIndex);
    return;
  }
  setCurrentChannel(channel);
  $('directUrl').value = channel.url;
  const isCdnLive = channel.source === 'cdnlivetv' || isCdnLivePlayerUrl(channel.url);

  if (isCdnLive) {
    showDirectLoading(channel.name || channel.title || 'Chaîne');
    try {
      const response = await fetch(`/api/direct/channel-stream?url=${encodeURIComponent(channel.url)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data.url) throw new Error(data?.error || 'Flux indisponible');
      playUrl(data.url, { ...channel, type: 'hls' });
      saveRecent(channel.url, { ...channel, title: channel.name || channel.title });
      renderRecent();
      refreshDiscoveryAfterHistory();
      return;
    } catch (error) {
      console.error(error);
      showDirectError(channel, error.message);
      return;
    }
  }

  playUrl(channel.url, channel);
  saveRecent(channel.url, { ...channel, title: channel.name || channel.title });
  renderRecent();
  refreshDiscoveryAfterHistory();
}

function getKnownDirectSourceState(source) {
  return directSourceStates.get(source?.url)?.state || directHealthCache.get(source?.url)?.state || source?.status || 'unchecked';
}

function getChannelHealthState(channel) {
  const states = (channel?.sources || []).map(getKnownDirectSourceState);
  if (states.some((state) => state === 'available')) return 'available';
  if (states.some((state) => state === 'slow')) return 'slow';
  if (states.length && states.every((state) => state === 'unavailable')) return 'unavailable';
  if (states.some((state) => state === 'checking')) return 'checking';
  return 'unchecked';
}

function getDirectHealthLabel(state) {
  return ({ available: 'Fonctionnelle', slow: 'Lente', unavailable: 'Indisponible', checking: 'Contrôle…', unchecked: 'À vérifier' })[state] || 'À vérifier';
}

function focusDirectPlayer() {
  const stage = document.querySelector('.direct-tv-stage');
  stage?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function playChannelSource(channel, index) {
  const source = channel?.sources?.[index];
  const sourceName = getDirectSourceDisplayName(index);
  if (!source || !isAllowedSource(source.url, source)) {
    if (source) {
      attemptedDirectSources.add(index);
      handleDirectSourceFailure(channel, source, index, 'Cette source est invalide ou non autorisée.');
    } else {
      showDirectError(channel, 'Cette source est invalide ou non autorisée.');
    }
    return;
  }
  selectedDirectSourceIndex = index;
  attemptedDirectSources.add(index);
  updateDirectSourceState(source.url, 'checking');
  const activeChannel = { ...channel, url: source.url, sourceName, provider: source.provider };
  setCurrentChannel(activeChannel);
  renderChannelSources(activeChannel);
  showDirectLoading(`${channel.name} · ${sourceName} · tentative ${index + 1}/${channel.sources.length}`);
  if (isCdnLivePlayerUrl(source.url)) {
    try {
      const response = await fetch(`/api/direct/channel-stream?url=${encodeURIComponent(source.url)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data.url) throw new Error(data?.error || 'Flux CDNLiveTV indisponible');
      playUrl(data.url, { ...activeChannel, type: 'hls' }, getDirectSourceLifecycle(channel, source, index));
    } catch (error) {
      handleDirectSourceFailure(channel, source, index, error.message);
      return;
    }
  } else {
    playUrl(source.url, { ...activeChannel, type: source.type || getDirectType(source.url) }, getDirectSourceLifecycle(channel, source, index));
  }
  saveRecent(source.url, activeChannel);
  renderRecent();
}

function renderChannelSources(channel) {
  const panel = $('directSourceSwitcher');
  const list = $('directSourceList');
  const sources = channel?.sources || [];
  panel?.classList.toggle('hidden', !sources.length);
  if (!list) return;
  list.innerHTML = sources.map((source, index) => `
    <button class="direct-source-choice ${index === selectedDirectSourceIndex ? 'active' : ''}" type="button" data-source-index="${index}" aria-label="Lire ${escapeHtml(channel.name || 'la chaîne')} avec ${getDirectSourceDisplayName(index)}">
      <b>${getDirectSourceDisplayName(index)}</b><small>${getDirectSourceTechnicalLabel(source)} · ${escapeHtml(getDirectSourceStateLabel(source))}${getDirectSourceCheckedLabel(source)}</small>
    </button>
  `).join('');
  list.querySelectorAll('[data-source-index]').forEach((button) => button.addEventListener('click', () => {
    attemptedDirectSources.clear();
    playChannelSource(channel, Number(button.dataset.sourceIndex));
  }));
}

function getDirectSourceDisplayName(index) {
  return `Source ${Number(index) + 1}`;
}

function getDirectSourceTechnicalLabel(source) {
  const details = [source?.quality, source?.protocol || source?.type]
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean);
  return escapeHtml([...new Set(details)].join(' · ') || 'DIRECT');
}

function getDirectSourceLifecycle(channel, source, index) {
  return {
    timeout: 14000,
    onReady(elapsed) {
      updateDirectSourceState(source.url, elapsed > 5000 ? 'slow' : 'available');
      const preferences = getDirectSourcePreferences();
      preferences[getChannelKey(channel)] = source.url;
      localStorage.setItem(DIRECT_SOURCE_PREF_KEY, JSON.stringify(preferences));
      setHint(`Lecture : ${channel.name} · ${getDirectSourceDisplayName(index)} · tentative ${index + 1}/${channel.sources.length} · ${elapsed > 5000 ? 'source lente' : 'source prête'}`);
      renderChannelSources({ ...channel, url: source.url });
    },
    onFailure(message) {
      handleDirectSourceFailure(channel, source, index, message);
    }
  };
}

function getDirectSourcePreferences() {
  try { return JSON.parse(localStorage.getItem(DIRECT_SOURCE_PREF_KEY) || '{}') || {}; } catch { return {}; }
}

function handleDirectSourceFailure(channel, source, index, message) {
  updateDirectSourceState(source.url, 'unavailable', message);
  const nextIndex = (channel.sources || []).findIndex((_item, candidateIndex) => !attemptedDirectSources.has(candidateIndex));
  if (nextIndex >= 0) {
    setHint(`${getDirectSourceDisplayName(index)} indisponible. Essai automatique de la source suivante...`);
    window.setTimeout(() => playChannelSource(channel, nextIndex), 250);
    return;
  }
  showDirectError(channel, `Toutes les sources ont échoué. Dernière erreur : ${message}`);
  renderChannelSources(channel);
}

function updateDirectSourceState(url, state, error = '') {
  const checkedAt = new Date().toISOString();
  directSourceStates.set(url, { state, error, checkedAt });
  directHealthCache.set(url, { state, error, checkedAt });
  directChannels.forEach((channel) => {
    (channel.sources || []).forEach((source) => {
      if (source.url !== url) return;
      source.status = state;
      source.checkedAt = checkedAt;
      source.error = error;
    });
  });
  persistDirectHealthCache();
  scheduleDirectStatusRefresh();
}

function restoreDirectHealthCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(DIRECT_HEALTH_KEY) || '[]');
    const now = Date.now();
    (Array.isArray(saved) ? saved : []).forEach((entry) => {
      const checkedAt = Date.parse(entry?.checkedAt || '');
      if (!entry?.url || !Number.isFinite(checkedAt) || now - checkedAt > DIRECT_HEALTH_TTL) return;
      if (!['available', 'slow', 'unavailable'].includes(entry.state)) return;
      directHealthCache.set(entry.url, { state: entry.state, error: entry.error || '', checkedAt: entry.checkedAt });
      directSourceStates.set(entry.url, { state: entry.state, error: entry.error || '', checkedAt: entry.checkedAt });
    });
  } catch {}
}

function persistDirectHealthCache() {
  try {
    const entries = [...directSourceStates.entries()]
      .filter(([, value]) => ['available', 'slow', 'unavailable'].includes(value.state))
      .slice(-500)
      .map(([url, value]) => ({ url, ...value }));
    localStorage.setItem(DIRECT_HEALTH_KEY, JSON.stringify(entries));
  } catch {}
}

function scheduleDirectStatusRefresh() {
  window.clearTimeout(directStatusRefreshTimer);
  directStatusRefreshTimer = window.setTimeout(() => {
    const normalized = directChannels.map((channel) => ({ ...channel, category: channel.category || classifyChannel(channel) }));
    renderDirectViewTabs(normalized, getDirectFavorites(), new Map(getRecent().map((item, index) => [getChannelKey(item), index])));
    if (currentDirectChannel) renderChannelSources(currentDirectChannel);
    const availability = $('directAvailabilityFilter')?.value || '';
    if (activeDirectView === 'functional' || ['available', 'unavailable'].includes(availability)) renderDirectChannels();
  }, 80);
}

function getDirectSourceStateLabel(source) {
  const state = directSourceStates.get(source?.url)?.state || source?.status || 'idle';
  return ({ idle: 'À vérifier', unchecked: 'À vérifier', checking: 'chargement', available: 'fonctionnelle', slow: 'lente', unavailable: 'indisponible' })[state] || state;
}

function getDirectSourceCheckedLabel(source) {
  const checkedAt = directSourceStates.get(source?.url)?.checkedAt || source?.checkedAt;
  if (!checkedAt) return '';
  const time = new Date(checkedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return ` · vérifiée ${escapeHtml(time)}`;
}

function playNextChannelSource() {
  const sources = currentDirectChannel?.sources || [];
  if (!sources.length) return;
  attemptedDirectSources.clear();
  playChannelSource(currentDirectChannel, (selectedDirectSourceIndex + 1) % sources.length);
}

function reloadCurrentChannelSource() {
  if (!currentDirectChannel?.sources?.length) return;
  attemptedDirectSources.clear();
  playChannelSource(currentDirectChannel, selectedDirectSourceIndex);
}

function refreshDiscoveryAfterHistory() {
  if (activeDirectView === 'recent') renderDirectChannels();
  else {
    const normalized = directChannels.map((channel) => ({ ...channel, category: channel.category || classifyChannel(channel) }));
    renderDirectViewTabs(normalized, getDirectFavorites(), new Map(getRecent().map((item, index) => [getChannelKey(item), index])));
  }
}

function setCurrentChannel(channel) {
  currentDirectChannel = { ...channel, name: channel.name || channel.title || getTitleFromUrl(channel.url) };
  const logo = $('directNowLogo');
  if (logo) {
    logo.className = `direct-now-logo ${getChannelLogoClass(currentDirectChannel)}`.trim();
    logo.innerHTML = `${getChannelBrandMark(currentDirectChannel)}${currentDirectChannel.image ? `<img src="${escapeHtml(currentDirectChannel.image)}" alt="">` : ''}${getChannelLogoVariant(currentDirectChannel) ? `<span class="direct-logo-variant">${escapeHtml(getChannelLogoVariant(currentDirectChannel))}</span>` : ''}`;
    bindDirectLogoFallbacks(logo);
  }
  if ($('directNowTitle')) $('directNowTitle').textContent = currentDirectChannel.name;
  if ($('directNowProgram')) $('directNowProgram').textContent = `${currentDirectChannel.category || currentDirectChannel.group || 'Télévision'} · ${currentDirectChannel.country || currentDirectChannel.code?.toUpperCase() || 'Direct'}`;
  $('directPrevChannel').disabled = false;
  $('directNextChannel').disabled = false;
  $('directFavoriteChannel').disabled = false;
  renderCurrentFavorite();
  document.title = `${currentDirectChannel.name} en direct - Madrador TV`;
  document.querySelectorAll('.direct-channel-tile').forEach((tile) => {
    const button = tile.querySelector('[data-url]');
    tile.classList.toggle('is-playing', button?.dataset.channelId === currentDirectChannel.id || button?.dataset.url === currentDirectChannel.url);
  });
  loadChannelEpg(currentDirectChannel);
}

async function loadChannelEpg(channel, force = false) {
  const panel = $('directEpg');
  const rail = $('directEpgRail');
  const updated = $('directEpgUpdated');
  const refreshButton = $('directEpgRefresh');
  if (!panel || !rail) return;

  const requestId = ++directEpgRequestId;
  panel.hidden = false;
  panel.classList.add('is-loading');
  refreshButton?.classList.add('is-loading');
  if (refreshButton) refreshButton.disabled = true;
  rail.innerHTML = '<div class="direct-epg-message"><i class="fa-solid fa-circle-notch fa-spin"></i> Recherche du programme...</div>';
  if (updated) updated.textContent = 'Heure de Paris';

  try {
    const params = new URLSearchParams({ channel: channel.name || '' });
    if (channel.channelId) params.set('channelId', channel.channelId);
    if (channel.tvgId) params.set('tvgId', channel.tvgId);
    const aliases = [...(channel.altNames || []), channel.guide?.name].filter(Boolean);
    if (aliases.length) params.set('aliases', aliases.slice(0, 8).join('|'));
    if (force) params.set('refresh', '1');
    const response = await fetch(`/api/direct/epg?${params}`, { cache: force ? 'reload' : 'default' });
    const data = await response.json().catch(() => ({}));
    if (requestId !== directEpgRequestId) return;
    if (!response.ok || !data.ok || !data.items?.length) {
      rail.innerHTML = '<div class="direct-epg-message"><i class="fa-regular fa-calendar-xmark"></i><span><b>Aucun programme disponible</b><small>Le direct reste accessible. Le guide dépend des données publiées par la chaîne.</small></span></div>';
      if (updated) updated.textContent = 'Guide indisponible';
      return;
    }

    const now = Date.now();
    const current = data.current;
    if (current && $('directNowProgram')) {
      $('directNowProgram').textContent = `En ce moment · ${current.title}`;
    }
    rail.innerHTML = data.items.slice(0, 8).map((item) => {
      const start = new Date(item.start);
      const stop = new Date(item.stop);
      const isNow = start.getTime() <= now && stop.getTime() > now;
      const duration = Math.max(1, stop.getTime() - start.getTime());
      const progress = isNow ? Math.min(100, Math.max(0, ((now - start.getTime()) / duration) * 100)) : 0;
      const timeLabel = isNow
        ? `Maintenant · ${formatEpgTime(start)}–${formatEpgTime(stop)}`
        : `${formatEpgTime(start)}–${formatEpgTime(stop)}`;
      return `
        <article class="direct-epg-item ${isNow ? 'is-now' : ''}">
          <span>${timeLabel}</span>
          <b>${escapeHtml(item.title || 'Programme TV')}</b>
          ${(item.description || item.category) ? `<small title="${escapeHtml(item.description || '')}">${escapeHtml(item.category || item.description || '')}</small>` : ''}
          ${isNow ? `<i style="--epg-progress:${progress.toFixed(1)}%"></i>` : ''}
        </article>`;
    }).join('');
    if (updated) updated.textContent = `${data.matched?.name || channel.name} · heure de Paris`;
  } catch {
    if (requestId === directEpgRequestId) {
      rail.innerHTML = '<div class="direct-epg-message"><i class="fa-solid fa-triangle-exclamation"></i><span><b>Guide TV temporairement indisponible</b><small>Utilise le bouton Actualiser pour réessayer.</small></span></div>';
      if (updated) updated.textContent = 'Erreur de chargement';
    }
  } finally {
    if (requestId === directEpgRequestId) {
      panel.classList.remove('is-loading');
      refreshButton?.classList.remove('is-loading');
      if (refreshButton) refreshButton.disabled = false;
    }
  }
}

function formatEpgTime(date) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris'
  }).format(date);
}

function playRelativeChannel(offset) {
  const pool = visibleDirectChannels.length > 1 ? visibleDirectChannels : directChannels;
  if (!pool.length) return;
  if (!currentDirectChannel) {
    playChannel(offset < 0 ? pool[pool.length - 1] : pool[0]);
    return;
  }
  const currentIndex = pool.findIndex((channel) => getChannelKey(channel) === getChannelKey(currentDirectChannel));
  const nextIndex = (Math.max(0, currentIndex) + offset + pool.length) % pool.length;
  playChannel(pool[nextIndex]);
}

async function enterDirectFullscreen() {
  const target = $('directScreen');
  if (!target) return;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (target.requestFullscreen) await target.requestFullscreen();
    else target.querySelector('video')?.webkitEnterFullscreen?.();
  } catch {
    showToast('Plein écran indisponible');
  }
}

function getDirectFavorites() {
  try {
    const values = JSON.parse(localStorage.getItem(DIRECT_FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(values) ? values : []);
  } catch {
    return new Set();
  }
}

function getChannelKey(channel) {
  return String(channel?.id || channel?.url || '').trim();
}

function toggleCurrentChannelFavorite() {
  if (currentDirectChannel) toggleChannelFavorite(currentDirectChannel);
}

function toggleChannelFavorite(channel) {
  const favorites = getDirectFavorites();
  const key = getChannelKey(channel);
  if (favorites.has(key)) favorites.delete(key);
  else favorites.add(key);
  localStorage.setItem(DIRECT_FAVORITES_KEY, JSON.stringify(Array.from(favorites)));
  renderCurrentFavorite();
  renderDirectChannels();
  showToast(favorites.has(key) ? 'Chaîne ajoutée aux favoris' : 'Chaîne retirée des favoris');
}

function renderCurrentFavorite() {
  const button = $('directFavoriteChannel');
  if (!button || !currentDirectChannel) return;
  const active = getDirectFavorites().has(getChannelKey(currentDirectChannel));
  button.classList.toggle('active', active);
  button.innerHTML = `<i class="fa-${active ? 'solid' : 'regular'} fa-heart"></i>`;
  button.title = active ? 'Retirer des favoris' : 'Ajouter aux favoris';
}

function showDirectLoading(name) {
  destroyDirectPlayback();
  $('directScreen').innerHTML = `
    <div class="direct-placeholder">
      <span class="search-loader"></span>
      <h2>Connexion à ${escapeHtml(name)}</h2>
      <p>Récupération du flux sécurisé...</p>
    </div>`;
  setHint(`Connexion : ${name}`);
}

function showDirectError(channel, message) {
  const official = getOfficialDirectLink(channel);
  $('directScreen').innerHTML = `
    <div class="direct-placeholder direct-error-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h2>Aucune source directe disponible</h2>
      <p>${escapeHtml(message || 'Cette chaîne ne répond pas pour le moment.')}</p>
      ${official ? `<a class="btn glass" href="${escapeHtml(official.url)}" target="_blank" rel="noopener noreferrer" data-allow-popup="true"><i class="fa-solid fa-up-right-from-square"></i><span>${escapeHtml(official.label)}</span></a>` : ''}
    </div>`;
  setHint(`Échec : ${channel.name || channel.title || 'chaîne'}`);
  showToast('Flux momentanément indisponible');
}

function getOfficialDirectLink(channel) {
  const name = String(channel?.name || channel?.title || '').toLowerCase();
  if (/\btf1\b/.test(name)) return { url: 'https://www.tf1.fr/tf1/direct', label: 'Regarder sur TF1+' };
  if (/bfm\s*tv/.test(name)) return { url: 'https://www.bfmtv.com/en-direct/', label: 'Regarder sur BFM TV' };
  if (/france\s*2/.test(name)) return { url: 'https://www.france.tv/france-2/direct.html', label: 'Regarder sur france.tv' };
  if (/franceinfo/.test(name)) return { url: 'https://www.franceinfo.fr/en-direct/tv.html', label: 'Regarder sur franceinfo' };
  if (/\barte\b/.test(name)) return { url: 'https://www.arte.tv/fr/direct/', label: 'Regarder sur ARTE' };
  if (/france\s*24/.test(name)) return { url: 'https://www.france24.com/fr/direct', label: 'Regarder sur France 24' };
  return null;
}

function isCdnLivePlayerUrl(value) {
  try {
    const url = new URL(normalizeUrl(value));
    return url.hostname.endsWith('cdnlivetv.tv') && url.pathname.includes('/api/v1/channels/player/');
  } catch {
    return false;
  }
}

function installImportedChannels(channels) {
  directPlaylist = channels.map((channel) => ({
    ...channel,
    group: channel.group || 'JSON personnel',
    source: 'json'
  }));
  localStorage.setItem(DIRECT_PLAYLIST_KEY, JSON.stringify({
    title: 'Chaînes personnelles',
    items: directPlaylist.slice(0, 1000)
  }));
  showDirectPlaylist('Chaînes personnelles');
  setHint(`${directPlaylist.length} chaînes personnelles prêtes`);
}

function parseChannelsPayload(value) {
  const raw = String(value || '').trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return [];

  try {
    const data = JSON.parse(raw);
    const items = Array.isArray(data) ? data : data.channels;
    if (!Array.isArray(items)) return [];

    return items.map((channel, index) => {
      const url = normalizeUrl(channel?.url);
      const name = String(channel?.name || channel?.title || `Chaîne ${index + 1}`).trim();
      const code = String(channel?.code || '').trim().toLowerCase();
      return {
        id: `${code || 'tv'}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        name,
        title: name,
        code,
        country: code.toUpperCase(),
        url,
        image: normalizeUrl(channel?.image),
        status: String(channel?.status || 'unknown').toLowerCase(),
        viewers: Number(channel?.viewers || 0),
        type: getDirectType(url),
        source: 'json'
      };
    }).filter((channel) => channel.url);
  } catch {
    return [];
  }
}

function isChannelsApiUrl(value) {
  try {
    const url = new URL(normalizeUrl(value));
    return url.hostname.endsWith('cdnlivetv.tv') && /\/api\/v1\/channels\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function setChannelsState(message) {
  const box = $('directChannelList');
  if (!box) return;
  box.innerHTML = `
    <div class="direct-empty">
      <i class="fa-solid fa-tv"></i>
      <span>${escapeHtml(message)}</span>
    </div>`;
}

function saveRecent(url, direct = {}) {
  const title = direct.name || direct.title || getTitleFromUrl(url);
  const items = getRecent().filter((item) => item.url !== url);
  items.unshift({
    url,
    title,
    name: title,
    id: direct.id || '',
    code: direct.code || '',
    country: direct.country || '',
    category: direct.category || direct.group || '',
    image: direct.image || '',
    source: direct.source || '',
    type: direct.type || getDirectType(url),
    filename: direct.filename || '',
    at: Date.now()
  });
  localStorage.setItem(DIRECT_KEY, JSON.stringify(items.slice(0, 24)));
}

function getRecent() {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECT_KEY) || '[]');
    return Array.isArray(data) ? data.filter((item) => item?.url).slice(0, 24) : [];
  } catch {
    return [];
  }
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

async function resolveDirect(payload) {
  const localUrl = normalizeUrl(payload?.url);
  if (localUrl && !payload?.content) {
    try {
      const response = await fetch('/api/direct/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: localUrl })
      });
      const data = await response.json();
      if (data?.ok && data.url) return data;
    } catch {
      return { ok: true, url: localUrl, title: getTitleFromUrl(localUrl), type: getDirectType(localUrl) };
    }
  }

  if (payload?.content) {
    try {
      const response = await fetch('/api/direct/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: payload.content,
          filename: payload.filename || ''
        })
      });
      const data = await response.json();
      if (data?.ok && data.url) return data;
      return { ok: false };
    } catch {
      const url = extractUrlFromText(payload.content);
      return url ? { ok: true, url, title: getTitleFromUrl(url), type: getDirectType(url), filename: payload.filename || '' } : { ok: false };
    }
  }

  return localUrl ? { ok: true, url: localUrl, title: getTitleFromUrl(localUrl), type: getDirectType(localUrl) } : { ok: false };
}

function extractUrlFromText(value) {
  const text = String(value || '').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#')) continue;
    const match = line.match(/^URL=(.+)$/i);
    const url = normalizeUrl(match ? match[1] : line);
    if (url) return url;
  }

  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  return match ? normalizeUrl(match[0]) : '';
}

function getTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || 'Direct';
  } catch {
    return 'Direct';
  }
}

function getDirectType(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.m3u8')) return 'hls';
  if (clean.endsWith('.m3u')) return 'playlist';
  if (/\.(mp4|webm|mkv|avi)$/.test(clean)) return 'video';
  return 'iframe';
}

function setHint(message) {
  const hint = $('directHint');
  if (hint) hint.textContent = message;
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 1800);
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
