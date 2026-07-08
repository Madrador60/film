let adminSnapshot = {};
let toastTimer = null;

const $ = (id) => document.getElementById(id);

const ENDPOINTS = [
  ['/api/status', 'Statut serveur'],
  ['/api/keepalive', 'Keepalive'],
  ['/api/catalog/status?limit=all', 'Statut catalogue'],
  ['/api/library/stats', 'Stats bibliothèque'],
  ['/api/film/all?limit=1', 'API films'],
  ['/api/serie/all?limit=1', 'API séries']
];

window.addEventListener('DOMContentLoaded', () => {
  bindAdmin();
  loadAdmin();
});

function bindAdmin() {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('adminRefresh').addEventListener('click', loadAdmin);
  $('adminKeepalive').addEventListener('click', pingKeepalive);
  $('adminRefreshDomain').addEventListener('click', refreshDomain);
  $('adminWarmCache').addEventListener('click', warmCache);
  $('adminCopyRaw').addEventListener('click', copyRaw);
}

async function loadAdmin() {
  setBusy($('adminRefresh'), true, 'Actualisation...');
  const [status, stats, catalog, endpointStates] = await Promise.all([
    safeJson('/api/status'),
    safeJson('/api/library/stats'),
    safeJson('/api/catalog/status?limit=all'),
    checkEndpoints()
  ]);

  adminSnapshot = { status, stats, catalog, endpoints: endpointStates, refreshedAt: new Date().toISOString() };
  paintStatusStrip(status, stats, catalog);
  paintServer(status, stats);
  paintCatalog(catalog);
  paintEndpoints(endpointStates);
  paintRaw(adminSnapshot);
  setBusy($('adminRefresh'), false);
}

async function safeJson(url, options = {}) {
  try {
    const started = performance.now();
    const res = await fetch(url, { cache: 'no-store', ...options });
    const ms = Math.round(performance.now() - started);
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      status: res.status,
      ms,
      data,
      error: res.ok ? '' : `HTTP ${res.status}`
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: 0,
      data: {},
      error: err.message || 'Erreur réseau'
    };
  }
}

async function checkEndpoints() {
  return Promise.all(ENDPOINTS.map(async ([url, label]) => {
    const result = await safeJson(url);
    return { url, label, ...result };
  }));
}

function paintStatusStrip(status, stats, catalog) {
  const data = status.data || {};
  const library = stats.data || {};
  const film = catalog.data?.film || {};
  const series = catalog.data?.series || {};
  const ready = catalog.data?.ready || (film.state === 'ready' && series.state === 'ready');
  const items = [
    ['fa-server', 'Serveur', status.ok ? 'OK' : 'Erreur', status.ok],
    ['fa-database', 'Cache', String(data.cacheSize ?? library.cacheSize ?? 0), true],
    ['fa-film', 'Films', String(library.movies ?? film.total ?? 0), true],
    ['fa-tv', 'Séries', String(library.series ?? series.total ?? 0), ready]
  ];

  $('adminStatusStrip').innerHTML = items.map(([icon, label, value, ok]) => `
    <article class="${ok ? 'is-ok' : 'is-warn'}">
      <i class="fa-solid ${icon}"></i>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `).join('');
}

function paintServer(status, stats) {
  const data = status.data || {};
  const library = stats.data || {};
  const memory = data.memory?.rss ? `${Math.round(data.memory.rss / 1024 / 1024)} Mo` : '-';
  $('adminServerList').innerHTML = [
    ['Domaine actif', data.source || data.domain || library.source || '-'],
    ['Uptime', formatUptime(data.uptime || 0)],
    ['RAM', memory],
    ['Cache serveur', String(data.cacheSize ?? library.cacheSize ?? 0)],
    ['Routes API', Array.isArray(data.routes) ? `${data.routes.length} exposées` : 'Disponibles'],
    ['Réponse /api/status', status.ok ? `${status.ms} ms` : status.error]
  ].map(([label, value]) => `<span>${escapeHtml(label)} : ${escapeHtml(value)}</span>`).join('');
}

