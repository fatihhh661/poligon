// Poly Haven (CC0) varlıklarını indirip app/assets altına hazırlar.
// Kullanım: node scripts/fetch-assets.mjs
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, 'app/assets');
const TMP = join(root, 'dist/asset-src');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

// curl kullanılır (ortamın HTTPS proxy ayarını otomatik izler)
const api = async (p) => JSON.parse(execSync(`curl -sfL "https://api.polyhaven.com${p}"`, { maxBuffer: 64 << 20 }).toString());
async function dl(url, dest) {
  if (existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  execSync(`curl -sfL --retry 3 -o "${dest}.part" "${url}" && mv "${dest}.part" "${dest}"`);
  console.log('  indirildi', dest.replace(root, ''));
}

// ---- Gökyüzleri ----
const HDRI = { sabah: 'kloofendal_43d_clear_puresky', ogle: 'kloofendal_48d_partly_cloudy_puresky', aksam: 'qwantani_sunset_puresky' };
for (const [k, id] of Object.entries(HDRI)) {
  const f = await api('/files/' + id);
  await dl(f.hdri['2k'].hdr.url, join(OUT, 'sky', k + '.hdr'));
}

// ---- Dokular (diff, normal GL, arm = AO/pürüzlülük/metal) ----
const TEX = {
  gravel: 'bicolour_gravel',
  berm: 'dry_ground_rocks',
  grass: 'withered_grass',
  forest: 'forest_ground_04',
  rock: 'rock_face_03',
  plywood: 'plywood',
  wood: 'weathered_planks',
  roof: 'box_profile_metal_sheet',
  concrete: 'concrete_floor_02',
  sand: 'gravelly_sand',
};
for (const [k, id] of Object.entries(TEX)) {
  const f = await api('/files/' + id);
  const res = k === 'gravel' || k === 'berm' || k === 'plywood' ? '2k' : '1k';
  await dl(f.Diffuse[res].jpg.url, join(OUT, 'tex', `${k}_diff.jpg`));
  await dl(f.nor_gl[res].jpg.url, join(OUT, 'tex', `${k}_nor.jpg`));
  await dl(f.arm[res].jpg.url, join(OUT, 'tex', `${k}_arm.jpg`));
}

// ---- Çam dalı ve kabuk (ağaçlar için) ----
{
  const f = await api('/files/pine_tree_01');
  await dl(f.twig_diff['1k'].png?.url || f.twig_diff['1k'].jpg.url, join(TMP, 'twig_diff.' + (f.twig_diff['1k'].png ? 'png' : 'jpg')));
  await dl(f.twig_alpha['1k'].png?.url || f.twig_alpha['1k'].jpg.url, join(TMP, 'twig_alpha.' + (f.twig_alpha['1k'].png ? 'png' : 'jpg')));
  await dl(f.twig_nor_gl['1k'].jpg.url, join(OUT, 'tex', 'twig_nor.jpg'));
  await dl(f.bark_diff['1k'].jpg.url, join(OUT, 'tex', 'bark_diff.jpg'));
  await dl(f.bark_nor_gl['1k'].jpg.url, join(OUT, 'tex', 'bark_nor.jpg'));
}

// ---- Modeller ----
const MODELS = {
  barrel: ['Barrel_01', 1],
  tyre: ['old_tyre', 1],
  table: ['WoodenTable_01', 1],
  crate: ['old_military_crate', 0.5],
  ammo: ['ammo_box', 0.6],
  rock1: ['rock_07', 0.12],
  rock2: ['rock_09', 0.12],
  shrub: ['shrub_03', 0.35],
};
for (const [k, [id, ratio]] of Object.entries(MODELS)) {
  const out = join(OUT, 'models', k + '.glb');
  if (existsSync(out)) continue;
  const f = await api('/files/' + id);
  const g = f.gltf['1k'].gltf;
  const dir = join(TMP, id);
  await dl(g.url, join(dir, id + '.gltf'));
  for (const [rel, inc] of Object.entries(g.include)) await dl(inc.url, join(dir, rel));
  mkdirSync(dirname(out), { recursive: true });
  const src = join(dir, id + '.gltf');
  const mid = join(dir, 'mid.glb');
  if (ratio < 1) execSync(`npx gltf-transform simplify "${src}" "${mid}" --ratio ${ratio} --error 0.002`, { stdio: 'inherit', cwd: root });
  else execSync(`npx gltf-transform copy "${src}" "${mid}"`, { stdio: 'inherit', cwd: root });
  execSync(`npx gltf-transform resize "${mid}" "${out}" --width 1024 --height 1024`, { stdio: 'inherit', cwd: root });
  console.log('  model hazır', k);
}
console.log('Bitti.');
