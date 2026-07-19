const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { chromium } = require('playwright');

const PORT = Number(process.env.FLOW_AUDIT_PORT || 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function findChrome() {
  return [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ].filter(Boolean).find(existsSync);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${BASE_URL}/api/status`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Serveur indisponible pour les tests de parcours.');
}

async function expectApi(path, expectedStatus = 200) {
  let response;
  const attempts = expectedStatus === 200 ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetch(`${BASE_URL}${path}`);
    if (response.status === expectedStatus) break;
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 900));
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${path}: HTTP ${response.status}, attendu ${expectedStatus}`);
  }
  const type = response.headers.get('content-type') || '';
  if (path.startsWith('/api/') && !type.includes('application/json')) {
    throw new Error(`${path}: réponse API non JSON`);
  }
}

async function expectCatalogSnapshot() {
  const response = await fetch(`${BASE_URL}/api/catalog/snapshot?type=movie&limit=all&maxItems=5`);
  if (!response.ok) throw new Error(`/api/catalog/snapshot: HTTP ${response.status}`);
  const data = await response.json();
  if (data.ok !== true || !Array.isArray(data.items) || data.items.length > 5 || data.returned !== data.items.length) {
    throw new Error('/api/catalog/snapshot: format progressif invalide');
  }
}

async function expectTvGuide() {
  const response = await fetch(`${BASE_URL}/api/direct/epg?channel=France%202&channelId=France2.fr&aliases=France2`);
  const data = await response.json();
  if (response.status === 502) {
    if (data.ok !== false || !Array.isArray(data.items)) {
      throw new Error('/api/direct/epg: repli fournisseur invalide');
    }
    console.warn('Guide TV externe temporairement indisponible : repli local valide.');
    return;
  }
  if (!response.ok) throw new Error(`/api/direct/epg: HTTP ${response.status}`);
  if (data.ok !== true || data.timezone !== 'Europe/Paris' || data.matched?.confidence < 60 || !data.items?.length) {
    throw new Error('/api/direct/epg: correspondance ou programme invalide');
  }
  if (data.items.some((item) => new Date(item.stop) <= new Date(item.start))) {
    throw new Error('/api/direct/epg: horaires non chronologiques');
  }
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let browser;
  try {
    await waitForServer();
    const apiChecks = [
      ['/api/status', 200],
      ['/api/catalog/bootstrap?limit=1', 200],
      ['/api/movies?page=1', 200],
      ['/api/series?page=1', 200],
      ['/api/search?q=The%20Last%20Of%20Us', 200],
      ['/api/details/15113307-the-last-of-us-saison-1.html', 200],
      ['/api/episodes/15113307', 200],
      ['/api/seasons/The%20Last%20Of%20Us', 200],
      ['/api/inconnue', 404],
      ['/page-inconnue', 404]
    ];
    for (const [path, status] of apiChecks) await expectApi(path, status);
    await expectCatalogSnapshot();
    await expectTvGuide();

    browser = await chromium.launch({
      headless: true,
      ...(findChrome() ? { executablePath: findChrome() } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#hero');
    const explicitMovieType = await page.evaluate(() => MadradorStorage.normalizeMediaType({ type: 'movie', isSeries: true }));
    if (explicitMovieType !== 'movies') throw new Error('Un type movie explicite est encore transformé en série.');
    await page.click('#directBtn');
    await page.waitForURL(/direct\.html/);
    await page.waitForFunction(() => typeof directChannels !== 'undefined' && directChannels.length > 0, null, { timeout: 10000 });
    const rmcChannel = await page.evaluate(() => {
      const channel = directChannels.find((item) => /^RMC Sport 1$/i.test(item.name || ''));
      return channel ? JSON.parse(JSON.stringify(channel)) : null;
    });
    const rmcSources = rmcChannel?.sources || [];
    if (!rmcChannel || !rmcSources.length) throw new Error('RMC Sport 1 ne possède aucune source autorisée.');
    const hesgoalerSource = await page.evaluate(() => directChannels.find((channel) => (
      (channel.sources || []).some((source) => /hesgoaler\.com/i.test(source.url || ''))
    ))?.name || '');
    if (hesgoalerSource) throw new Error(`Une source publicitaire Hesgoaler est encore importée : ${hesgoalerSource}`);
    if (rmcSources.length > 1) {
      await page.route('**/api/direct/channel-stream?**', (route) => route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Flux HLS indisponible (audit)' })
      }));
      await page.evaluate((channel) => playChannel(channel), rmcChannel);
      await page.waitForFunction(() => selectedDirectSourceIndex === 1, null, { timeout: 4000 });
      const firstDirectState = await page.evaluate((url) => directSourceStates.get(url)?.state, rmcSources[0].url);
      if (firstDirectState !== 'unavailable') throw new Error('La première source Direct en échec n’est pas marquée indisponible.');
      await page.unroute('**/api/direct/channel-stream?**');
    }

    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.click('#settingsBtn');
    await page.waitForURL(/settings\.html/);

    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.click('[data-tab="movies"]');
    await page.waitForURL(/catalog\.html\?type=movies/);

    await page.goto(`${BASE_URL}/search.html`, { waitUntil: 'domcontentloaded' });
    await page.fill('#advancedQuery', 'The Last Of Us');
    await page.press('#advancedQuery', 'Enter');
    await page.waitForFunction(() => !document.getElementById('searchLoading')?.classList.contains('hidden'), null, { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(900);
    if ((await page.inputValue('#advancedQuery')) !== 'The Last Of Us') throw new Error('La saisie de recherche a été altérée.');

    await page.goto(`${BASE_URL}/catalog.html?type=movies`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.media-card-open', { timeout: 15000 });
    const semantics = await page.evaluate(() => ({
      nested: document.querySelectorAll('[role="button"] button, button button, a button').length,
      openName: document.querySelector('.media-card-open')?.getAttribute('aria-label') || ''
    }));
    if (semantics.nested || !semantics.openName) throw new Error('Structure interactive des cartes invalide.');

    const catalogBatch = await page.evaluate(() => ITEMS_PER_PAGE);
    await page.evaluate((batch) => {
      const seed = visibleCatalogItems[0];
      catalogItems = Array.from({ length: batch * 3 }, (_value, index) => ({
        ...seed,
        id: `audit-film-${index + 1}`,
        title: `Film audit ${index + 1}`,
        type: 'movies'
      }));
      renderedCount = batch;
      renderCatalog();
    }, catalogBatch);
    if (await page.locator('#catalogGrid .media-card').count() !== catalogBatch) throw new Error(`Le catalogue ne démarre pas au lot prévu (${catalogBatch}).`);
    const firstPageTitle = await page.locator('#catalogGrid .media-card-open').first().getAttribute('aria-label');
    await page.click('#catalogNext');
    if (await page.locator('#catalogGrid .media-card').count() !== catalogBatch) throw new Error('La page suivante ne conserve pas la bonne taille de lot.');
    if (await page.inputValue('#catalogPageInput') !== '2') throw new Error('Le numéro de page ne passe pas à 2.');
    const secondPageTitle = await page.locator('#catalogGrid .media-card-open').first().getAttribute('aria-label');
    if (secondPageTitle === firstPageTitle) throw new Error('La page suivante affiche encore les mêmes titres.');
    await page.click('#catalogPrev');
    if (await page.inputValue('#catalogPageInput') !== '1') throw new Error('Précédent ne revient pas à la page 1.');

    await page.goto(`${BASE_URL}/catalog.html?view=popular`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(100);
    const activeNav = await page.locator('#sidebar .nav.active').count();
    if (activeNav !== 1 || !(await page.locator('#catalogPopularNav').evaluate((node) => node.classList.contains('active')))) {
      throw new Error('La navigation Populaires conserve plusieurs rubriques actives.');
    }

    await page.addInitScript(() => {
      localStorage.setItem('madrador:favorites', JSON.stringify([{
        id: 'audit-il-maestro',
        title: 'Il maestro',
        type: 'movie',
        isSeries: true
      }]));
    });
    await page.goto(`${BASE_URL}/library.html?view=favorites`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.library-card');
    const libraryBadge = await page.locator('.library-card .media-badges span').first().textContent();
    if (libraryBadge?.trim() !== 'Film') throw new Error('Il maestro est encore identifié comme série dans la bibliothèque.');

    await page.evaluate(() => {
      MadradorStorage.addContinue({ id: 'audit-continue', title: 'Film à terminer', type: 'movie', progressPercent: 42 });
    });
    await page.goto(`${BASE_URL}/library.html?view=continue`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-action="complete"]');
    await page.hover('.library-card');
    await page.click('[data-action="complete"]');
    const completedState = await page.evaluate(() => ({
      stillContinuing: MadradorStorage.continueWatching().some((item) => item.id === 'audit-continue'),
      inHistory: MadradorStorage.history().some((item) => item.id === 'audit-continue' && item.completed === true)
    }));
    if (completedState.stillContinuing || !completedState.inHistory) throw new Error('Marquer comme terminé ne synchronise pas reprise et historique.');

    await page.route('**/api/film/999001', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: '999001', title: 'Film audit', type: 'movie', isSeries: false, year: '2026', description: 'Test cinéma' })
    }));
    await page.route('**/api/film/999001/sources', (route) => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: '999001', sources: [{ name: 'Audit iframe', provider: 'audit', url: `${BASE_URL}/mock-player` }] })
    }));
    await page.route('**/mock-player', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Lecteur audit</title>' }));
    await page.goto(`${BASE_URL}/player.html?id=999001&type=movie`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cinemaMode');
    await page.click('#cinemaMode');
    if (!(await page.locator('body').evaluate((node) => node.classList.contains('cinema-mode')))) throw new Error('Le mode cinéma ne s’active pas.');
    await page.keyboard.press('Escape');
    if (await page.locator('body').evaluate((node) => node.classList.contains('cinema-mode'))) throw new Error('Échap ne ferme pas le mode cinéma.');
    if ((await page.locator('#player').getAttribute('title')) !== 'Lecteur vidéo Madrador TV') throw new Error('Le lecteur iframe n’a pas de titre accessible.');
    await page.evaluate(() => localStorage.removeItem(MadradorStorage.KEYS.continue));
    await page.click('#playFirst');
    await page.waitForTimeout(800);
    const prematureContinue = await page.evaluate(() => MadradorStorage.continueWatching().some((item) => String(item.id) === '999001'));
    if (prematureContinue) throw new Error('Un simple clic sur Lire ajoute encore prématurément le film aux reprises.');
    const sourceState = await page.locator('#sourceStatus').innerText();
    if (!sourceState.includes('lecture à confirmer')) throw new Error('Une iframe chargée est encore annoncée comme prête sans preuve de lecture.');

    console.log('Audit fonctionnel réussi : API, navigation, catalogue 24/48/24, types, bibliothèque et mode cinéma vérifiés.');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