function paintCatalog(catalog) {
  if (!catalog.ok) {
    $('adminCatalogState').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Catalogue indisponible';
    $('adminCatalogSource').textContent = 'Source : inconnue';
    $('adminFilmText').textContent = 'Films : erreur';
    $('adminSeriesText').textContent = 'Séries : erreur';
    $('adminFilmProgress').style.width = '0%';
    $('adminSeriesProgress').style.width = '0%';
    $('adminCatalogMessage').textContent = catalog.error || 'Impossible de lire /api/catalog/status.';
    return;
  }

  const data = catalog.data || {};
  const film = data.film || {};
  const series = data.series || {};
  const ready = data.ready || (film.state === 'ready' && series.state === 'ready');
  const building = [film.state, series.state].some((state) => ['building', 'queued'].includes(state));

  $('adminCatalogState').innerHTML = ready
    ? '<i class="fa-solid fa-circle-check"></i> Catalogue complet prêt'
    : building
      ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Catalogue en préparation'
      : '<i class="fa-solid fa-circle-info"></i> Catalogue à préparer';
  $('adminCatalogSource').textContent = `Source : ${data.source || 'serveur Madrador'}`;
  paintProgress('adminFilm', film, 'films');
  paintProgress('adminSeries', series, 'séries');
  $('adminCatalogMessage').textContent = ready
    ? 'Le cache complet est prêt pour accélérer Render.'
    : building
      ? 'Le scan continue ou reprendra via /api/cache/warm.'
      : 'Lance Préparer cache pour construire ou reprendre le catalogue.';
}

function paintProgress(prefix, state, label) {
  const page = Number(state?.page || 0);
  const limit = Number(state?.limit || 0);
  const total = Number(state?.total || 0);
  const percent = limit ? Math.max(0, Math.min(100, Math.round((page / limit) * 100))) : 0;
  $(`${prefix}Text`).textContent = `${stateLabel(state?.state)} • page ${page}/${limit || '?'} • ${total} ${label}`;
  $(`${prefix}Progress`).style.width = `${percent}%`;
}

function paintEndpoints(endpoints) {
  $('adminEndpoints').innerHTML = endpoints.map((item) => `
    <a class="admin-endpoint ${item.ok ? 'is-ok' : 'is-warn'}" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">
      <i class="fa-solid ${item.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
      <span>
        <b>${escapeHtml(item.label)}</b>
        <small>${escapeHtml(item.url)}</small>
      </span>
      <strong>${item.ok ? `${item.ms} ms` : escapeHtml(item.error)}</strong>
    </a>
  `).join('');
}

function paintRaw(snapshot) {
  $('adminRaw').textContent = JSON.stringify(snapshot, null, 2);
}

async function pingKeepalive() {
  setBusy($('adminKeepalive'), true, 'Test...');
  const result = await safeJson('/api/keepalive');
  showToast(result.ok ? `Keepalive OK • ${result.ms} ms` : 'Keepalive indisponible');
  await loadAdmin();
  setBusy($('adminKeepalive'), false);
}

async function refreshDomain() {
  setBusy($('adminRefreshDomain'), true, 'Domaine...');
  const result = await safeJson('/api/refresh-domain', { method: 'POST' });
  showToast(result.ok ? 'Domaine rafraîchi' : 'Refresh domaine impossible');
  await loadAdmin();
  setBusy($('adminRefreshDomain'), false);
}

async function warmCache() {
  setBusy($('adminWarmCache'), true, 'Préparation...');
  const result = await safeJson('/api/cache/warm?limit=all');
  showToast(result.ok ? 'Préparation cache lancée' : 'Warm cache indisponible');
  await loadAdmin();
  setBusy($('adminWarmCache'), false);
}

async function copyRaw() {
  try {
    await navigator.clipboard.writeText($('adminRaw').textContent || '');
    showToast('JSON copié');
  } catch (err) {
    showToast('Copie indisponible');
  }
}

function setBusy(button, busy, label = '') {
  if (!button) return;
  if (busy) {
    button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>${escapeHtml(label)}</span>`;
    return;
  }
  button.disabled = false;
  if (button.dataset.original) button.innerHTML = button.dataset.original;
}

function stateLabel(state) {
  return {
    ready: 'Prêt',
    building: 'En cours',
    queued: 'En attente',
    idle: 'En attente',
    error: 'Erreur'
  }[state] || 'Inconnu';
}

function formatUptime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}min`;
  if (minutes) return `${minutes}min`;
  return `${Math.round(total)}s`;
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('toast').classList.add('hidden'), 1800);
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
