const DIRECT_KEY = 'madrador:direct:recent';
const DIRECT_CHANNELS_KEY = 'madrador:direct:channels';
const DIRECT_PLAYLIST_KEY = 'madrador:direct:playlist';
const $ = (id) => document.getElementById(id);
let directChannels = [];
let directPlaylist = [];
let activeDirectCategory = 'Toutes';
let activeHls = null;

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directFile')?.addEventListener('change', handleDirectFile);
  $('directChannelsReload')?.addEventListener('click', () => loadDirectChannels(true));
  $('directChannelSearch')?.addEventListener('input', renderDirectChannels);
  $('directPlaylistSearch')?.addEventListener('input', renderDirectPlaylist);
  $('directPlaylistClear')?.addEventListener('click', clearDirectPlaylist);
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

  renderRecent();
  loadCachedPlaylist();
  loadCachedChannels();
  const last = getRecent()[0];
  if (last?.url) $('directUrl').value = last.url;
  window.setTimeout(() => loadDirectChannels(false), 200);
});

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
    } else {
      video.src = url;
    }
  } else {
    const frame = document.createElement('iframe');
    frame.className = 'direct-frame';
    frame.src = url;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups';
    screen.appendChild(frame);
  }

  setHint(`Lecture : ${direct.name || direct.title || getTitleFromUrl(url)}`);
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
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : '<i class="fa-solid fa-tower-broadcast"></i>'}
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
      playUrl(url, item);
      saveRecent(url, item);
      renderRecent();
    });
  });
}

function loadCachedChannels() {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECT_CHANNELS_KEY) || '[]');
    if (Array.isArray(data) && data.length) {
      directChannels = data;
      renderDirectChannels();
      setHint(`${data.length} chaînes prêtes depuis le cache local`);
    }
  } catch {}
}

async function loadDirectChannels(force = false) {
  const button = $('directChannelsReload');
  button?.classList.add('loading');
  if (button) button.disabled = true;
  setChannelsState('Chargement des chaînes CDNLiveTV...');

  try {
    if (!force) loadCachedChannels();
    const response = await fetch('/api/direct/channels', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || 'API Direct indisponible');

    directChannels = Array.isArray(data.channels) ? data.channels : [];
    localStorage.setItem(DIRECT_CHANNELS_KEY, JSON.stringify(directChannels.slice(0, 800)));
    renderDirectChannels();
    setHint(`${directChannels.length} chaînes chargées`);
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
    category: channel.category || classifyChannel(channel)
  }));
  renderDirectCategoryTabs(normalized);
  const filtered = normalized
    .filter((channel) => activeDirectCategory === 'Toutes' || channel.category === activeDirectCategory)
    .filter((channel) => !query || `${channel.name} ${channel.code} ${channel.country} ${channel.category}`.toLowerCase().includes(query))
    .slice(0, 600);

  if (!filtered.length) {
    setChannelsState(directChannels.length ? 'Aucune chaîne trouvée.' : 'Charge les chaînes pour regarder la TV en direct.');
    return;
  }

  const groups = filtered.reduce((result, channel) => {
    (result[channel.category] ||= []).push(channel);
    return result;
  }, {});

  box.innerHTML = Object.entries(groups).map(([category, channels]) => `
    <section class="direct-channel-group">
      <header><h3>${escapeHtml(category)}</h3><span>${channels.length} chaînes</span></header>
      <div class="direct-channel-grid">
        ${channels.map((channel) => `
          <button class="direct-channel direct-channel-card" type="button" data-url="${escapeHtml(channel.url)}" data-name="${escapeHtml(channel.name)}">
            <span class="direct-channel-logo">
              ${channel.image ? `<img src="${escapeHtml(channel.image)}" alt="${escapeHtml(channel.name)}" loading="lazy">` : '<i class="fa-solid fa-tv"></i>'}
            </span>
            <span class="direct-channel-copy">
              <b>${escapeHtml(channel.name)}</b>
              <small><i class="direct-status ${channel.status === 'online' ? 'online' : ''}"></i>${escapeHtml(channel.country || channel.code || 'TV')}</small>
            </span>
            <i class="fa-solid fa-play"></i>
          </button>
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

function playChannel(channel) {
  if (!channel?.url) return;
  $('directUrl').value = channel.url;
  playUrl(channel.url, channel);
  saveRecent(channel.url, { ...channel, title: channel.name || channel.title });
  renderRecent();
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
  items.unshift({ url, title, type: direct.type || getDirectType(url), filename: direct.filename || '', at: Date.now() });
  localStorage.setItem(DIRECT_KEY, JSON.stringify(items.slice(0, 8)));
}

function getRecent() {
  try {
    const data = JSON.parse(localStorage.getItem(DIRECT_KEY) || '[]');
    return Array.isArray(data) ? data.filter((item) => item?.url).slice(0, 8) : [];
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
