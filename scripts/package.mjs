// Windows için taşınabilir paket: dist/PoligonPro-win32-x64 + zip
import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');
const paths = await packager({
  dir: root,
  out,
  name: 'PoligonPro',
  executableName: 'PoligonPro',
  platform: 'win32',
  arch: 'x64',
  overwrite: true,
  asar: true,
  prune: true,
  icon: join(root, 'build/icon.ico'),
  appCopyright: 'Poligon Pro',
  appVersion: '1.0.0',
  win32metadata: { CompanyName: 'Poligon Pro', FileDescription: 'Poligon Pro - Parkur Tasarım ve Sunum Sistemi', ProductName: 'Poligon Pro', InternalName: 'PoligonPro', OriginalFilename: 'PoligonPro.exe' },
  ignore: [/^\/indir($|\/)/, /^\/build\/splash\.bmp$/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/\.git/, /^\/README\.md$/, /^\/DEVAM\.md$/, /^\/ekran-goruntuleri($|\/)/, /\.map$/, /^\/build\/icon\.ico$/],
});
console.log('Paket:', paths);
const zip = join(out, 'PoligonPro-Windows.zip');
if (existsSync(zip)) rmSync(zip);
// Windows'ta "zip" komutu yok: yerleşik tar.exe zip biçimini destekler
if (process.platform === 'win32') execSync('tar -a -c -f PoligonPro-Windows.zip PoligonPro-win32-x64', { cwd: out });
else execSync(`cd "${out}" && zip -qr -9 PoligonPro-Windows.zip PoligonPro-win32-x64`);
console.log('Zip:', zip);
// Tek dosyalık taşınabilir exe (çıkartma gerektirmez, açılışta yükleniyor ekranı gösterir)
execSync(`npx electron-builder --win portable --x64 --prepackaged "${paths[0]}" --config scripts/builder.json`, { cwd: root, stdio: 'inherit' });
console.log('Tek exe:', join(out, 'builder', 'PoligonPro.exe'));
