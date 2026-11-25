// Program amblemini PNG ve ICO olarak üretir (build/icon.png, build/icon.ico)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'src/icons.js'), 'utf8');
const svgFn = src.slice(src.indexOf('export function emblem')).replace('export function emblem', 'function emblem');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const sizes = [256, 128, 64, 48, 32, 16];
  const pngs = [];
  for (const s of sizes) {
    await page.setViewportSize({ width: s, height: s });
    await page.setContent(`<html><body style="margin:0;background:transparent"><div id="e" style="width:${s}px;height:${s}px"></div>
      <script>${svgFn}; document.getElementById('e').innerHTML = emblem(${s < 64 ? "'mini'" : "'mini'"}); document.querySelector('svg').style.cssText='width:100%;height:100%';</script></body></html>`);
    pngs.push(await page.locator('#e').screenshot({ omitBackground: true }));
  }
  await browser.close();
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build/icon.png'), pngs[0]);
  // ICO (PNG gömülü)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let off = 6 + dir.length;
  pngs.forEach((p, i) => {
    const s = sizes[i];
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16);
    dir.writeUInt8(s >= 256 ? 0 : s, i * 16 + 1);
    dir.writeUInt8(0, i * 16 + 2); dir.writeUInt8(0, i * 16 + 3);
    dir.writeUInt16LE(1, i * 16 + 4); dir.writeUInt16LE(32, i * 16 + 6);
    dir.writeUInt32LE(p.length, i * 16 + 8); dir.writeUInt32LE(off, i * 16 + 12);
    off += p.length;
  });
  fs.writeFileSync(path.join(root, 'build/icon.ico'), Buffer.concat([header, dir, ...pngs]));
  console.log('ikon üretildi');
})();
