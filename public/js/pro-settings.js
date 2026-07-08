(() => {
  const Store = window.MadradorProStore;
  const MainStore = window.MadradorStorage;
  const qs = (s,r=document)=>r.querySelector(s);

  document.addEventListener('DOMContentLoaded', () => {
    const host = qs('main') || document.body;
    if(qs('#proSettingsPanel')) return;
    const s = Store.settings();

    const panel = document.createElement('section');
    panel.id = 'proSettingsPanel';
    panel.className = 'pro-glass';
    panel.style.cssText = 'padding:20px;border-radius:24px;margin:20px 0;';
    panel.innerHTML = `
      <h2>Paramètres Pro</h2>
      <label>Source préférée
        <select class="pro-select" id="proPreferred">
          <option value="premium">Premium</option>
          <option value="vidzy">Vidzy</option>
          <option value="voe">Voe</option>
          <option value="uqload">Uqload</option>
          <option value="netu">Netu</option>
        </select>
      </label>
      <br><br>
      <label><input type="checkbox" id="proClean"> Mode lecture propre</label>
      <br>
      <label><input type="checkbox" id="proExternalMobile"> Ouvrir automatiquement en externe sur mobile</label>
      <br><br>
      <label>Chargement catalogue
        <select class="pro-select" id="proLimit">
          <option value="2">Rapide</option>
          <option value="4">Normal</option>
          <option value="8">Large</option>
          <option value="12">Très large</option>
        </select>
      </label>
      <br><br>
      <button class="pro-btn" id="proClearCache">Nettoyer cache interface</button>
      <button class="pro-btn" id="proClearAll">Réinitialiser données locales</button>
    `;
    host.appendChild(panel);

    qs('#proPreferred').value = s.preferredSource || 'premium';
    qs('#proClean').checked = s.cleanMode !== false;
    qs('#proExternalMobile').checked = !!s.openExternalMobile;
    qs('#proLimit').value = String(s.catalogLimit || 4);

    panel.addEventListener('change', save);
    qs('#proClearCache').onclick = () => { Store.clearUiCache(); alert('Cache nettoyé'); };
    qs('#proClearAll').onclick = () => {
      if(confirm('Tout effacer ? Favoris, historique, préférences.')){
        if (MainStore?.clearCache) MainStore.clearCache();
        ['madrador_favorites','madrador_history','madrador_progress','madrador_pro_settings','madrador_pro_catalog_cache'].forEach(k=>localStorage.removeItem(k));
        alert('Données supprimées');
      }
    };

    function save(){
      const next = {
        preferredSource: qs('#proPreferred').value,
        cleanMode: qs('#proClean').checked,
        openExternalMobile: qs('#proExternalMobile').checked,
        catalogLimit: Number(qs('#proLimit').value)
      };
      Store.saveSettings(next);
      if (MainStore?.setPrefs) {
        MainStore.setPrefs({
          preferredSource: next.preferredSource,
          miniPlayerEnabled: next.cleanMode,
          dataSaver: Number(next.catalogLimit) <= 2
        });
      }
    }
  });
})();
