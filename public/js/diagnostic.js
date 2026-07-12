const $ = (id) => document.getElementById(id);
const DIAGNOSTIC_ENDPOINTS = [
  ['/api/status', 'Serveur Express'],
  ['/api/keepalive', 'Keepalive Render'],
  ['/api/catalog/bootstrap?limit=1', 'Accueil catalogue'],
  ['/api/film/all?limit=1', 'Catalogue films'],
  ['/api/serie/all?limit=1', 'Catalogue séries'],
  ['/api/search?q=batman', 'Recherche'],
  ['/api/direct/status', 'Service Direct'],
  ['/api/direct/channels', 'Chaînes Direct']
];
let snapshot = {};

window.addEventListener('DOMContentLoaded', () => {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));
  $('diagnosticRun').addEventListener('click', runDiagnostics);
  $('diagnosticCopy').addEventListener('click', copyDiagnostic);
  $('diagnosticClearCache').addEventListener('click', clearClientCache);
  runDiagnostics();
});

async function runDiagnostics() {
  setBusy(true);
  const tests = await Promise.all(DIAGNOSTIC_ENDPOINTS.map(testEndpoint));
  const storage = await getStorageState();
  const client = getClientState();
  snapshot = { generatedAt: new Date().toISOString(), origin: location.origin, tests, storage, client };
  renderTests(tests);
  renderClient(client, storage);
  renderSummary(tests, storage, client);
  $('diagnosticRaw').textContent = JSON.stringify(snapshot, null, 2);
  setBusy(false);
}

async function testEndpoint([url, label]) {
  const started = performance.now();
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return { label, url, ok: response.ok, status: response.status, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { label, url, ok: false, status: 0, ms: 0, error: error.message };
  }
}

async function getStorageState() {
  const localKeys = Object.keys(localStorage).filter((key) => key.startsWith('madrador'));
  let estimate = {};
  try { estimate = await navigator.storage?.estimate?.() || {}; } catch {}
  return {
    localKeys: localKeys.length,
    favorites: window.MadradorStorage?.favorites?.().length || 0,
    history: window.MadradorStorage?.history?.().length || 0,
    continueWatching: window.MadradorStorage?.continueWatching?.().length || 0,
    usage: estimate.usage || 0,
    quota: estimate.quota || 0
  };
}

function getClientState() {
  return {
    online: navigator.onLine,
    language: navigator.language,
    platform: navigator.userAgentData?.platform || navigator.platform || 'Inconnue',
    viewport: `${innerWidth} × ${innerHeight}`,
    touch: navigator.maxTouchPoints || 0,
    serviceWorker: Boolean(navigator.serviceWorker?.controller),
    standalone: matchMedia('(display-mode: standalone)').matches,
    userAgent: navigator.userAgent
  };
}

function renderTests(tests) {
  $('diagnosticTests').innerHTML = tests.map((test) => `
    <a class="admin-endpoint ${test.ok ? 'is-ok' : 'is-warn'}" href="${escapeHtml(test.url)}" target="_blank" rel="noreferrer">
      <i class="fa-solid ${test.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
      <span><b>${escapeHtml(test.label)}</b><small>${escapeHtml(test.url)}</small></span>
      <strong>${test.ok ? `${test.ms} ms` : `Erreur ${test.status || 'réseau'}`}</strong>
    </a>`).join('');
}

function renderClient(client, storage) {
  const values = [
    ['Connexion', client.online ? 'En ligne' : 'Hors ligne'],
    ['Plateforme', client.platform],
    ['Fenêtre', client.viewport],
    ['Tactile', `${client.touch} point(s)`],
    ['PWA', client.serviceWorker ? 'Active' : 'En installation'],
    ['Mode application', client.standalone ? 'Installée' : 'Navigateur'],
    ['Données locales', `${storage.localKeys} clés Madrador`],
    ['Bibliothèque', `${storage.favorites} favoris · ${storage.history} historiques · ${storage.continueWatching} reprises`]
  ];
  $('diagnosticClient').innerHTML = values.map(([label, value]) => `<span>${escapeHtml(label)} : ${escapeHtml(value)}</span>`).join('');
}

function renderSummary(tests, storage, client) {
  const failures = tests.filter((test) => !test.ok).length;
  const average = Math.round(tests.reduce((sum, test) => sum + test.ms, 0) / Math.max(1, tests.length));
  const items = [
    ['fa-stethoscope', 'État global', failures ? `${failures} erreur(s)` : 'Opérationnel', failures === 0],
    ['fa-server', 'Serveur', `${average} ms moyen`, failures === 0],
    ['fa-database', 'Stockage', `${storage.localKeys} éléments`, true],
    ['fa-mobile-screen', 'Appareil', client.online ? 'Connecté' : 'Hors ligne', client.online]
  ];
  $('diagnosticSummary').innerHTML = items.map(([icon, label, value, ok]) => `
    <article class="${ok ? 'is-ok' : 'is-warn'}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>
  `).join('');
}

async function clearClientCache() {
  Object.keys(localStorage).filter((key) => key.startsWith('madrador:cache:')).forEach((key) => localStorage.removeItem(key));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  showToast('Cache local nettoyé');
  runDiagnostics();
}

async function copyDiagnostic() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    showToast('Diagnostic copié');
  } catch { showToast('Copie indisponible'); }
}

function setBusy(busy) {
  const button = $('diagnosticRun');
  button.disabled = busy;
  button.innerHTML = busy
    ? '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Analyse...</span>'
    : '<i class="fa-solid fa-play"></i><span>Lancer les tests</span>';
}

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => $('toast').classList.add('hidden'), 1800);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
