const { spawn } = require('child_process');
const { chromium } = require('playwright');

const PORT = Number(process.env.AUDIT_PORT || 3099);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PAGES = [
  '/index.html',
  '/direct.html',
  '/search.html',
  '/catalog.html?type=movies',
  '/catalog.html?type=series',
  '/library.html',
  '/settings.html',
  '/admin.html',
  '/diagnostic.html',
  '/player.html?id=15113307-the-last-of-us-saison-1.html&type=series&seriesTitle=The%20Last%20Of%20Us'
];
const PROFILES = [
  ['mobile', 390, 844],
  ['tablet', 820, 1180],
  ['desktop', 1440, 900]
];

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Le serveur Madrador ne répond pas.');
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const issues = [];
  let browser;

  try {
    await waitForServer();
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
    });

    for (const [profile, width, height] of PROFILES) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: profile !== 'desktop' });
      for (const target of PAGES) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => {
          if (!/vidzy|vast\.vpaid|withCredentials/i.test(error.stack || error.message)) errors.push(error.message);
        });
        page.on('response', (response) => {
          if (response.status() >= 400 && response.url().startsWith(BASE_URL)) {
            errors.push(`${response.status()} ${response.url()}`);
          }
        });

        let status = 0;
        try {
          const response = await page.goto(`${BASE_URL}${target}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          status = response?.status() || 0;
          await page.waitForTimeout(500);
        } catch (error) {
          errors.push(error.message);
        }

        const metrics = await page.evaluate(() => ({
          width: document.body.scrollWidth,
          viewport: innerWidth,
          textLength: (document.body.innerText || '').trim().length
        }));
        if (status !== 200 || metrics.width > metrics.viewport + 2 || metrics.textLength < 20 || errors.length) {
          issues.push({ profile, target, status, ...metrics, errors: [...new Set(errors)] });
        }
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser?.close();
    server.kill('SIGTERM');
  }

  if (issues.length) {
    console.error(JSON.stringify(issues, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(`Audit Madrador réussi : ${PAGES.length * PROFILES.length} pages/profils vérifiés.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
