// Derleme: src/ -> app/bundle.js, yazı tiplerini app/fonts altına kopyala
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath: Windows'ta "/C:/..." yerine "C:\..." verir
const root = fileURLToPath(new URL('..', import.meta.url));
const fontsDir = join(root, 'app', 'fonts');
mkdirSync(fontsDir, { recursive: true });

const RANGES = {
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
};
const FONTS = [
  ['rajdhani', 'Rajdhani', [500, 600, 700]],
  ['inter', 'Inter', [400, 500, 600, 700]],
];
let css = '';
for (const [pkg, fam, weights] of FONTS) {
  for (const w of weights) {
    for (const sub of ['latin-ext', 'latin']) {
      const f = `${pkg}-${sub}-${w}-normal.woff2`;
      copyFileSync(join(root, 'node_modules/@fontsource', pkg, 'files', f), join(fontsDir, f));
      css += `@font-face{font-family:'${fam}';font-style:normal;font-display:swap;font-weight:${w};src:url(./${f}) format('woff2');unicode-range:${RANGES[sub]};}\n`;
    }
  }
}
writeFileSync(join(fontsDir, 'fonts.css'), css);

await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  minify: process.argv.includes('--dev') ? false : true,
  sourcemap: process.argv.includes('--dev'),
  outfile: join(root, 'app/bundle.js'),
  logLevel: 'info',
});
