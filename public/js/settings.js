const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  hydrateSettings();
  bindSettings();
  renderCatalogStatus();
  renderAppInfo();
  hydratePreviewArtwork();
  updateInstallButton();
});

function renderAppInfo() {
  if ($('appVersion')) $('appVersion').textContent = 'Madrador TV • Édition 2026';
}

function updateInstallButton() {
  const button = $('installPwa');
  if (!button) return;
  const installed = window.MadradorPWA?.isInstalled?.();
  const available = window.MadradorPWA?.canInstall?.();
  button.disabled = installed || !available;
  button.innerHTML = installed
    ? '<i class="fa-solid fa-circle-check"></i><span>Application installée</span>'
    : available
      ? '<i class="fa-solid fa-download"></i><span>Installer Madrador TV</span>'
      : '<i class="fa-solid fa-mobile-screen"></i><span>Installation via le navigateur</span>';
}

function hydrateSettings() {
  const prefs = MadradorStorage.getPrefs();
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === prefs.theme;
  });

  ['accent', 'density', 'cardStyle', 'preferredSource', 'preferredVersion', 'playerTimeoutMs'].forEach((id) => {
    $(id).value = prefs[id];
  });

  ['reduceMotion', 'autoplay', 'autoSourceFallback', 'resumePlayback', 'rememberLastSource', 'antiPopupEnabled', 'preloadPosters', 'dataSaver'].forEach((id) => {
    if ($(id)) $(id).checked = Boolean(prefs[id]);
  });

  renderLocalStats();
  renderSettingsPreview(prefs);
}

function bindSettings() {
  $('mobileMenu')?.addEventListener('click', () => $('sidebar')?.classList.toggle('open'));

  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', () => {
      const recommendedAccent = { dark: 'violet', candy: 'pink', emerald: 'green' }[input.value];
      if (recommendedAccent) $('accent').value = recommendedAccent;
      saveSettings();
    });
  });

  ['accent', 'density', 'cardStyle', 'preferredSource', 'preferredVersion', 'playerTimeoutMs'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });

  ['reduceMotion', 'autoplay', 'autoSourceFallback', 'resumePlayback', 'rememberLastSource', 'antiPopupEnabled', 'preloadPosters', 'dataSaver'].forEach((id) => {
    $(id)?.addEventListener('change', saveSettings);
  });

  document.querySelectorAll('[data-clear]').forEach((button) => {
    button.addEventListener('click', () => clearLocal(button.dataset.clear));
  });

  $('resetAppearance').addEventListener('click', resetAppearance);
  $('exportData').addEventListener('click', exportLocalData);
  $('importData').addEventListener('change', importLocalData);
  $('refreshCatalogStatus')?.addEventListener('click', renderCatalogStatus);
  $('warmCatalog')?.addEventListener('click', warmCatalogCache);
  $('installPwa')?.addEventListener('click', async () => {
    const installed = await window.MadradorPWA?.install?.();
    showToast(installed ? 'Installation lancée' : 'Installation annulée');
    updateInstallButton();
  });
  window.addEventListener('madrador:pwa-state', updateInstallButton);
}

function saveSettings() {
  const theme = document.querySelector('input[name="theme"]:checked')?.value || 'dark';
  MadradorStorage.setPrefs({
    theme,
    accent: $('accent').value,
    density: $('density').value,
    cardStyle: $('cardStyle').value,
    reduceMotion: $('reduceMotion').checked,
    preferredSource: $('preferredSource').value,
    playerTimeoutMs: Number($('playerTimeoutMs').value) || 9000,
    preferredVersion: $('preferredVersion').value,
    autoplay: $('autoplay').checked,
    autoSourceFallback: $('autoSourceFallback').checked,
    resumePlayback: $('resumePlayback').checked,
    rememberLastSource: $('rememberLastSource').checked,
    miniPlayerEnabled: false,
    antiPopupEnabled: $('antiPopupEnabled').checked,
    preloadPosters: $('preloadPosters').checked,
    dataSaver: $('dataSaver').checked
  });
  MadradorStorage.applyPrefs();
  renderSettingsPreview(MadradorStorage.getPrefs());
  showToast('Paramètres sauvegardés');
}

function clearLocal(type) {
  const actions = {
    cache: () => MadradorStorage.clearCache(),
    history: () => MadradorStorage.clearHistory(),
    favorites: () => MadradorStorage.clearFavorites(),
    continue: () => MadradorStorage.clearContinue(),
    mini: () => MadradorStorage.clearMiniPlayer()
  };

  if (!actions[type]) return;
  const labels = {
    cache: 'le cache local',
    history: 'tout l’historique',
    favorites: 'tous les favoris',
    continue: 'toutes les reprises de lecture',
    mini: 'le mini-lecteur mémorisé'
  };
  if (!window.confirm(`Supprimer ${labels[type]} ? Cette action est définitive.`)) return;
  actions[type]();
  hydrateSettings();
  MadradorStorage.applyPrefs();
  renderLocalStats();
  showToast('Données effacées');
}

