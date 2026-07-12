const DIRECT_KEY = 'madrador:direct:recent';
const DIRECT_CHANNELS_KEY = 'madrador:direct:channels:cdn-livelive24';
const DIRECT_PLAYLIST_KEY = 'madrador:direct:playlist';
const DIRECT_FAVORITES_KEY = 'madrador:direct:favorites';
const DIRECT_BATCH_SIZE = window.matchMedia('(max-width: 600px)').matches ? 30 : 60;
const ALLOWED_HOSTS = ['cdnlivetv.tv', 'livelive24.com', 'hesgoaler.com'];
const $ = (id) => document.getElementById(id);
let directChannels = [];
let directPlaylist = [];
let activeDirectCategory = 'Toutes';
let activeDirectView = 'all';
let currentDirectChannel = null;
let visibleDirectChannels = [];
let directRenderLimit = DIRECT_BATCH_SIZE;
let activeHls = null;
let selectedDirectSourceIndex = 0;

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directFile')?.addEventListener('change', handleDirectFile);
  $('directChannelsReload')?.addEventListener('click', () => loadDirectChannels(true));
  $('directChannelSearch')?.addEventListener('input', () => {
    directRenderLimit = DIRECT_BATCH_SIZE;
    renderDirectChannels();
  });
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

function playUrl(url, direct = {}) {
  const screen = $('directScreen');
  destroyActiveHls();
  screen.innerHTML = '';
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
      activeHls.on(window.Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
          setHint('Flux HLS indisponible. Essaie une autre chaîne ou ouvre la source.');
          activeHls.startLoad();
        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
          activeHls.recoverMediaError();
        } else {
          destroyActiveHls();
        }
      });
      activeHls.loadSource(url);
      activeHls.attachMedia(video);
      activeHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => setHint('Flux prêt. Appuie sur Lecture pour démarrer.'));
      });
    } else {
      video.src = url;
      video.play().catch(() => setHint('Flux prêt. Appuie sur Lecture pour démarrer.'));
    }
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'direct-frame';
    frame.src = url;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation';
    screen.appendChild(frame);
  }

  setHint(`Lecture : ${direct.name || direct.title || getTitleFromUrl(url)}`);
  if (!currentDirectChannel || currentDirectChannel.url !== direct.url) setCurrentChannel({ ...direct, url });
  showToast('Direct lancé');
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
      if (item) playChannel(item);
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
    let liveLiveChannels = [];
    try {
      const response = await fetch('/api/direct/channels', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'API CDNLiveTV indisponible');
      const frenchApiChannels = getFrenchChannels(Array.isArray(data.channels) ? data.channels : []);
      cdnChannels = groupChannels(frenchApiChannels.map((channel) => ({
        ...channel,
        category: channel.category || classifyChannel(channel),
        logo: channel.image || getReliableChannelLogo(channel)
      })));
    } catch (apiError) {
      console.warn('[DIRECT] CDNLiveTV indisponible, catalogue local conservé.', apiError);
    }
    try {
      const response = await fetch('./data/livelive24-chaines-france.json', { cache: force ? 'reload' : 'default' });
      const data = await response.json();
      liveLiveChannels = groupChannels((Array.isArray(data) ? data : []).map((channel) => ({
        name: channel.channel_name,
        category: channel.category,
        url: channel.url,
        logo: channel.image,
        code: 'fr',
        country: 'FR'
      })));
    } catch (liveError) {
      console.warn('[DIRECT] LiveLive24 indisponible, CDNLiveTV conservé.', liveError);
    }
    directChannels = mergeGroupedChannels(cdnChannels, liveLiveChannels);
    localStorage.setItem(DIRECT_CHANNELS_KEY, JSON.stringify(directChannels.slice(0, 800)));
    if ($('directChannelTotal')) $('directChannelTotal').textContent = `${directChannels.length} chaînes françaises`;
    renderDirectChannels();
    setHint(`${directChannels.length} chaînes françaises chargées`);
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
    .filter((channel) => activeDirectView !== 'favorites' || favoriteKeys.has(getChannelKey(channel)))
    .filter((channel) => activeDirectView !== 'recent' || recentOrder.has(getChannelKey(channel)));
  renderDirectCategoryTabs(viewChannels);
  let filtered = viewChannels
    .filter((channel) => activeDirectCategory === 'Toutes' || channel.category === activeDirectCategory)
    .filter((channel) => !query || `${channel.name} ${channel.code} ${channel.country} ${channel.category}`.toLowerCase().includes(query));
  if (activeDirectView === 'recent') {
    filtered = filtered.sort((a, b) => recentOrder.get(getChannelKey(a)) - recentOrder.get(getChannelKey(b)));
  }
  visibleDirectChannels = filtered;
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
            <button class="direct-channel direct-channel-card" type="button" data-channel-id="${escapeHtml(channel.id || '')}" data-url="${escapeHtml(channel.url)}" data-name="${escapeHtml(channel.name)}">
              <span class="direct-channel-logo ${getChannelLogoClass(channel)}">
                <span class="direct-logo-fallback">${escapeHtml(getChannelInitials(channel.name))}</span>
                ${channel.image ? `<img src="${escapeHtml(channel.image)}" alt="" loading="lazy">` : ''}
              </span>
              <span class="direct-channel-copy">
                <b>${escapeHtml(channel.name)}</b>
                <small><i class="direct-status ${channel.status === 'online' ? 'online' : ''}"></i>${escapeHtml(channel.country || channel.code || 'TV')}</small>
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
}

