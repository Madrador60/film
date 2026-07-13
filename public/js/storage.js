const MadradorStorage = (() => {
  const KEYS = {
    favorites: 'madrador:favorites',
    history: 'madrador:history',
    continue: 'madrador:continue',
    miniPlayer: 'madrador:mini-player',
    prefs: 'madrador:prefs'
  };
  const MEDIA_PREFIX = 'madrador:media:';

  const DEFAULT_PREFS = {
    theme: 'dark',
    accent: 'violet',
    density: 'comfortable',
    cardStyle: 'cinema',
    reduceMotion: false,
    preferredSource: 'vidzy',
    playerTimeoutMs: 9000,
    lastSource: '',
    autoplay: true,
    autoSourceFallback: true,
    resumePlayback: true,
    rememberLastSource: false,
    miniPlayerEnabled: false,
    antiPopupEnabled: true,
    preferredVersion: 'VF',
    preloadPosters: true,
    dataSaver: false
  };

  function read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function list(key) {
    return uniqueMediaList(read(key, []).map(normalizeMediaItem));
  }

  function upsert(key, item, limit = 48) {
    if (!item?.id) return;
    const normalized = normalizeMediaItem(item);
    const identity = mediaIdentity(normalized);
    const next = [normalized, ...list(key).filter((saved) => mediaIdentity(saved) !== identity)].slice(0, limit);
    write(key, next);
  }

  function remove(key, id) {
    const target = list(key).find((item) => item.id === id);
    const identity = target ? mediaIdentity(target) : String(id);
    write(key, list(key).filter((item) => item.id !== id && mediaIdentity(item) !== identity));
  }

  function clear(key) {
    localStorage.removeItem(key);
  }

  function media(details) {
    return normalizeMediaItem({
      id: details.id,
      title: details.title || details.name || 'Sans titre',
      description: details.description || details.synopsis || details.desc || '',
      poster: details.poster || details.affiche || details.image || '',
      backdrop: details.backdrop || details.cover || '',
      quality: details.quality || 'HD',
      version: details.version || 'VF',
      year: details.year || '',
      type: normalizeMediaType(details),
      isSeries: normalizeMediaType(details) === 'series',
      seriesTitle: details.seriesTitle || '',
      savedAt: Date.now()
    });
  }

  function normalizeMediaType(item) {
    const raw = String(item?.type || '').toLowerCase();
    if (item?.isSeries === true || raw === 'series' || raw === 'serie' || raw === 'tv') return 'series';
    if (item?.isSeries === false || raw === 'movie' || raw === 'movies' || raw === 'film') return 'movies';
    return item?.season || item?.episode ? 'series' : 'movies';
  }

  function normalizeMediaItem(item = {}) {
    const type = normalizeMediaType(item);
    const normalized = {
      ...item,
      type,
      isSeries: type === 'series'
    };
    if (type === 'series') normalized.seriesTitle = item.seriesTitle || stripSeasonTitle(item.title || '');
    else delete normalized.seriesTitle;
    return normalized;
  }

  function uniqueMediaList(items) {
    const seen = new Set();
    return items.filter((item) => {
      const identity = mediaIdentity(item);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }

  function mediaIdentity(item) {
    const type = normalizeMediaType(item);
    const title = stripSeasonTitle(item?.seriesTitle || item?.title || item?.originalTitle || '');
    if (type === 'series') {
      return `series:${normalizeKey(title)}`;
    }
    return `movie:${item?.id || normalizeKey(item?.title || '')}`;
  }

  function stripSeasonTitle(title) {
    return String(title || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[-–—:|]\s*(?:saison|season)\s*\d{1,2}.*$/i, '')
      .replace(/\s+(?:saison|season)\s*\d{1,2}.*$/i, '')
      .replace(/\s*[-–—:|]\s*S\d{1,2}.*$/i, '')
      .replace(/\s+\bS\d{1,2}\b.*$/i, '')
      .trim();
  }

  function normalizeKey(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function getPrefs() {
    const saved = read(KEYS.prefs, {});
    if (Number(saved.paletteVersion || 0) < 2) {
      saved.theme = 'dark';
      saved.accent = 'violet';
      saved.miniPlayerEnabled = false;
      saved.paletteVersion = 2;
      write(KEYS.prefs, saved);
    }
    if (saved.preferredSource === 'premium' && !saved.vidzyDefaultApplied) {
      saved.preferredSource = 'vidzy';
      saved.vidzyDefaultApplied = true;
      write(KEYS.prefs, saved);
    }
    return { ...DEFAULT_PREFS, ...saved };
  }

  function setPrefs(prefs) {
    write(KEYS.prefs, { ...getPrefs(), ...prefs });
  }

  function applyPrefs() {
    const prefs = getPrefs();
    document.documentElement.dataset.theme = prefs.theme;
    document.documentElement.dataset.accent = prefs.accent;
    document.documentElement.dataset.density = prefs.density;
    document.documentElement.dataset.cardStyle = prefs.cardStyle;
    document.documentElement.dataset.motion = prefs.reduceMotion ? 'reduced' : 'full';
  }

  function rememberMedia(item) {
    if (!item?.id) return;
    write(`${MEDIA_PREFIX}${item.id}`, { ...normalizeMediaItem(item), rememberedAt: Date.now() });
  }

  function findMedia(id) {
    const remembered = normalizeMediaItem(read(`${MEDIA_PREFIX}${id}`, {}));
    if (remembered.id) return remembered;
    return [...list(KEYS.continue), ...list(KEYS.favorites), ...list(KEYS.history)]
      .find((item) => String(item.id) === String(id)) || null;
  }

  return {
    KEYS,
    DEFAULT_PREFS,
    getPrefs,
    setPrefs,
    applyPrefs,
    media,
    normalizeMediaType,
    normalizeMediaItem,
    rememberMedia,
    findMedia,
    favorites: () => list(KEYS.favorites),
    history: () => list(KEYS.history),
    continueWatching: () => list(KEYS.continue),
    miniPlayer: () => read(KEYS.miniPlayer, null),
    setMiniPlayer: (item) => write(KEYS.miniPlayer, item),
    clearMiniPlayer: () => clear(KEYS.miniPlayer),
    addFavorite: (item) => upsert(KEYS.favorites, item),
    removeFavorite: (id) => remove(KEYS.favorites, id),
    isFavorite: (id) => list(KEYS.favorites).some((item) => item.id === id),
    addHistory: (item) => upsert(KEYS.history, item),
    addContinue: (item) => upsert(KEYS.continue, item),
    clearFavorites: () => clear(KEYS.favorites),
    clearHistory: () => clear(KEYS.history),
    clearContinue: () => clear(KEYS.continue),
    clearCache: () => {
      Object.values(KEYS).forEach(clear);
      Object.keys(localStorage)
        .filter((key) => key.startsWith('madrador:cache:') || key.startsWith(MEDIA_PREFIX))
        .forEach((key) => localStorage.removeItem(key));
      setPrefs(DEFAULT_PREFS);
    }
  };
})();

MadradorStorage.applyPrefs();