function resetAppearance() {
  MadradorStorage.setPrefs({
    theme: 'dark',
    accent: 'violet',
    density: 'comfortable',
    cardStyle: 'cinema',
    reduceMotion: false
  });
  hydrateSettings();
  MadradorStorage.applyPrefs();
  showToast('Apparence réinitialisée');
}

function renderSettingsPreview(prefs = MadradorStorage.getPrefs()) {
  const labels = {
    theme: {
      dark: 'Bleu & violet',
      candy: 'Rose bonbon',
      emerald: 'Vert Madrador',
      oled: 'OLED',
      nebula: 'Nébuleuse',
      cinema: 'Cinéma'
    },
    accent: {
      violet: 'Violet',
      blue: 'Bleu',
      cyan: 'Cyan',
      pink: 'Rose',
      green: 'Vert',
      red: 'Rouge'
    },
    density: {
      comfortable: 'Confortable',
      compact: 'Compacte'
    },
    cardStyle: {
      cinema: 'Cartes cinéma',
      flat: 'Cartes plates'
    }
  };

  $('previewTheme').textContent = `${labels.theme[prefs.theme] || prefs.theme} • ${labels.accent[prefs.accent] || prefs.accent}`;
  $('previewTitle').textContent = prefs.dataSaver ? 'Mode économie' : 'Madrador Preview';
  $('previewQuality').textContent = prefs.preferredVersion || 'HD';
  $('previewText').textContent = `${labels.cardStyle[prefs.cardStyle] || 'Cartes cinéma'}, interface ${labels.density[prefs.density] || 'confortable'}, ${prefs.preferredSource || 'vidzy'} par défaut.`;
  $('previewPills').innerHTML = [
    prefs.autoplay ? 'Autoplay' : 'Lecture manuelle',
    prefs.resumePlayback ? 'Reprise active' : 'Sans reprise',
    prefs.antiPopupEnabled ? 'Anti-popup actif' : 'Anti-popup désactivé',
    prefs.reduceMotion ? 'Animations réduites' : 'Animations fluides'
  ].map((label) => `<span>${escapeHtml(label)}</span>`).join('');
}

