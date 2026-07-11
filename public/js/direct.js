const DIRECT_KEY = 'madrador:direct:recent';
const DIRECT_CHANNELS_KEY = 'madrador:direct:channels';
const $ = (id) => document.getElementById(id);
let directChannels = [];
let activeHls = null;

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directFile')?.addEventListener('change', handleDirectFile);
  $('directChannelsReload')?.addEventListener('click', () => loadDirectChannels(true));
  $('directChannelSearch')?.addEventListener('input', renderDirectChannels);
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
    if (file.size > 256 * 1024) {
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
  const filtered = directChannels
    .filter((channel) => !query || `${channel.name} ${channel.code} ${channel.country}`.toLowerCase().includes(query))
    .slice(0, 80);

  if (!filtered.length) {
    setChannelsState(directChannels.length ? 'Aucune chaîne trouvée.' : 'Charge les chaînes pour regarder la TV en direct.');
    return;
  }

  box.innerHTML = filtered.map((channel) => `
    <button class="direct-channel" type="button" data-url="${escapeHtml(channel.url)}" data-name="${escapeHtml(channel.name)}">
      <span class="direct-channel-logo">
        ${channel.image ? `<img src="${escapeHtml(channel.image)}" alt="">` : '<i class="fa-solid fa-tv"></i>'}
      </span>
      <span class="direct-channel-copy">
        <b>${escapeHtml(channel.name)}</b>
        <small>${escapeHtml(channel.country || channel.code || 'TV')} • ${escapeHtml(channel.status || 'online')}</small>
      </span>
      <i class="fa-solid fa-play"></i>
    </button>
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

function playChannel(channel) {
  if (!channel?.url) return;
  $('directUrl').value = channel.url;
  playUrl(channel.url, channel);
  saveRecent(channel.url, { ...channel, title: channel.name || channel.title });
  renderRecent();
}

function installImportedChannels(channels) {
  directChannels = channels;
  localStorage.setItem(DIRECT_CHANNELS_KEY, JSON.stringify(channels.slice(0, 800)));
  renderDirectChannels();
  setHint(`${channels.length} chaînes JSON prêtes`);
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
