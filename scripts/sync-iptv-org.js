const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parseM3u } = require('../services/iptvOrgService');

const SOURCE_URL = 'https://iptv-org.github.io/iptv/languages/fra.m3u';
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'iptv-org-fra-fallback.json');

async function main() {
    const response = await axios.get(SOURCE_URL, {
        timeout: 20000,
        responseType: 'text',
        maxContentLength: 2 * 1024 * 1024
    });
    const parsed = parseM3u(response.data);
    const updatedAt = new Date().toISOString();
    const data = {
        schemaVersion: 1,
        ok: true,
        name: 'IPTV-org — Chaînes francophones',
        sourceUrl: SOURCE_URL,
        updatedAt,
        lastAttemptAt: updatedAt,
        cacheSource: 'bundled',
        rawEntries: parsed.rawEntries,
        total: parsed.channels.length,
        duplicateMerges: parsed.duplicateMerges,
        channels: parsed.channels
    };
    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ savedAt: Date.now(), data }), 'utf8');
    console.log(JSON.stringify({ output: OUTPUT_FILE, rawEntries: data.rawEntries, channels: data.total, duplicateMerges: data.duplicateMerges }));
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
