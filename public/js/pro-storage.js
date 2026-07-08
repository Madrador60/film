window.MadradorProStore = (() => {
  const read = (k, d) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
  };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  return {
    read, write,
    settings(){ return read('madrador_pro_settings', { preferredSource:'premium', cleanMode:true, openExternalMobile:false, catalogLimit:4 }); },
    saveSettings(s){ write('madrador_pro_settings', s); },
    favorites(){ return read('madrador_favorites', []); },
    isFavorite(id){ return this.favorites().some(x => String(x.id) === String(id)); },
    toggleFavorite(item){
      const list = this.favorites();
      const i = list.findIndex(x => String(x.id) === String(item.id));
      if(i >= 0) list.splice(i, 1);
      else list.unshift({ ...item, savedAt: Date.now() });
      write('madrador_favorites', list.slice(0, 300));
      return i < 0;
    },
    history(){ return read('madrador_history', []); },
    addHistory(item){
      const list = this.history().filter(x => String(x.id) !== String(item.id));
      list.unshift({ ...item, watchedAt: Date.now() });
      write('madrador_history', list.slice(0, 200));
    },
    progress(){ return read('madrador_progress', {}); },
    setProgress(id, data){
      const p = this.progress();
      p[id] = { ...data, updatedAt: Date.now() };
      write('madrador_progress', p);
    },
    cache(){ return read('madrador_pro_catalog_cache', null); },
    saveCache(items){ write('madrador_pro_catalog_cache', { time: Date.now(), items }); },
    clearUiCache(){ localStorage.removeItem('madrador_pro_catalog_cache'); }
  };
})();
