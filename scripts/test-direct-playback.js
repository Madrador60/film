const assert = require('assert');
const { spawn } = require('child_process');
const { existsSync } = require('fs');
const { chromium } = require('playwright');

const PORT = Number(process.env.DIRECT_TEST_PORT || 3112);
const BASE_URL = `http://127.0.0.1:${PORT}`;

function chromePath() {
  return [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe']
    .filter(Boolean).find(existsSync);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${BASE_URL}/api/status`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Serveur Direct indisponible');
}

async function main() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  let browser;
  try {
    await waitForServer();
    const blockedEmbedResponse = await fetch(`${BASE_URL}/api/direct/resolve?url=${encodeURIComponent('https://livewatch.top/embed/test')}`);
    const blockedEmbed = await blockedEmbedResponse.json();
    assert.strictEqual(blockedEmbed.ok, false, 'LiveWatch doit être refusé avant la création d’une iframe');
    assert.match(blockedEmbed.error || '', /clics publicitaires/i);
    browser = await chromium.launch({ headless: true, ...(chromePath() ? { executablePath: chromePath() } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`${BASE_URL}/direct.html`, { waitUntil: 'domcontentloaded' });

    const iframeResult = await page.evaluate(() => new Promise((resolve) => {
      let ready = false;
      playUrl('about:blank', { type: 'iframe', name: 'Iframe cassée' }, {
        timeout: 80,
        onReady: () => { ready = true; },
        onFailure: (message) => resolve({ ready, message })
      });
    }));
    assert.strictEqual(iframeResult.ready, false, 'iframe.load ne doit jamais prouver la lecture');

    const hlsResults = await page.evaluate(async () => {
      class FakeHls {
        static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'fragment' };
        static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
        static isSupported() { return true; }
        constructor() { this.handlers = {}; }
        on(name, handler) { this.handlers[name] = handler; }
        loadSource(url) { this.url = url; }
        attachMedia(video) {
          this.video = video;
          setTimeout(() => {
            this.handlers.manifest?.();
            if (this.url.includes('broken')) this.handlers.error?.(null, { fatal: true, type: 'network' });
            else {
              this.handlers.fragment?.();
              setTimeout(() => {
                Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.6 });
                video.dispatchEvent(new Event('timeupdate'));
              }, 30);
            }
          }, 10);
        }
        recoverMediaError() {}
        destroy() {}
      }
      window.Hls = FakeHls;
      const run = (url) => new Promise((resolve) => playUrl(url, { type: 'hls', name: url }, {
        timeout: 300,
        onReady: () => resolve('ready'),
        onFailure: () => resolve('failed')
      }));
      return { broken: await run('https://example.test/broken.m3u8'), good: await run('https://example.test/good.m3u8') };
    });
    assert.strictEqual(hlsResults.broken, 'failed', 'un manifeste sans segment lisible doit échouer');
    assert.strictEqual(hlsResults.good, 'ready', 'fragment + currentTime doit valider la source');

    const fallback = await page.evaluate(() => new Promise((resolve) => {
      class SwitchingHls {
        static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifest', FRAG_LOADED: 'fragment' };
        static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
        static isSupported() { return true; }
        constructor() { this.handlers = {}; }
        on(name, handler) { this.handlers[name] = handler; }
        loadSource(url) { this.url = url; }
        attachMedia(video) {
          setTimeout(() => {
            if (this.url.includes('first')) this.handlers.error?.(null, { fatal: true, type: 'network' });
            else {
              this.handlers.manifest?.(); this.handlers.fragment?.();
              setTimeout(() => {
                Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.7 });
                video.dispatchEvent(new Event('timeupdate'));
              }, 30);
            }
          }, 10);
        }
        recoverMediaError() {}
        destroy() {}
      }
      window.Hls = SwitchingHls;
      const channel = {
        id: 'test-switch', name: 'Test Switch', catalog: 'iptv-org', url: 'https://example.test/first.m3u8',
        sources: [
          { name: 'Source 1', url: 'https://example.test/first.m3u8', type: 'hls', catalog: 'iptv-org' },
          { name: 'Source 2', url: 'https://example.test/second.m3u8', type: 'hls', catalog: 'iptv-org' }
        ]
      };
      playChannel(channel);
      const timer = setInterval(() => {
        if (directSourceStates.get(channel.sources[1].url)?.state === 'available') {
          clearInterval(timer); resolve({ index: selectedDirectSourceIndex, states: [...directSourceStates.entries()] });
        }
      }, 30);
      setTimeout(() => { clearInterval(timer); resolve({ index: -1, states: [...directSourceStates.entries()] }); }, 1200);
    }));
    assert.strictEqual(fallback.index, 1, `la seconde source doit être sélectionnée automatiquement: ${JSON.stringify(fallback.states)}`);

    const sourceLabels = await page.evaluate(() => {
      const channel = {
        name: 'Chaîne test',
        sources: [
          { name: 'CDNLiveTV', provider: 'CDNLiveTV', url: 'https://cdnlivetv.tv/one', type: 'hls', status: 'available' },
          { name: 'IPTV-org France', provider: 'IPTV-org', url: 'https://example.test/two.m3u8', type: 'hls', status: 'unchecked' }
        ]
      };
      renderChannelSources(channel);
      return {
        names: [...document.querySelectorAll('#directSourceList b')].map((node) => node.textContent),
        text: document.querySelector('#directSourceList')?.textContent || '',
        blocked: [
          isAllowedSource('https://hesgoaler.com/stream.php?ch=tf1', { catalog: 'iptv-org' }),
          isAllowedSource('https://livelive24.com/live24.php?ch=tf1', { catalog: 'iptv-org' }),
          isAllowedSource('https://cartelive.club/player/1/24', { catalog: 'iptv-org' }),
          isAllowedSource('https://www.freeshot.sbs/embed/stream-51.php', { catalog: 'iptv-org' }),
          isAllowedSource('https://livewatch.top/embed/test', { catalog: 'iptv-org' })
        ]
      };
    });
    assert.deepStrictEqual(sourceLabels.names, ['Source 1', 'Source 2']);
    assert(!/CDNLiveTV|IPTV-org/i.test(sourceLabels.text), 'les fournisseurs ne doivent pas être affichés dans le sélecteur');
    assert.deepStrictEqual(sourceLabels.blocked, [false, false, false, false, false]);

    const noSource = await page.evaluate(() => {
      showDirectError({ name: 'TF1', url: 'https://invalid.test/' }, 'Aucun flux public lisible.');
      return {
        title: document.querySelector('#directScreen h2')?.textContent,
        link: document.querySelector('#directScreen a')?.href
      };
    });
    assert.strictEqual(noSource.title, 'Aucune source directe disponible');
    assert.strictEqual(noSource.link, 'https://www.tf1.fr/tf1/direct');

    const filters = await page.evaluate(() => {
      directChannels = [
        { id: 'fr', name: 'France', country: 'FR', languages: ['fra'], scopes: ['france'], sources: [{ url: 'https://x/fr.m3u8', provider: 'IPTV-org', quality: '1080p', status: 'available' }] },
        { id: 'fo', name: 'Francophone', country: 'CA', languages: ['fra'], scopes: ['francophone'], sources: [{ url: 'https://x/fo.m3u8', provider: 'Infomaniak', quality: '720p', status: 'unchecked' }] },
        { id: 'in', name: 'International', country: 'AF', languages: ['pus'], scopes: ['international'], sources: [{ url: 'https://x/in.m3u8', provider: 'IPTV-org', quality: '576p', status: 'unavailable' }] }
      ];
      const fav = new Set(); const recent = new Map();
      renderDirectViewTabs(directChannels, fav, recent);
      renderDirectMetadataFilters(directChannels);
      const labels = [...document.querySelectorAll('#directViewTabs span')].map((node) => node.textContent);
      return {
        labels,
        countries: [...document.querySelectorAll('#directCountryFilter option')].map((node) => node.value),
        providers: [...document.querySelectorAll('#directProviderFilter option')].map((node) => node.value),
        unavailable: channelMatchesAvailability(directChannels[2], 'unavailable'),
        france: getDirectChannelScope(directChannels[0]),
        francophone: getDirectChannelScope(directChannels[1]),
        international: getDirectChannelScope(directChannels[2])
      };
    });
    assert(filters.labels.some((label) => label === 'France · 1'));
    assert(filters.countries.includes('FR') && filters.countries.includes('CA') && filters.countries.includes('AF'));
    assert(filters.providers.includes('iptv-org') && filters.providers.includes('infomaniak'));
    assert.strictEqual(filters.unavailable, true);
    assert.deepStrictEqual([filters.france, filters.francophone, filters.international], ['france', 'francophone', 'international']);

    console.log(JSON.stringify({ ok: true, iframeFalsePositive: 'blocked', hlsBroken: 'blocked', hlsProgress: 'ready', fallbackSource: 2, sourceLabels: 'numbered', unsafeProviders: 'blocked', officialFallback: 'TF1+', filters: 'ok' }));
  } finally {
    await browser?.close();
    server.kill();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
