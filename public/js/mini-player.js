(() => {
  if (typeof MadradorStorage === 'undefined' || document.body.classList.contains('player-body')) return;
  if (MadradorStorage.getPrefs().miniPlayerEnabled === false) return;

  const state = MadradorStorage.miniPlayer();
  if (!state?.sourceUrl || !state?.title) return;

  const root = document.createElement('aside');
  root.className = 'mini-player collapsed';
  root.innerHTML = `
    <div class="mini-head">
      <button class="mini-toggle" type="button" aria-label="Afficher le mini lecteur">
        <i class="fa-solid fa-circle-play"></i>
      </button>
      <div>
        <strong>${escapeHtml(getTitle(state))}</strong>
        <span>${escapeHtml(getMeta(state))}</span>
      </div>
      <button class="mini-close" type="button" aria-label="Fermer le mini lecteur"><i class="fa-solid fa-xmark"></i></button>
    </div>
    <div class="mini-screen">
      <iframe
        src="${escapeHtml(state.sourceUrl)}"
        allow="fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        referrerpolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"></iframe>
    </div>
    <div class="mini-actions">
      <a class="btn primary" href="${escapeHtml(state.playerUrl || './index.html')}"><i class="fa-solid fa-up-right-from-square"></i><span>Ouvrir</span></a>
      <button class="btn glass" type="button" data-mini-collapse><i class="fa-solid fa-down-left-and-up-right-to-center"></i><span>Réduire</span></button>
    </div>`;

  document.body.appendChild(root);

  const toggle = root.querySelector('.mini-toggle');
  const close = root.querySelector('.mini-close');
  const collapse = root.querySelector('[data-mini-collapse]');

  toggle.addEventListener('click', () => root.classList.toggle('collapsed'));
  collapse.addEventListener('click', () => root.classList.add('collapsed'));
  close.addEventListener('click', () => {
    MadradorStorage.clearMiniPlayer();
    root.remove();
  });

  function getMeta(item) {
    const parts = [];
    if (item.type === 'series') parts.push('Série');
    else parts.push('Film');
    if (item.season) parts.push(`S${item.season}`);
    if (item.episode) parts.push(`E${item.episode}`);
    if (item.sourceName) parts.push(item.sourceName);
    return parts.join(' • ');
  }

  function getTitle(item) {
    const title = String(item.title || '');
    if (item.type === 'series') {
      return title
        .replace(/\s*[-–—:|]\s*(?:saison|season)\s*\d{1,2}.*$/i, '')
        .replace(/\s+\bS\d{1,2}\b.*$/i, '')
        .trim() || title;
    }
    return title;
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[char]));
  }
})();
