const assert = require('assert');
const { parseM3u, normalizeChannelName, canonicalTvgId } = require('../services/iptvOrgService');
const { buildCatalog } = require('../services/iptvOrgApiService');

const fixture = `#EXTM3U
#EXTINF:-1 tvg-id="TF1.fr@HD" tvg-name="TF1 HD" tvg-logo="https://example.com/tf1.png" group-title="General" user-agent="Madrador-Test",TF1 (1080p)
https://example.com/tf1/index.m3u8
#EXTINF:-1 tvg-id="TF1.fr@SD" tvg-name="TF1 France" group-title="General",TF1 SD [Geo-blocked]
http://example.com/tf1-sd/index.m3u8
#EXTINF:-1 tvg-id="TV5Monde.fr" group-title="General",TV5 Monde
https://example.com/tv5/index.m3u8`;

function main() {
    const parsed = parseM3u(fixture);
    assert.strictEqual(parsed.channels.length, 2);
    assert.strictEqual(parsed.channels[0].sources.length, 2);
    assert.strictEqual(parsed.channels[0].sources[0].quality, '1080p');
    assert.strictEqual(parsed.channels[0].sources[0].headers.userAgent, 'Madrador-Test');
    assert.strictEqual(normalizeChannelName('TF1 France HD'), 'tf1');
    assert.strictEqual(canonicalTvgId('TF1.fr@HD'), 'tf1.fr');

    const api = {
        channels: [
            { id: 'TF1.fr', name: 'TF1', country: 'FR', categories: ['general'], is_nsfw: false },
            { id: 'TV5Monde.fr', name: 'TV5 Monde', country: 'CA', categories: ['general'], is_nsfw: false },
            { id: 'Blocked.fr', name: 'Bloquée', country: 'FR', categories: [], is_nsfw: false },
            { id: 'Adult.fr', name: 'Adulte', country: 'FR', categories: [], is_nsfw: true }
        ],
        feeds: [
            { channel: 'TF1.fr', id: 'HD', name: 'HD', is_main: true, languages: ['fra'] },
            { channel: 'TV5Monde.fr', id: 'main', name: 'Main', is_main: true, languages: ['fra'] }
        ],
        logos: [{ channel: 'TF1.fr', feed: 'HD', in_use: true, width: 600, height: 300, tags: ['horizontal'], url: 'https://example.com/logo.png' }],
        streams: [
            { channel: 'TF1.fr', feed: 'HD', url: 'https://example.com/tf1/index.m3u8', quality: '1080p' },
            { channel: 'Blocked.fr', url: 'https://example.com/blocked.m3u8' },
            { channel: 'Adult.fr', url: 'https://example.com/adult.m3u8' }
        ],
        guides: [{ channel: 'TF1.fr', feed: 'HD', site: 'guide.test', site_id: 'tf1', site_name: 'TF1', lang: 'fra', sources: ['https://guide.test/fr.xml'] }],
        categories: [{ id: 'general', name: 'General' }],
        languages: [{ code: 'fra', name: 'French' }],
        countries: [{ code: 'FR', name: 'France' }],
        blocklist: [{ channel: 'Blocked.fr', reason: 'dmca' }]
    };
    const built = buildCatalog(api, [parsed]);
    assert.strictEqual(built.channels.length, 2);
    const tf1 = built.channels.find((channel) => channel.channelId === 'TF1.fr');
    assert.deepStrictEqual(tf1.scopes, ['france']);
    assert.deepStrictEqual(built.channels.find((channel) => channel.channelId === 'TV5Monde.fr').scopes, ['francophone']);
    assert.strictEqual(tf1.logo, 'https://example.com/logo.png');
    assert(tf1.guide && tf1.guide.site === 'guide.test');
    assert(tf1.sources.some((source) => source.status === 'incompatible_https'));
    assert.strictEqual(built.stats.excludedBlocklist, 1);
    assert.strictEqual(built.stats.excludedNsfw, 1);
    assert.strictEqual(built.stats.france, 1);
    assert.strictEqual(built.stats.francophone, 1);
    console.log(JSON.stringify({ ok: true, channels: built.stats.total, sources: built.stats.sources, france: built.stats.france, francophone: built.stats.francophone }));
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
