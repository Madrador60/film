(function () {
  const nav = document.querySelector('.mobile-bottom-nav');
  if (!nav) return;

  const currentPath = location.pathname.split('/').pop() || 'index.html';
  const params = new URLSearchParams(location.search);
  const type = params.get('type');
  const view = params.get('view');
  const contentSection = getContentSection(currentPath, type, view);

  nav.querySelectorAll('a').forEach((link) => {
    const url = new URL(link.getAttribute('href'), location.href);
    const targetPath = url.pathname.split('/').pop() || 'index.html';
    const targetType = url.searchParams.get('type');
    const targetView = url.searchParams.get('view');
    const targetSection = getContentSection(targetPath, targetType, targetView);
    let active = currentPath === targetPath;

    if (currentPath === 'catalog.html' && targetPath === 'catalog.html') {
      active = (targetType && targetType === type) || (targetView && targetView === view);
    }

    if (currentPath === 'library.html' && targetPath === 'library.html') {
      active = true;
    }

    if (currentPath === 'admin.html' && targetPath === 'settings.html') {
      active = true;
    }

    if (currentPath === 'player.html' && targetPath === 'catalog.html') {
      active = contentSection && contentSection === targetSection;
    }

    if (active) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    } else {
      link.classList.remove('active');
      link.removeAttribute('aria-current');
    }
  });

  function getContentSection(path, typeValue, viewValue) {
    if (viewValue === 'favorites') return 'favorites';
    if (viewValue === 'history') return 'history';
    if (path === 'library.html') return 'library';
    if (path === 'direct.html') return 'direct';
    if (path === 'search.html') return 'search';
    if (path === 'settings.html' || path === 'admin.html') return 'settings';
    if (path === 'index.html' || path === '') return 'home';
    if (typeValue === 'series') return 'series';
    if (typeValue === 'movies' || typeValue === 'movie') return 'movies';
    if (path === 'catalog.html' && typeValue === 'all') return 'catalog';
    return '';
  }
})();
