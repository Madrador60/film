const { spawn } = require('child_process');
const { existsSync } = require('fs');
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
  ['mobile-small', 320, 568, true],
  ['mobile', 390, 844, true],
  ['tablet', 820, 1180, true],
  ['laptop', 1143, 900, false],
  ['desktop', 1440, 900, false],
  ['tv', 1920, 1080, true],
  ['4k', 3840, 2160, false]
];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

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
    const chromePath = findChrome();
    browser = await chromium.launch({
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {})
    });

    for (const [profile, width, height, hasTouch] of PROFILES) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch });
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
          await page.waitForTimeout(800);
        } catch (error) {
          errors.push(error.message);
        }

        const metrics = await page.evaluate(() => {
          const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id);
          const duplicateIds = ids.filter((id, index) => id && ids.indexOf(id) !== index);
          const nestedInteractive = document.querySelectorAll(
            'button button,button a[href],a[href] button,a[href] a[href],[role="button"] button,[role="button"] a[href]'
          ).length;
          const unnamedButtons = Array.from(document.querySelectorAll('button')).filter((button) => {
            const name = button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent.trim();
            return !name;
          }).length;
          return {
            width: document.body.scrollWidth,
            viewport: innerWidth,
            textLength: (document.body.innerText || '').trim().length,
            duplicateIds: [...new Set(duplicateIds)],
            nestedInteractive,
            unnamedButtons
          };
        });
        if (
          status !== 200 ||
          metrics.width > metrics.viewport + 2 ||
          metrics.textLength < 20 ||
          metrics.duplicateIds.length ||
          metrics.nestedInteractive ||
          metrics.unnamedButtons ||
          errors.length
        ) {
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
