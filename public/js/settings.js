const $ = (id) => document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  hydrateSettings();
  bindSettings();
  renderServerStats();
});

function hydrateSettings() {
  const prefs = MadradorStorage.getPrefs();
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.checked = input.value === prefs.theme;
  });

  ['accent', 'density', 'cardStyle', 'preferredSource', 'preferredVersion'].forEach((id) => {
    $(id).value = prefs[id];
  });

  ['reduceMotion', 'autoplay', 'resumePlayback', 'rememberLastSource', 'miniPlayerEnabled', 'antiPopupEnabled', 'preloadPosters', 'dataSaver'].forEach((id) => {
    $(id).checked = Boolean(prefs[id]);
  });

  renderLocalStats();
  renderSettingsPreview(prefs);
}

function bindSettings() {
  document.querySelectorAll('input[name="theme"]').forEach((input) => {
    input.addEventListener('change', saveSettings);
  });

  ['accent', 'density', 'cardStyle', 'preferredSource', 'preferredVersion'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });

  ['reduceMotion', 'autoplay', 'resumePlayback', 'rememberLastSource', 'miniPlayerEnabled', 'antiPopupEnabled', 'preloadPosters', 'dataSaver'].forEach((id) => {
    $(id).addEventListener('change', saveSettings);
  });

  document.querySelectorAll('[data-clear]').forEach((button) => {
    button.addEventListener('click', () => clearLocal(button.dataset.clear));
  });

  $('resetAppearance').addEventListener('click', resetAppearance);
  $('exportData').addEventListener('click', exportLocalData);
  $('importData').addEventListener('change', importLocalData);
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
    preferredVersion: $('preferredVersion').value,
    autoplay: $('autoplay').checked,
    resumePlayback: $('resumePlayback').checked,
    rememberLastSource: $('rememberLastSource').checked,
    miniPlayerEnabled: $('miniPlayerEnabled').checked,
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

  actions[type]?.();
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
      dark: 'Nuit bleue',
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

function exportLocalData() {
  const data = {};
  Object.keys(localStorage)
    .filter((key) => key.startsWith('madrador:'))
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
      if (key.startsWith('madrador:') && typeof value === 'string') {
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
    box.innerHTML = [
      ['Domaine actif', data.source || data.domain || 'Inconnu'],
      ['Cache serveur', String(data.cacheSize ?? data.cacheItems ?? 0)],
      ['Uptime', `${Math.round(data.uptime || 0)}s`]
    ].map(([label, value]) => `<span>${escapeHtml(label)} : ${escapeHtml(value)}</span>`).join('');
  } catch (err) {
    box.innerHTML = '<span>Domaine actif : indisponible</span><span>Le serveur local ne répond pas aux statistiques.</span>';
  }
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
