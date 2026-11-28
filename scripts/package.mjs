// Windows için taşınabilir paket: dist/PoligonPro-win32-x64 + zip
import { execSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Node 26'da extract-zip (yauzl) Electron zip'inin yalnızca ilk dosyasını açıp sessizce duruyor.
// Windows'ta paketleyicinin kullandığı extract-zip'i yerleşik tar.exe ile değiştir.
if (process.platform === 'win32') {
  const req = createRequire(createRequire(import.meta.url).resolve('@electron/packager'));
  const id = req.resolve('extract-zip');
  const tarExtract = async (zip, { dir }) => { mkdirSync(dir, { recursive: true }); execSync(`tar -xf "${zip}" -C "${dir}"`); };
  req.cache[id] = { id, filename: id, loaded: true, exports: tarExtract };
}
const { packager } = await import('@electron/packager');

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
  ignore: [/^\/indir($|\/)/, /^\/build\/splash\.bmp$/, /^\/src($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/\.git/, /^\/README\.md$/, /^\/DEVAM\.md$/, /^\/ekran-goruntuleri($|\/)/, /\.map$/, /^\/build\/icon\.ico$/,
    // ActorCore lisansı: hareket verisi exe'ye yalnızca şifreli olarak girebilir; deneme verisi pakete alınmaz
    /^\/app\/assets\/anim\/lib\/actorcore-[^/]*\.json$/],
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
