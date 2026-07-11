const DIRECT_KEY = 'madrador:direct:recent';
const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directFile')?.addEventListener('change', handleDirectFile);
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
  const last = getRecent()[0];
  if (last?.url) $('directUrl').value = last.url;
});

async function playFromInput() {
  const direct = await resolveDirect({ url: $('directUrl').value });
  if (!direct.ok) {
    showToast('Colle une URL valide');
    return;
  }
  $('directUrl').value = direct.url;
  playUrl(direct.url);
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
    const direct = await resolveDirect({ content, filename: file.name });
    if (!direct.ok) {
      showToast('Aucune URL trouvée dans le fichier');
      setHint('Aucune URL valide trouvée');
      return;
    }

    $('directUrl').value = direct.url;
    playUrl(direct.url);
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

function playUrl(url) {
  const screen = $('directScreen');
  screen.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.className = 'direct-frame';
  frame.src = url;
  frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  frame.allowFullscreen = true;
  frame.referrerPolicy = 'strict-origin-when-cross-origin';
  frame.sandbox = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-popups';
  screen.appendChild(frame);
  setHint(`Lecture : ${getTitleFromUrl(url)}`);
  showToast('Direct lancé');
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
      $('directUrl').value = url;
      playUrl(url);
      saveRecent(url);
      renderRecent();
    });
  });
}

function saveRecent(url, direct = {}) {
  const title = direct.title || getTitleFromUrl(url);
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
