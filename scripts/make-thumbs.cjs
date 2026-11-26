// Kütüphane önizlemelerini app/assets/thumbs altına PNG olarak üretir (açılışı hızlandırır)
// Önce: npx esbuild dist/test/thumbgen.js --bundle --outfile=app/test-thumbgen.bundle.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8123/app/test-thumbgen.html');
  await p.waitForFunction(() => window.__thumbs || window.__err, null, { timeout: 900000 });
  const err = await p.evaluate(() => window.__err);
  if (err) { console.error(err); process.exit(1); }
  const th = await p.evaluate(() => window.__thumbs);
  const dir = path.join(root, 'app/assets/thumbs');
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(th)) fs.writeFileSync(path.join(dir, k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(root, 'src/thumbsList.js'), 'export const THUMB_FILES = ' + JSON.stringify(Object.keys(th)) + ';\n');
  console.log('önizleme:', Object.keys(th).length);
  await b.close();
})();
