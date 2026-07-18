const path = require('path');
const axios = require('axios');
const { createIptvOrgApiService } = require('../services/iptvOrgApiService');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'iptv-org-api-fallback.json');

async function main() {
    const service = createIptvOrgApiService({
        axios,
        cacheFile: OUTPUT_FILE,
        fallbackFile: path.join(__dirname, '..', 'data', 'missing-iptv-fallback.json'),
        supplementFile: path.join(__dirname, '..', 'data', 'iptv-org-fra-supplement.m3u'),
        maxAge: 8 * 60 * 60 * 1000,
        timeout: 30000
    });
    const data = await service.refresh(true);
    console.log(JSON.stringify({ output: OUTPUT_FILE, updatedAt: data.updatedAt, ...data.stats }));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
