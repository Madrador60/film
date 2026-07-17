const { spawn } = require('child_process');

const PORT = Number(process.env.BENCHMARK_PORT || 3112);
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${BASE_URL}/api/status`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Serveur indisponible pour le benchmark.');
}

async function measure(path, timeoutMs = 25000, fetchOptions = {}) {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, { ...fetchOptions, signal: AbortSignal.timeout(timeoutMs) });
    const data = await response.json().catch(() => ({}));
    const elapsed = Math.round(performance.now() - startedAt);
    const count = data.items?.length ?? data.channels?.length ?? data.sources?.length ?? '';
    console.log(`${path} | ${response.ok ? 'OK' : `HTTP ${response.status}`} | ${elapsed} ms | count=${count}`);
    return { ok: response.ok, elapsed };
  } catch (error) {
    const elapsed = Math.round(performance.now() - startedAt);
    console.log(`${path} | ERROR | ${elapsed} ms | ${error.message}`);
    return { ok: false, elapsed };
  }
}

async function run() {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  try {
    await waitForServer();
    await measure('/api/refresh-domain', 30000, { method: 'POST' });
    await measure('/api/catalog/bootstrap?limit=1');
    await measure('/api/catalog/snapshot?type=movie&limit=all&maxItems=5');
    await measure('/api/search?q=Obsession');
    await measure('/api/details/15113307');
    await measure('/api/details/15113307');
    await measure('/api/episodes/15113307');
    await measure('/api/episodes/15113307');
    await measure('/api/seasons/The%20Last%20Of%20Us');
    await measure('/api/direct/channels');
  } finally {
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
