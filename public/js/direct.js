const DIRECT_KEY = 'madrador:direct:recent';
const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('directPlay')?.addEventListener('click', playFromInput);
  $('directOpen')?.addEventListener('click', openFromInput);
  $('directClear')?.addEventListener('click', () => {
    $('directUrl').value = '';
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

function playFromInput() {
  const url = normalizeUrl($('directUrl').value);
  if (!url) {
    showToast('Colle une URL valide');
    return;
  }
  playUrl(url);
  saveRecent(url);
  renderRecent();
}

function openFromInput() {
  const url = normalizeUrl($('directUrl').value);
  if (!url) {
    showToast('Colle une URL valide');
    return;
  }
  saveRecent(url);
  renderRecent();
  window.open(url, '_blank', 'noopener,noreferrer');
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

function saveRecent(url) {
  const title = getTitleFromUrl(url);
  const items = getRecent().filter((item) => item.url !== url);
  items.unshift({ url, title, at: Date.now() });
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

function getTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || 'Direct';
  } catch {
    return 'Direct';
  }
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
