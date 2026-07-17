const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createIptvOrgService, parseM3u, normalizeChannelName, canonicalTvgId } = require('../services/iptvOrgService');

const fixture = `#EXTM3U
#EXTINF:-1 tvg-id="TF1.fr@HD" tvg-name="TF1 HD" tvg-logo="https://example.com/tf1.png" group-title="General",TF1 (1080p)
https://example.com/tf1/index.m3u8
#EXTINF:-1 tvg-id="TF1.fr@SD" tvg-name="TF1 France" group-title="General",TF1 SD
https://example.com/tf1-sd/index.m3u8
#EXTINF:-1 tvg-id="FranceInfo.fr" group-title="News",France Info
https://example.com/info.mp4
#EXTINF:-1 tvg-id="Kids.fr" group-title="Kids",Chaîne Jeunesse
javascript:alert(1)`;

async function main() {
    const result = parseM3u(fixture);
    assert.strictEqual(result.rawEntries, 3, 'les URL non HTTP doivent être rejetées');
    assert.strictEqual(result.channels.length, 2, 'les variantes HD/SD d’un même tvg-id doivent fusionner');
    assert.strictEqual(result.channels[0].sources.length, 2, 'les deux flux TF1 doivent rester disponibles');
    assert.strictEqual(result.channels[0].category, 'Généralistes');
    assert.strictEqual(result.channels[1].category, 'Information');
    assert.strictEqual(normalizeChannelName('TF1 France HD'), 'tf1');
    assert.strictEqual(canonicalTvgId('TF1.fr@HD'), 'tf1.fr');

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'madrador-iptv-'));
    const fallbackFile = path.join(directory, 'fallback.json');
    const fallbackData = { schemaVersion: 1, ok: true, updatedAt: new Date(0).toISOString(), total: result.channels.length, channels: result.channels };
    fs.writeFileSync(fallbackFile, JSON.stringify({ savedAt: Date.now(), data: fallbackData }));
    const offlineService = createIptvOrgService({
        axios: { get: async () => { throw new Error('source distante simulée hors ligne'); } },
        fallbackFile,
        cacheFile: path.join(directory, 'cache.json'),
        maxAge: 1
    });
    const fallback = await offlineService.refresh(true);
    assert.strictEqual(fallback.stale, true, 'le dernier catalogue valide doit rester servi hors ligne');
    assert.strictEqual(fallback.channels.length, 2);
    fs.rmSync(directory, { recursive: true, force: true });
    console.log(JSON.stringify({ ok: true, rawEntries: result.rawEntries, channels: result.channels.length, duplicateMerges: result.duplicateMerges, offlineFallback: true }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
