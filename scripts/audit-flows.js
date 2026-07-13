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

    browser = await chromium.launch({
      headless: true,
      ...(findChrome() ? { executablePath: findChrome() } : {})
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#hero');
    await page.click('#directBtn');
    await page.waitForURL(/direct\.html/);

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

    console.log('Audit fonctionnel réussi : API, navigation, recherche et cartes vérifiées.');
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
