(() => {
  const Store = window.MadradorProStore;
  const qs = (s,r=document) => r.querySelector(s);
  const qsa = (s,r=document) => [...r.querySelectorAll(s)];
  const state = { movies:[], series:[], all:[], filtered:[], booted:false };

  function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function toast(msg){
    let box = qs('.pro-toast');
    if(!box){ box = document.createElement('div'); box.className = 'pro-toast'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'pro-toast-item pro-glass';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  function api(url){ return fetch(url).then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }); }
  async function loadBootstrapCatalog(limit){
    try{
      return await api(`/api/catalog/bootstrap?limit=${encodeURIComponent(limit)}`);
    }catch(error){
      console.warn('[PRO UI] /api/catalog/bootstrap indisponible, fallback /all.', error);
      try{
        const [movies, series] = await Promise.all([
          api(`/api/movies/all?limit=${encodeURIComponent(limit)}`),
          api(`/api/series/all?limit=${encodeURIComponent(limit)}`)
        ]);
        return {
          ok: true,
          source: 'fallback-all',
          limit,
          movies,
          series,
          items: [...(movies.items || []), ...(series.items || [])],
          totals: {
            movies: movies.total || (movies.items || []).length,
            series: series.total || (series.items || []).length
          }
        };
      }catch(allError){
        console.warn('[PRO UI] /all indisponible, fallback page 1.', allError);
        const [movies, series] = await Promise.all([
          api('/api/movies?page=1'),
          api('/api/series?page=1')
        ]);
        return {
          ok: true,
          source: 'fallback-page',
          limit: 1,
          movies: { type:'movie', total:(movies.items || []).length, items:movies.items || [] },
          series: { type:'series', total:(series.items || []).length, items:series.items || [] },
          items: [...(movies.items || []), ...(series.items || [])],
          totals: {
            movies: (movies.items || []).length,
            series: (series.items || []).length
          }
        };
      }
    }
  }
  function norm(item){
    return {
      id:item.id||item.newsId||'',
      title:item.title||'Sans titre',
      poster:item.poster||item.image||item.img||'',
      quality:item.quality||'HD',
      type:item.type|| (item.isSeries ? 'series':'movie'),
      isSeries:item.isSeries || item.type === 'series',
      year:item.year||'',
      version:item.version||''
    };
  }
  function shuffle(a){return [...a].map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1])}
  function openItem(item){ location.href = `./player.html?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(item.type)}`; }

  function card(item){
    item = norm(item);
    const fav = Store.isFavorite(item.id);
    return `<article class="pro-card" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}">
      <button class="pro-fav ${fav?'active':''}" data-fav="${escapeHtml(item.id)}">♥</button>
      <span class="pro-badge">${escapeHtml(item.quality || (item.isSeries?'Série':'HD'))}</span>
      <div class="pro-poster">${item.poster ? `<img src="${escapeHtml(item.poster)}" loading="lazy" alt="">` : ''}<div class="pro-card-play"><i>▶</i></div></div>
      <div class="pro-card-info"><h3>${escapeHtml(item.title)}</h3><p>${item.type === 'series' ? 'Série' : 'Film'} ${item.version ? '• '+escapeHtml(item.version) : ''}</p></div>
    </article>`;
  }
  function row(title, items){
    return `<section class="pro-section"><div class="pro-section-head"><h2>${escapeHtml(title)}</h2><button class="pro-btn" data-show-row="${escapeHtml(title)}">Voir tout</button></div><div class="pro-row">${items.map(card).join('')}</div></section>`;
  }
  function skeletons(){
    return `<div class="pro-grid">${Array.from({length:12}).map(()=>'<div class="pro-skeleton"></div>').join('')}</div>`;
  }

  async function bootstrap(){
    if (!document.body?.matches('[data-pro-ui="home"]')) return;
    if(state.booted) return;
    state.booted = true;
    document.body.classList.add('pro-ready');

    const limit = Store.settings().catalogLimit || 4;
    try{
      const data = await loadBootstrapCatalog(limit);
      state.movies = (data.movies?.items || []).map(norm);
      state.series = (data.series?.items || []).map(norm);
      state.all = [...state.movies, ...state.series];
      Store.saveCache(state.all);
      renderHome(data);
    }catch(e){
      const cache = Store.cache();
      if(cache?.items?.length){
        state.all = cache.items.map(norm);
        state.movies = state.all.filter(x=>x.type==='movie');
        state.series = state.all.filter(x=>x.type==='series');
        renderHome({source:'cache', totals:{movies:state.movies.length, series:state.series.length}});
        toast('Mode cache local');
      } else {
        const main = qs('#content') || qs('main');
        if(main) main.innerHTML = `<div class="pro-glass" style="padding:20px;border-radius:20px">Catalogue momentanément indisponible. Réessaie après actualisation.</div>`;
      }
    }
  }

  function renderHome(data){
    const target = qs('#content') || qs('#catalog') || qs('main');
    if(!target || qs('#proHome')) return;

    const fav = Store.favorites().map(norm);
    const hist = Store.history().map(norm);
    const hero = state.movies[0] || state.series[0] || {};
    const heroBg = hero.poster || '';

    const html = `<div id="proHome" class="pro-shell">
      <section class="pro-hero pro-glass" style="background-image:linear-gradient(90deg,rgba(2,6,23,.96),rgba(2,6,23,.45)),url('${escapeHtml(heroBg)}')">
        <div class="pro-hero-content">
          <span class="pro-pill">MADRADOR PRO • ${escapeHtml(data.source || '')}</span>
          <h1>${escapeHtml(hero.title || 'Madrador TV')}</h1>
          <p>Interface premium, favoris, historique, catalogue complet, mode cinéma et paramètres avancés.</p>
          <div class="pro-actions">
            <button class="pro-btn" data-open-hero="${escapeHtml(hero.id || '')}">▶ Regarder</button>
            <button class="pro-btn" data-random>Lecture au hasard</button>
            <a class="pro-btn" href="./library.html">Bibliothèque</a>
            <a class="pro-btn" href="./admin.html">Admin</a>
          </div>
        </div>
      </section>

      <section class="pro-dashboard">
        <div class="pro-stat pro-glass"><span>Films chargés</span><b>${state.movies.length}</b></div>
        <div class="pro-stat pro-glass"><span>Séries chargées</span><b>${state.series.length}</b></div>
        <div class="pro-stat pro-glass"><span>Favoris</span><b>${fav.length}</b></div>
        <div class="pro-stat pro-glass"><span>Historique</span><b>${hist.length}</b></div>
      </section>

      <div class="pro-actions pro-glass" style="padding:12px;border-radius:22px">
        <input class="pro-input" id="proSearch" placeholder="Recherche dans le catalogue chargé...">
        <select class="pro-select" id="proType"><option value="all">Tout</option><option value="movie">Films</option><option value="series">Séries</option></select>
        <select class="pro-select" id="proSort"><option value="recent">Récent</option><option value="az">A-Z</option><option value="za">Z-A</option></select>
        <button class="pro-btn" id="proApply">Filtrer</button>
      </div>

      ${hist.length ? row('Reprendre la lecture', hist.slice(0,18)) : ''}
      ${fav.length ? row('Ma liste', fav.slice(0,18)) : ''}
      ${row('Films du moment', state.movies.slice(0,24))}
      ${row('Séries du moment', state.series.slice(0,24))}
      ${row('Nouveautés mélangées', shuffle(state.all).slice(0,30))}
      <section class="pro-section"><div class="pro-section-head"><h2>Catalogue filtré</h2><span class="muted" id="proCount">${state.all.length} contenus</span></div><div id="proFiltered" class="pro-grid">${state.all.slice(0,60).map(card).join('')}</div></section>
    </div>`;

    target.insertAdjacentHTML('afterbegin', html);
    bindHome();
  }

  function bindHome(){
    const root = qs('#proHome');
    root.addEventListener('click', (e) => {
      const favBtn = e.target.closest('[data-fav]');
      if(favBtn){
        e.stopPropagation();
        const item = state.all.find(x=>String(x.id)===String(favBtn.dataset.fav));
        if(item){
          const active = Store.toggleFavorite(item);
          favBtn.classList.toggle('active', active);
          toast(active ? 'Ajouté aux favoris' : 'Retiré des favoris');
        }
        return;
      }
      const cardEl = e.target.closest('.pro-card');
      if(cardEl){
        const item = state.all.find(x=>String(x.id)===String(cardEl.dataset.id)) || Store.favorites().find(x=>String(x.id)===String(cardEl.dataset.id)) || Store.history().find(x=>String(x.id)===String(cardEl.dataset.id));
        if(item) openItem(norm(item));
      }
      if(e.target.closest('[data-random]')){
        const item = state.all[Math.floor(Math.random()*state.all.length)];
        if(item) openItem(item);
      }
      const hero = e.target.closest('[data-open-hero]');
      if(hero?.dataset.openHero){
        const item = state.all.find(x=>String(x.id)===String(hero.dataset.openHero));
        if(item) openItem(item);
      }
      const rowBtn = e.target.closest('[data-show-row]');
      if(rowBtn){
        let items = state.all;
        const t = rowBtn.dataset.showRow.toLowerCase();
        if(t.includes('film')) items = state.movies;
        if(t.includes('série') || t.includes('serie')) items = state.series;
        showModal(rowBtn.dataset.showRow, items);
      }
    });
    qs('#proApply')?.addEventListener('click', filter);
    qs('#proSearch')?.addEventListener('input', debounce(filter, 250));
    qs('#proType')?.addEventListener('change', filter);
    qs('#proSort')?.addEventListener('change', filter);
  }

  function filter(){
    const q = (qs('#proSearch')?.value || '').toLowerCase().trim();
    const type = qs('#proType')?.value || 'all';
    const sort = qs('#proSort')?.value || 'recent';
    let items = state.all.filter(x => (!q || x.title.toLowerCase().includes(q)) && (type === 'all' || x.type === type));
    if(sort === 'az') items.sort((a,b)=>a.title.localeCompare(b.title));
    if(sort === 'za') items.sort((a,b)=>b.title.localeCompare(a.title));
    qs('#proCount').textContent = `${items.length} contenus`;
    qs('#proFiltered').innerHTML = items.slice(0,120).map(card).join('');
  }

  function showModal(title, items){
    let modal = qs('#proModal');
    if(!modal){
      modal = document.createElement('div');
      modal.id = 'proModal';
      modal.className = 'pro-modal';
      modal.innerHTML = `<div class="pro-modal-card pro-glass"><button class="pro-btn" id="proCloseModal">Fermer</button><h2></h2><div class="pro-grid"></div></div>`;
      document.body.appendChild(modal);
      qs('#proCloseModal').onclick = () => modal.classList.remove('open');
      modal.addEventListener('click', e => { if(e.target === modal) modal.classList.remove('open'); });
    }
    qs('h2', modal).textContent = title;
    qs('.pro-grid', modal).innerHTML = items.map(card).join('');
    qs('.pro-grid', modal).onclick = e => {
      const c = e.target.closest('.pro-card');
      if(c){
        const item = items.find(x=>String(x.id)===String(c.dataset.id));
        if(item) openItem(norm(item));
      }
    };
    modal.classList.add('open');
  }

  function debounce(fn, ms){let t;return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

  document.addEventListener('DOMContentLoaded', bootstrap);

  window.MadradorPro = { toast, api, norm };
})();
