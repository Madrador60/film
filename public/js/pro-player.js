(() => {
  const Store = window.MadradorProStore;
  const MainStore = window.MadradorStorage;
  const qs = (s,r=document) => r.querySelector(s);
  const qsa = (s,r=document) => [...r.querySelectorAll(s)];

  function toast(msg){ window.MadradorPro?.toast ? window.MadradorPro.toast(msg) : console.log(msg); }
  function currentId(){ return new URLSearchParams(location.search).get('id'); }
  function isFavorite(id){
    return MainStore?.isFavorite ? MainStore.isFavorite(id) : Store.isFavorite(id);
  }
  function toggleFavorite(item){
    if (MainStore?.isFavorite && MainStore?.addFavorite && MainStore?.removeFavorite) {
      if (MainStore.isFavorite(item.id)) {
        MainStore.removeFavorite(item.id);
        return false;
      }
      MainStore.addFavorite(item);
      return true;
    }
    return Store.toggleFavorite(item);
  }

  function addTools(){
    if(!location.pathname.includes('player') || qs('#proPlayerTools')) return;
    const host = qs('.player-page') || qs('main') || document.body;
    const tools = document.createElement('div');
    tools.id = 'proPlayerTools';
    tools.className = 'pro-player-tools pro-glass';
    tools.style.padding = '12px';
    tools.style.borderRadius = '20px';
    tools.innerHTML = `
      <button class="pro-btn" data-act="cinema">Mode cinéma</button>
      <button class="pro-btn" data-act="external">Ouvrir lecteur externe</button>
      <button class="pro-btn" data-act="copy">Copier URL lecteur</button>
      <button class="pro-btn" data-act="fav">${isFavorite(currentId()) ? 'Dans ma liste' : 'Favori'}</button>
      <button class="pro-btn" data-act="home">Accueil</button>
      <div class="pro-source-health" id="proSourceHealth">Source : en attente</div>
    `;
    host.prepend(tools);

    tools.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if(!b) return;
      const iframe = qs('iframe');
      const src = iframe?.src || '';
      if(b.dataset.act === 'cinema'){
        document.body.classList.toggle('pro-cinema');
        toast('Mode cinéma modifié');
      }
      if(b.dataset.act === 'external'){
        if(src) open(src, '_blank');
        else toast('Aucune source chargée');
      }
      if(b.dataset.act === 'copy'){
        if(src && navigator.clipboard){ await navigator.clipboard.writeText(src); toast('URL copiée'); }
        else toast('Copie impossible');
      }
      if(b.dataset.act === 'home') location.href = './index.html';
      if(b.dataset.act === 'fav'){
        const id = currentId();
        const title = qs('h1')?.textContent || 'Sans titre';
        const poster = qs('img')?.src || '';
        const active = toggleFavorite({ id, title, poster, type:new URLSearchParams(location.search).get('type') === 'series' ? 'series' : 'movies' });
        b.textContent = active ? 'Dans ma liste' : 'Favori';
        toast(active ? 'Ajouté aux favoris' : 'Retiré des favoris');
      }
    });
  }

  function monitorIframe(){
    const iframe = qs('iframe');
    if(!iframe) return;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('allow', 'fullscreen; autoplay; encrypted-media; picture-in-picture');
    iframe.setAttribute('referrerpolicy', 'no-referrer');

    const update = () => {
      const health = qs('#proSourceHealth');
      if(health) health.textContent = iframe.src ? 'Source : chargée' : 'Source : en attente';
    };
    iframe.addEventListener('load', update);
    setInterval(update, 2000);

    const settings = Store.settings();
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if(settings.openExternalMobile && isMobile && iframe.src){
      open(iframe.src, '_blank');
    }
  }

  function shortcuts(){
    document.addEventListener('keydown', (e) => {
      if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;
      if(e.key.toLowerCase() === 'c'){
        document.body.classList.toggle('pro-cinema');
        toast('Mode cinéma');
      }
      if(e.key === 'Escape' && document.body.classList.contains('pro-cinema')){
        document.body.classList.remove('pro-cinema');
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    addTools();
    monitorIframe();
    shortcuts();
  });
})();
