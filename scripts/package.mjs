// Windows için taşınabilir paket: dist/PoligonPro-win32-x64 + zip
import { packager } from '@electron/packager';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
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
  ignore: [/^\/src($|\/)/, /^\/scripts($|\/)/, /^\/dist($|\/)/, /^\/\.git/, /^\/README\.md$/, /\.map$/, /^\/build\/icon\.ico$/],
});
console.log('Paket:', paths);
const zip = join(out, 'PoligonPro-Windows.zip');
if (existsSync(zip)) rmSync(zip);
execSync(`cd "${out}" && zip -qr -9 PoligonPro-Windows.zip PoligonPro-win32-x64`);
console.log('Zip:', zip);