async function hydratePreviewArtwork() {
  const preview = $('previewPoster');
  if (!preview) return;
  try {
    const response = await fetch('/api/catalog/bootstrap?limit=4', { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const movies = Array.isArray(data.movies) ? data.movies : (data.movies?.items || []);
    const series = Array.isArray(data.series) ? data.series : (data.series?.items || []);
    const item = [...movies, ...series].find((entry) => entry?.poster || entry?.backdrop);
    const image = item?.poster || item?.backdrop;
    if (!image) return;
    preview.src = String(image).replace('/original/', '/w300/').replace('/w1280/', '/w300/').replace('/w780/', '/w300/');
    preview.alt = item.title ? `Aperçu de ${item.title}` : 'Aperçu Madrador TV';
    $('previewTitle').textContent = item.title || 'Madrador Preview';
  } catch (error) {
    preview.src = './assets/madrador-logo.png';
  }
}

function exportLocalData() {
  const data = {};
  Object.keys(localStorage)
    .filter((key) => key.startsWith('madrador:') || key.startsWith('madrador_'))
    .forEach((key) => {
      data[key] = localStorage.getItem(key);
    });

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `madrador-tv-local-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Export préparé');
}

async function importLocalData(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    Object.entries(data).forEach(([key, value]) => {
      if ((key.startsWith('madrador:') || key.startsWith('madrador_')) && typeof value === 'string') {
        localStorage.setItem(key, value);
      }
    });
    hydrateSettings();
    MadradorStorage.applyPrefs();
    renderLocalStats();
    showToast('Données importées');
  } catch (err) {
    showToast('Import impossible');
  } finally {
    event.target.value = '';
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add('hidden'), 1600);
}

function renderLocalStats() {
  const box = $('localStats');
  if (!box) return;
  const cacheCount = Object.keys(localStorage).filter((key) => key.startsWith('madrador:cache:')).length;
  const stats = [
    ['Favoris', MadradorStorage.favorites().length],
    ['Historique', MadradorStorage.history().length],
    ['À reprendre', MadradorStorage.continueWatching().length],
    ['Cache', cacheCount]
  ];
  box.innerHTML = stats.map(([label, value]) => `
    <span><b>${value}</b><small>${label}</small></span>
  `).join('');
}

async function renderServerStats() {
  const box = $('serverStats');
  if (!box) return;

  try {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const memory = data.memory?.rss ? `${Math.round(data.memory.rss / 1024 / 1024)} Mo RAM` : `${Math.round(Number(data.memory || 0) / 1024 / 1024) || 0} Mo RAM`;
    box.innerHTML = [
      ['Domaine actif', data.source || data.domain || 'Inconnu'],
      ['Cache serveur', String(data.cacheSize ?? data.cacheItems ?? 0)],
      ['Uptime', formatUptime(data.uptime || 0)],
      ['Mémoire', memory],
      ['Keepalive', '/api/keepalive prêt']
    ].map(([label, value]) => `<span>${escapeHtml(label)} : ${escapeHtml(value)}</span>`).join('');
  } catch (err) {
    box.innerHTML = '<span>Domaine actif : indisponible</span><span>Le serveur local ne répond pas aux statistiques.</span>';
  }
}

async function pingKeepalive() {
  const button = $('pingKeepalive');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Test...</span>';
  }

  try {
    const res = await fetch('/api/keepalive', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    showToast(`Keepalive OK • uptime ${formatUptime(data.uptime || 0)}`);
    renderServerStats();
  } catch (err) {
    showToast('Keepalive indisponible');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-signal"></i><span>Tester keepalive</span>';
    }
  }
}

async function renderCatalogStatus() {
  setCatalogHealthLoading(true);
  try {
    const res = await fetch('/api/catalog/status?limit=all', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    paintCatalogHealth(data);
  } catch (err) {
    paintCatalogHealthError('Statut catalogue indisponible.');
  } finally {
    setCatalogHealthLoading(false);
  }
}

async function warmCatalogCache() {
  const button = $('warmCatalog');
  if (button) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i><span>Préparation...</span>';
  }

  try {
    const res = await fetch('/api/cache/warm?limit=all', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    paintCatalogHealth({
      source: data.source,
      film: data.status?.film,
      series: data.status?.series,
      ready: data.ready,
      updatedAt: data.timestamp
    });
    showToast('Préparation du catalogue lancée');
  } catch (err) {
    showToast('Préparation indisponible');
    paintCatalogHealthError('Impossible de lancer la préparation du catalogue.');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="fa-solid fa-fire-flame-curved"></i><span>Préparer le catalogue</span>';
    }
  }
}

function paintCatalogHealth(data) {
  const film = data?.film || {};
  const series = data?.series || {};
  const ready = data?.ready || (film.state === 'ready' && series.state === 'ready');
  const building = [film.state, series.state].some((state) => ['building', 'queued'].includes(state));

  $('catalogHealthState').innerHTML = ready
    ? '<i class="fa-solid fa-circle-check"></i> Catalogue complet prêt'
    : building
      ? '<i class="fa-solid fa-circle-notch fa-spin"></i> Catalogue en préparation'
      : '<i class="fa-solid fa-circle-info"></i> Catalogue à préparer';

  $('catalogHealthSource').textContent = `Source : ${data?.source || 'serveur Madrador'}`;
  paintCatalogProgress('catalogFilm', film, 'films');
  paintCatalogProgress('catalogSeries', series, 'séries');

  const message = ready
    ? 'Le catalogue complet est disponible depuis le cache serveur.'
    : building
      ? 'Le scan continue en arrière-plan. UptimeRobot peut rappeler /api/cache/warm pour reprendre si Render redémarre.'
      : 'Clique sur Préparer le catalogue pour lancer ou reprendre le scan complet.';
  $('catalogHealthMessage').textContent = message;
}

function paintCatalogProgress(prefix, state, label) {
  const page = Number(state?.page || 0);
  const limit = Number(state?.limit || 0);
  const total = Number(state?.total || 0);
  const percent = limit ? Math.max(0, Math.min(100, Math.round((page / limit) * 100))) : 0;
  const statusLabel = getCatalogStateLabel(state?.state);

  $(`${prefix}Text`).textContent = `${statusLabel} • page ${page}/${limit || '?'} • ${total} ${label}`;
  $(`${prefix}Progress`).style.width = `${percent}%`;
}

function getCatalogStateLabel(state) {
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

function paintCatalogHealthError(message) {
  $('catalogHealthState').innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Catalogue indisponible';
  $('catalogHealthSource').textContent = 'Source : inconnue';
  $('catalogFilmText').textContent = 'Films : indisponible';
  $('catalogSeriesText').textContent = 'Séries : indisponible';
  $('catalogFilmProgress').style.width = '0%';
  $('catalogSeriesProgress').style.width = '0%';
  $('catalogHealthMessage').textContent = message;
}

function setCatalogHealthLoading(loading) {
  $('refreshCatalogStatus')?.toggleAttribute('disabled', loading);
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