function renderDirectViewTabs(channels, favoriteKeys, recentOrder) {
  const counts = {
    all: channels.length,
    favorites: channels.filter((channel) => favoriteKeys.has(getChannelKey(channel))).length,
    recent: channels.filter((channel) => recentOrder.has(getChannelKey(channel))).length
  };
  $('directViewTabs')?.querySelectorAll('[data-direct-view]').forEach((button) => {
    const view = button.dataset.directView;
    button.classList.toggle('active', view === activeDirectView);
    button.querySelector('span').textContent = `${view === 'all' ? 'Toutes' : view === 'favorites' ? 'Favoris' : 'Récentes'} · ${counts[view]}`;
  });
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
    if (hostname === 'livelive24.com' || hostname.endsWith('.livelive24.com')) return 'LiveLive24';
    if (hostname === 'hesgoaler.com' || hostname.endsWith('.hesgoaler.com')) return 'Hesgoaler';
    return hostname;
  } catch {
    return 'Source inconnue';
  }
}

function isAllowedSource(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
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
    if (!name || !isAllowedSource(url)) return;
    const key = name.toLocaleLowerCase('fr');
    if (!grouped.has(key)) {
      grouped.set(key, {
        id: createSlug(name), name, category: normalizeChannelCategory(channel.category), code: 'fr', country: 'FR',
        logo: channel.logo || channel.image || '', image: channel.logo || channel.image || '', sources: [], status: 'online'
      });
    }
    const item = grouped.get(key);
    if (!item.sources.some((source) => source.url === url)) {
      item.sources.push({ name: `Source ${item.sources.length + 1}`, provider: detectProvider(url), url });
    }
  });
  return [...grouped.values()].map((channel) => ({ ...channel, url: channel.sources[0]?.url || '' }));
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
    const key = getChannelMergeKey(channel?.name);
    if (!key) return;
    if (!merged.has(key)) {
      merged.set(key, { ...channel, sources: [] });
    }
    const target = merged.get(key);
    if ((!target.logo && channel.logo) || (!target.image && channel.image)) {
      target.logo = channel.logo || target.logo;
      target.image = channel.image || target.image;
    }
    (channel.sources || []).forEach((source) => {
      if (isAllowedSource(source.url) && !target.sources.some((item) => item.url === source.url)) {
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
  if (provider.includes('livelive24')) return 5;
  if (provider.includes('hesgoaler')) return 6;
  return 5;
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
  if (name.includes('canal premier league')) return `${commons}Logo-CanalPlus-PremierLeague.png`;
  if (name.includes('canal foot')) return `${commons}Foot%2B%20(logo%2C%202011-).svg`;
  if (name.startsWith('canal')) return `${commons}CanalPlus.svg`;
  if (name.includes('rmc sport 1')) return `${commons}Logo%20RMC%20Sport%201%202018.svg`;
  if (name.includes('rmc sport 2')) return `${commons}Logo%20RMC%20Sport%202%202018.svg`;
  if (name.includes('bein')) return `${commons}BeIN_Sports_logo_(2017).png`;
  return channel?.image || '';
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
    selectedDirectSourceIndex = 0;
    playChannelSource(channel, 0);
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

async function playChannelSource(channel, index) {
  const source = channel?.sources?.[index];
  if (!source || !isAllowedSource(source.url)) {
    showDirectError(channel, 'Cette source est invalide ou non autorisée.');
    return;
  }
  selectedDirectSourceIndex = index;
  const activeChannel = { ...channel, url: source.url, sourceName: source.name, provider: source.provider };
  setCurrentChannel(activeChannel);
  renderChannelSources(activeChannel);
  showDirectLoading(`${channel.name} · ${source.name}`);
  if (isCdnLivePlayerUrl(source.url)) {
    try {
      const response = await fetch(`/api/direct/channel-stream?url=${encodeURIComponent(source.url)}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data.url) throw new Error(data?.error || 'Flux CDNLiveTV indisponible');
      playUrl(data.url, { ...activeChannel, type: 'hls' });
    } catch (error) {
      showDirectError(activeChannel, error.message);
      return;
    }
  } else {
    playUrl(source.url, { ...activeChannel, type: 'iframe' });
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
    <button class="direct-source-choice ${index === selectedDirectSourceIndex ? 'active' : ''}" type="button" data-source-index="${index}">
      <b>${escapeHtml(source.name)}</b><small>${escapeHtml(source.provider)}</small>
    </button>
  `).join('');
  list.querySelectorAll('[data-source-index]').forEach((button) => button.addEventListener('click', () => {
    playChannelSource(channel, Number(button.dataset.sourceIndex));
  }));
}

function playNextChannelSource() {
  const sources = currentDirectChannel?.sources || [];
  if (!sources.length) return;
  playChannelSource(currentDirectChannel, (selectedDirectSourceIndex + 1) % sources.length);
}

function reloadCurrentChannelSource() {
  if (!currentDirectChannel?.sources?.length) return;
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
    logo.innerHTML = `<span>${escapeHtml(getChannelInitials(currentDirectChannel.name))}</span>${currentDirectChannel.image ? `<img src="${escapeHtml(currentDirectChannel.image)}" alt="">` : ''}`;
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
  destroyActiveHls();
  $('directScreen').innerHTML = `
    <div class="direct-placeholder">
      <span class="search-loader"></span>
      <h2>Connexion à ${escapeHtml(name)}</h2>
      <p>Récupération du flux sécurisé...</p>
    </div>`;
  setHint(`Connexion : ${name}`);
}

function showDirectError(channel, message) {
  $('directScreen').innerHTML = `
    <div class="direct-placeholder direct-error-state">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <h2>Flux indisponible</h2>
      <p>${escapeHtml(message || 'Cette chaîne ne répond pas pour le moment.')}</p>
      <a class="btn glass" href="${escapeHtml(channel.url)}" target="_blank" rel="noopener noreferrer" data-allow-popup="true">
        <i class="fa-solid fa-up-right-from-square"></i><span>Ouvrir le lecteur externe</span>
      </a>
    </div>`;
  setHint(`Échec : ${channel.name || channel.title || 'chaîne'}`);
  showToast('Flux momentanément indisponible');
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
