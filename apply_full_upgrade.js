const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const backupDir = path.join(ROOT, 'backup-full-upgrade-' + new Date().toISOString().replace(/[:.]/g, '-'));

function full(p){ return path.join(ROOT, p); }
function has(p){ return fs.existsSync(full(p)); }
function read(p){ return fs.readFileSync(full(p), 'utf8'); }
function write(p, c){
  fs.mkdirSync(path.dirname(full(p)), { recursive: true });
  fs.writeFileSync(full(p), c, 'utf8');
  console.log('✅ ' + p);
}
function backup(p){
  if(!has(p)) return;
  const dst = path.join(backupDir, p);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(full(p), dst);
}
function addBeforeHead(html, tag){
  return html.includes(tag) ? html : html.replace(/<\/head>/i, `  ${tag}\n</head>`);
}
function addBeforeBody(html, tag){
  return html.includes(tag) ? html : html.replace(/<\/body>/i, `  ${tag}\n</body>`);
}

console.log('\\n🚀 Madrador TV - Upgrade complet sans Ctrl+K\\n');

[
  'server.js',
  'public/index.html',
  'public/player.html',
  'public/settings.html',
  'public/css/style.css',
  'public/js/app.js',
  'public/js/player.js',
  'public/js/settings.js',
  'public/js/deep-ui.js'
].forEach(backup);

// Désactive l'ancien Ctrl+K si deep-ui.js existe déjà
write('public/js/deep-ui.js', `// Ancien patch neutralisé volontairement.
// Recherche rapide Ctrl+K désactivée à la demande.
// Les nouvelles fonctionnalités sont dans pro-ui.js.
`);

write('public/css/pro-ui.css', fs.readFileSync(path.join(__dirname, 'public/css/pro-ui.css'), 'utf8'));
write('public/js/pro-storage.js', fs.readFileSync(path.join(__dirname, 'public/js/pro-storage.js'), 'utf8'));
write('public/js/pro-ui.js', fs.readFileSync(path.join(__dirname, 'public/js/pro-ui.js'), 'utf8'));
write('public/js/pro-player.js', fs.readFileSync(path.join(__dirname, 'public/js/pro-player.js'), 'utf8'));
write('public/js/pro-settings.js', fs.readFileSync(path.join(__dirname, 'public/js/pro-settings.js'), 'utf8'));
write('public/admin.html', fs.readFileSync(path.join(__dirname, 'public/admin.html'), 'utf8'));
write('public/library.html', fs.readFileSync(path.join(__dirname, 'public/library.html'), 'utf8'));

['public/index.html', 'public/player.html', 'public/settings.html'].forEach(p => {
  if(!has(p)) return;
  let html = read(p);
  html = addBeforeHead(html, `<link rel="stylesheet" href="./css/pro-ui.css">`);
  html = addBeforeBody(html, `<script src="./js/pro-storage.js"></script>`);
  html = addBeforeBody(html, `<script src="./js/pro-ui.js"></script>`);
  if(p.endsWith('player.html')) html = addBeforeBody(html, `<script src="./js/pro-player.js"></script>`);
  if(p.endsWith('settings.html')) html = addBeforeBody(html, `<script src="./js/pro-settings.js"></script>`);
  write(p, html);
});

if(has('server.js')){
  let s = read('server.js');

  if(!s.includes("app.get('/api/status'")){
    const statusRoutes = `
// 🧠 API système Madrador Pro
app.get('/api/status', async (req, res) => {
    try {
        res.json({
            ok: true,
            source: currentBaseUrl,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cacheSize: typeof cache !== 'undefined' ? cache.size : null,
            time: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/api/refresh-domain', async (req, res) => {
    try {
        if (typeof findWorkingUrl === 'function') {
            await findWorkingUrl();
        }
        res.json({ ok: true, source: currentBaseUrl, time: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/api/catalog/bootstrap', async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(Number(req.query.limit) || 4, 15));
        const [movies, series] = await Promise.all([
            fetchAllCatalogItems('movie', limit),
            fetchAllCatalogItems('series', limit)
        ]);
        res.json({
            ok: true,
            source: currentBaseUrl,
            generatedAt: new Date().toISOString(),
            movies,
            series,
            totals: { movies: movies.total || 0, series: series.total || 0 }
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.get('/api/library/stats', async (req, res) => {
    try {
        const [movies, series] = await Promise.all([
            fetchAllCatalogItems('movie', 2),
            fetchAllCatalogItems('series', 2)
        ]);
        res.json({
            ok: true,
            source: currentBaseUrl,
            movies: movies.total || 0,
            series: series.total || 0,
            cacheSize: typeof cache !== 'undefined' ? cache.size : null,
            uptime: process.uptime(),
            time: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});
`;
    const marker = "// 🏠 Page d'accueil";
    if(s.includes(marker)) s = s.replace(marker, statusRoutes + "\\n" + marker);
    else s += "\\n" + statusRoutes;
    write('server.js', s);
  } else {
    console.log('ℹ️ Routes système déjà présentes');
  }
}

write('APPLIQUER_UPGRADE_COMPLET.bat', `@echo off
title Madrador TV - Upgrade Complet
cd /d "%~dp0"
node apply_full_upgrade.js
pause
`);

console.log('\\n✅ Upgrade complet appliqué.');
console.log('📁 Sauvegarde : ' + backupDir);
console.log('🚀 Relance : npm start');
console.log('🌐 Pages ajoutées : /library.html et /admin.html\\n');
