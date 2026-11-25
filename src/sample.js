import { uid } from './util.js';

const D = Math.PI / 180;
const I = (type, x, z, rot = 0, p = {}, extra = {}) => ({ id: uid(), type, x, z, rot: rot * D, p, ...extra });

/** Örnek: "Kademeli Taarruz" parkuru (30 x 45 m poligon) */
export function sampleState() {
  return {
    surum: 1,
    bilgi: {
      ad: 'Kademeli Taarruz', no: '3', tarih: new Date().toLocaleDateString('tr-TR'),
      sorumlu: 'Atış Emniyet Astsubayı', birlik: '', silah: 'Tabanca',
      baslangicPoz: 'A1 kaidesinde, eller kaide üzerinde, hedeflere dönük.',
      silahDurum: 'Şarjör takılı, fişek yatakta değil, kılıfta.',
      sinyal: 'Sesli (düdük)',
      prosedur: '1) Düdük ile A1\'den H1–H3 hedeflerine ikişer atım.\n2) Sol paravana ilerle, A2 kutusundan pencereden H4–H5\'e ikişer atım.\n3) A3 noktasına geç, çelik hedefleri düşür.\n4) Dost hedeflere (D1–D2) isabet ceza puanıdır.',
      notlar: 'Atış hattı geçilmeyecek. Hata çizgisinin önüne basmak usul hatasıdır.',
    },
    poligon: { w: 30, d: 45 },
    emniyet: { celikMin: 7 },
    items: [
      // atış noktaları
      I('kaide', 0, -2, 0),
      I('kutu', -7, -9, 0, { w: 1.5, d: 1.5 }),
      I('kutu', 6, -11, 0, { w: 2, d: 1.5 }),
      I('baslangic', 0, -0.6, 0),
      // hedefler – ilk grup
      I('hedef', -3, -14, 0, { yuk: 0.85, atim: 2 }),
      I('hedef', 0, -16, 0, { yuk: 0.85, atim: 2 }),
      I('hedef', 3, -14, 0, { yuk: 0.85, atim: 2 }),
      I('dost', 1.2, -15.6, 0, { yuk: 0.85 }),
      // pencere arkası grubu
      I('hedef', -9, -22, 15, { yuk: 0.9, atim: 2 }),
      I('mini', -5.5, -24, -10, { yuk: 1.0, atim: 2 }),
      I('dost', -7.4, -22.8, 0, { yuk: 0.85 }),
      // çelikler
      I('popper', 7, -24, 0, { atim: 1 }),
      I('popper', 9, -25, 0, { atim: 1 }),
      I('plaka_rafi', 4, -27, 0, { atim: 6 }),
      // engeller
      I('pencere', -7, -11.2, 0, { w: 2.4, h: 1.9, pw: 0.7, ph: 0.5, py: 1.0 }),
      I('duvar', -4.6, -10, 90, { w: 2.4, h: 1.8 }),
      I('duvar', 3.5, -12.5, 90, { w: 2.4, h: 1.8 }),
      I('barikat', 6, -13, 0, { w: 1.2, h: 1.0 }),
      I('kum', 0, -6, 0, { w: 2, kat: 4 }),
      I('varil', 9.5, -8, 0),
      I('varil', 10.1, -8.5, 0),
      I('lastik', -11, -6, 0, { adet: 3 }),
      I('palet', 11, -15, 30, { adet: 2 }),
      I('hata', -7, -8, 0, { w: 3 }),
      I('hata', 6, -10, 0, { w: 3 }),
      I('koni', -3, -4, 0),
      I('koni', 3, -4, 0),
      I('ok', -3.5, -7, 40, { boy: 2.2 }),
      I('ok', 3.5, -7.5, -35, { boy: 2.2 }),
      I('asker', 0.35, -2.5, 0, { poz: 'ayakta', silah: 'tufek' }),
      I('asker', -7, -9.3, 0, { poz: 'diz', silah: 'tufek' }),
      I('direk', -14, -44, 0, { h: 3 }),
      I('yazi', 0, -30, 0, { metin: 'HEDEF HATTI', yuk: 2.2 }),
      // ölçüler
      { id: uid(), type: 'olcu', a: { x: -14.5, z: 0 }, b: { x: -14.5, z: -16 }, renk: '#ffc21a' },
      { id: uid(), type: 'olcu', a: { x: -3, z: -18 }, b: { x: 3, z: -18 }, renk: '#ffc21a' },
    ],
  };
}

/** Fotoğraftaki gibi düz hedef hattı (ana menü arka planı ve yeni parkur için) */
export function baseLineState() {
  const items = [];
  for (let i = 0; i < 7; i++) items.push(I('hedef', -6 + i * 2, -43, 0, { yuk: 0.8, atim: 2 }));
  return items;
}
