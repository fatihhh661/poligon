import { CATALOG, KATEGORILER, isTarget, isPoint } from './objects.js';
import { icon, hydrateIcons } from './icons.js';
import { esc, fmtM, fmtN, DEG } from './util.js';

export const $ = (q, r = document) => r.querySelector(q);
export const $$ = (q, r = document) => [...r.querySelectorAll(q)];

// ================= toast / modal / ipucu =================
export function toast(msg, type = 'ok', ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast' + (type === 'err' ? ' err' : '');
  t.innerHTML = `<i>${icon(type === 'err' ? 'alert' : 'check')}</i><span>${msg}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, ms);
}

export function modal({ title, ikon = 'info', body = '', buttons = [{ text: 'Kapat', primary: true }], width = null, onOpen = null }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML = `<div class="modal" ${width ? `style="width:min(${width}px,92vw)"` : ''}>
      <div class="modal-h"><i>${icon(ikon)}</i><h3>${esc(title)}</h3><button class="modal-x" data-x>✕</button></div>
      <div class="modal-b">${body}</div>
      <div class="modal-f">${buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" data-b="${i}">${esc(b.text)}</button>`).join('')}</div>
    </div>`;
    const close = (v) => {
      ov.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
    };
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('pointerdown', (e) => { if (e.target === ov) close(null); });
    ov.querySelector('[data-x]').onclick = () => close(null);
    ov.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => close(buttons[+b.dataset.b].value ?? +b.dataset.b)));
    $('#modalRoot').appendChild(ov);
    hydrateIcons(ov);
    if (onOpen) onOpen(ov.querySelector('.modal'), close);
  });
}

export async function confirmBox(text, okText = 'Devam', danger = false) {
  const v = await modal({ title: 'Onay', ikon: 'alert', body: `<p style="margin:0;color:#c9d0d7">${text}</p>`, buttons: [{ text: 'İptal', value: false }, { text: okText, primary: !danger, danger, value: true }] });
  return v === true;
}

export function initTooltips() {
  const tip = $('#tooltip');
  let timer = null, cur = null;
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el === cur) return;
    cur = el;
    clearTimeout(timer);
    tip.classList.remove('on');
    if (!el) return;
    timer = setTimeout(() => {
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect();
      tip.style.left = '0px';
      tip.style.top = '0px';
      tip.classList.add('on');
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2;
      let y = r.bottom + 8;
      if (y + th > innerHeight - 4) y = r.top - th - 8;
      x = Math.max(6, Math.min(innerWidth - tw - 6, x));
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }, 450);
  });
  document.addEventListener('pointerdown', () => { clearTimeout(timer); tip.classList.remove('on'); });
}

// ================= kütüphane =================
export function buildLibrary(thumbs) {
  const list = $('#libList');
  list.innerHTML = KATEGORILER.map((k) => {
    const items = Object.entries(CATALOG).filter(([, c]) => c.kat === k);
    return `<details class="lib-cat" open><summary>${k.toLocaleUpperCase('tr-TR')} <small>${items.length}</small></summary><div class="lib-grid">${items
      .map(([t, c]) => `<div class="lib-item" data-type="${t}" data-name="${esc(c.ad.toLocaleLowerCase('tr-TR'))}" data-tip="${esc(c.ad)} — sürükleyip sahneye bırakın"><img src="${thumbs[t] || ''}" alt=""><span>${esc(c.ad)}</span></div>`)
      .join('')}</div></details>`;
  }).join('');
  $('#libSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLocaleLowerCase('tr-TR');
    $$('.lib-item').forEach((el) => el.classList.toggle('is-hidden', q && !el.dataset.name.includes(q)));
    $$('.lib-cat').forEach((d) => {
      const any = $$('.lib-item:not(.is-hidden)', d).length;
      d.classList.toggle('is-hidden', !any);
      if (q) d.open = true;
    });
  });
}

// ================= özellikler paneli =================
const rolTag = (C, label) => {
  if (!label) return '';
  const cls = C.rol === 'hedef' ? 'h' : C.rol === 'celik' ? 'c' : C.rol === 'dost' ? 'd' : 'a';
  return `<span class="tag ${cls}">${esc(label)}</span>`;
};

function numField(label, attr, value, unit = 'm', step = 0.1, extra = '') {
  return `<div class="fld"><label>${label}</label><div class="unit" data-u="${unit}"><input type="number" ${attr} value="${value}" step="${step}" ${extra}></div></div>`;
}

const KEYS = `<div class="keys">
  <kbd>Sol tık + sürükle</kbd><span>Elemanı taşı / boşlukta kamerayı döndür</span>
  <kbd>Sağ tık + sürükle</kbd><span>Kamerayı kaydır</span>
  <kbd>Tekerlek</kbd><span>Yakınlaştır / uzaklaştır</span>
  <kbd>Q</kbd> <span>/ <kbd>E</kbd> Seçiliyi 15° döndür</span>
  <kbd>Ok tuşları</kbd><span>10 cm kaydır (Shift: 1 m)</span>
  <kbd>Ctrl+D</kbd><span>Çoğalt</span>
  <kbd>Del</kbd><span>Sil</span>
  <kbd>M</kbd><span>Mesafe ölç</span>
  <kbd>F</kbd><span>Seçiliye odaklan</span>
  <kbd>1 – 6</kbd><span>Kamera görünümleri</span>
  <kbd>Ctrl+Z / Y</kbd><span>Geri al / İleri al</span>
  <kbd>Alt</kbd><span>Izgaraya yapışmadan taşı</span>
</div>`;
export { KEYS };

export function renderProps(ed, thumbs) {
  const el = $('#tab-ozellik');
  const active = document.activeElement && el.contains(document.activeElement) ? keyOf(document.activeElement) : null;
  const it = ed.cur();
  if (!it) {
    el.innerHTML = `<div class="empty"><span class="big">${icon('cursor')}</span><h4>Seçim yok</h4>
      <div>Bir elemana tıklayarak seçin ya da soldaki kütüphaneden sahneye sürükleyin.</div>${KEYS}</div>`;
    return;
  }
  if (it.type === 'olcu') {
    const len = Math.hypot(it.b.x - it.a.x, it.b.z - it.a.z);
    el.innerHTML = `<div class="sel-head"><span style="width:64px;height:48px;display:grid;place-items:center;color:#ffc21a">${icon('ruler')}</span><div><b>Mesafe Ölçüsü</b><small>Uzunluk: <b style="display:inline;font:inherit;color:var(--accent2)">${fmtM(len)}</b></small></div></div>
      <div class="sec"><div class="sec-title">BAŞLANGIÇ NOKTASI</div><div class="row2">
        ${numField('Yanal (X)', 'data-m="ax"', fmtIn(it.a.x))}${numField('Atış hattından', 'data-m="az"', fmtIn(-it.a.z))}</div></div>
      <div class="sec"><div class="sec-title">BİTİŞ NOKTASI</div><div class="row2">
        ${numField('Yanal (X)', 'data-m="bx"', fmtIn(it.b.x))}${numField('Atış hattından', 'data-m="bz"', fmtIn(-it.b.z))}</div></div>
      <div class="sec"><div class="sec-title">GÖRÜNÜM</div><div class="fld"><label>Renk</label>
        <div class="seg" id="mColor">${[['#ffc21a', 'Sarı'], ['#ff5252', 'Kırmızı'], ['#3fd0ff', 'Mavi'], ['#7dff8a', 'Yeşil'], ['#ffffff', 'Beyaz']]
          .map(([c, n]) => `<button data-c="${c}" class="${it.renk === c ? 'on' : ''}"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c};margin-right:5px"></span>${n}</button>`).join('')}</div></div></div>
      <div class="btns"><button class="btn" data-act="focus"><i>${icon('focus')}</i>Odakla</button><button class="btn" data-act="dup"><i>${icon('copy')}</i>Çoğalt</button><button class="btn danger" data-act="del"><i>${icon('trash')}</i>Sil</button></div>`;
    restoreFocus(el, active);
    return;
  }
  const C = CATALOG[it.type];
  const label = ed.labels.get(it.id);
  const rolTxt = { hedef: 'Kağıt hedef', celik: 'Çelik hedef', dost: 'Dost / sivil hedef (atılmaz)', nokta: 'Atış noktası' }[C.rol] || C.kat;
  let h = `<div class="sel-head"><img src="${thumbs[it.type] || ''}"><div><b>${esc(C.ad)}${rolTag(C, label)}</b><small>${rolTxt}</small></div></div>`;
  h += `<div class="sec"><div class="sec-title">KONUM</div><div class="row2">
    ${numField('Yanal (X)', 'data-f="x"', fmtIn(it.x))}${numField('Atış hattından', 'data-f="ileri"', fmtIn(-it.z))}</div>
    <div class="fld"><label>Yön açısı</label><div class="slider"><input type="range" min="-180" max="180" step="5" data-f="rotr" value="${Math.round((it.rot || 0) / DEG)}"><output id="rotOut">${Math.round((it.rot || 0) / DEG)}°</output></div></div></div>`;
  if (label) h += `<div class="sec"><div class="sec-title">ETİKET</div><div class="fld"><label>Numara / ad (boş bırakılırsa otomatik)</label><input type="text" data-f="etiket" value="${esc(it.etiket || '')}" placeholder="${esc(ed.computeLabels().get(it.id) && !it.etiket ? label : '')}"></div></div>`;
  if (C.params.length) {
    h += `<div class="sec"><div class="sec-title">ÖZELLİKLER</div>`;
    const p = { ...it.p };
    const nums = C.params.filter((d) => d.tip === 'sayi');
    for (const d of C.params) {
      const v = p[d.k] ?? d.def;
      if (d.tip === 'secim') h += `<div class="fld"><label>${d.ad}</label><div class="seg">${d.ops.map(([k, n]) => `<button data-p="${d.k}" data-v="${k}" class="${v === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>`;
      else if (d.tip === 'metin') h += `<div class="fld"><label>${d.ad}</label><input type="text" data-p="${d.k}" value="${esc(v)}"></div>`;
    }
    for (let i = 0; i < nums.length; i += 2) {
      const pair = nums.slice(i, i + 2).map((d) => {
        const unit = /\(m\)/.test(d.ad) ? 'm' : /°/.test(d.ad) ? '°' : '';
        return numField(d.ad.replace(/ \(m\)| \(°\)/, ''), `data-p="${d.k}" min="${d.min}" max="${d.max}"`, fmtIn(p[d.k] ?? d.def), unit, d.step);
      });
      h += `<div class="${pair.length === 2 ? 'row2' : ''}">${pair.join('')}</div>`;
    }
    h += `</div>`;
  }
  // mesafeler
  const points = ed.state.items.filter((i) => isPoint(i.type));
  const targets = ed.state.items.filter((i) => isTarget(i.type) || CATALOG[i.type]?.rol === 'dost');
  const others = isPoint(it.type) ? targets : (isTarget(it.type) || C.rol === 'dost') ? points : [];
  if (others.length) {
    h += `<div class="sec"><div class="sec-title">${isPoint(it.type) ? 'HEDEFLERE MESAFE' : 'ATIŞ NOKTALARINA MESAFE'}</div><div class="dist-list">`;
    for (const o of others) {
      const dx = o.x - it.x, dz = o.z - it.z;
      const d = Math.hypot(dx, dz);
      const p = isPoint(it.type) ? it : o, t = isPoint(it.type) ? o : it;
      const ang = Math.atan2(t.x - p.x, -(t.z - p.z)) / DEG;
      h += `<div class="dist-row" data-goto="${o.id}"><b>${esc(ed.labels.get(o.id))}</b><span class="a">${esc(CATALOG[o.type].ad)} · ${ang >= 0 ? 'sağ' : 'sol'} ${Math.abs(ang).toFixed(0)}°</span><span class="v">${fmtM(d)}</span></div>`;
    }
    h += `</div></div>`;
  }
  h += `<div class="btns"><button class="btn" data-act="focus"><i>${icon('focus')}</i>Odakla</button><button class="btn" data-act="dup"><i>${icon('copy')}</i>Çoğalt</button><button class="btn danger" data-act="del"><i>${icon('trash')}</i>Sil</button></div>`;
  el.innerHTML = h;
  restoreFocus(el, active);
}

const fmtIn = (v) => Math.round(v * 100) / 100;
function keyOf(a) {
  for (const k of ['data-f', 'data-p', 'data-m', 'data-b', 'data-r', 'data-e']) if (a.hasAttribute(k)) return `[${k}="${a.getAttribute(k)}"]`;
  return null;
}
function restoreFocus(el, key) {
  if (!key) return;
  const n = el.querySelector(key);
  if (n) { n.focus(); n.select?.(); }
}

/** Sürükleme sırasında yalnızca değerleri güncelle */
export function syncProps(ed) {
  const it = ed.cur();
  if (!it || it.type === 'olcu') return;
  const el = $('#tab-ozellik');
  const set = (sel, v) => { const n = el.querySelector(sel); if (n && n !== document.activeElement) n.value = v; };
  set('[data-f="x"]', fmtIn(it.x));
  set('[data-f="ileri"]', fmtIn(-it.z));
  set('[data-f="rotr"]', Math.round((it.rot || 0) / DEG));
  const o = el.querySelector('#rotOut');
  if (o) o.textContent = Math.round((it.rot || 0) / DEG) + '°';
  if (it.p?.w != null) set('[data-p="w"]', fmtIn(it.p.w));
}

// ================= parkur paneli =================
export function renderParkur(ed) {
  const el = $('#tab-parkur');
  const b = ed.state.bilgi, pg = ed.state.poligon;
  const tf = (label, k, ph = '') => `<div class="fld"><label>${label}</label><input type="text" data-b="${k}" value="${esc(b[k])}" placeholder="${esc(ph)}"></div>`;
  const ta = (label, k, ph = '') => `<div class="fld"><label>${label}</label><textarea data-b="${k}" placeholder="${esc(ph)}">${esc(b[k])}</textarea></div>`;
  el.innerHTML = `
    <div class="sec"><div class="sec-title">ÖZET</div><div id="pkStats"></div></div>
    <div class="sec"><div class="sec-title">PARKUR BİLGİLERİ</div>
      ${tf('Parkur adı', 'ad')}
      <div class="row2">${tf('Parkur no', 'no')}${tf('Tarih', 'tarih')}</div>
      <div class="row2">${tf('Sorumlu personel', 'sorumlu')}${tf('Birlik', 'birlik')}</div>
      <div class="fld"><label>Silah türü</label><select data-b="silah">${['Tabanca', 'Tüfek', 'Tabanca + Tüfek', 'Pompalı Tüfek', 'Diğer'].map((s) => `<option ${b.silah === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    </div>
    <div class="sec"><div class="sec-title">POLİGON ÖLÇÜLERİ</div><div class="row2">
      ${numField('Genişlik', 'data-r="w" min="10" max="200"', pg.w, 'm', 1)}${numField('Derinlik', 'data-r="d" min="10" max="300"', pg.d, 'm', 1)}</div></div>
    <div class="sec"><div class="sec-title">BRİFİNG</div>
      ${ta('Başlangıç pozisyonu', 'baslangicPoz', 'Örn: A1 kaidesinde, eller kaide üzerinde')}
      ${ta('Silah durumu', 'silahDurum', 'Örn: Şarjör takılı, fişek yatakta değil, kılıfta')}
      ${tf('Başlangıç sinyali', 'sinyal')}
      ${ta('Parkur prosedürü', 'prosedur', 'Adım adım uygulanacak görevler')}
      ${ta('Emniyet notları', 'notlar')}
    </div>`;
  updateStats(ed);
}

export function updateStats(ed) {
  const el = $('#pkStats');
  if (!el) return;
  const A = ed.analyze();
  const sure = A.sure ? fmtN(A.sure, 0) + ' sn' : '—';
  el.innerHTML = `<div class="stats">
    <div class="stat"><b>${A.targets.length}</b><span>Hedef (${A.steel.length} çelik)</span></div>
    <div class="stat"><b>${A.atim}</b><span>Minimum atım</span></div>
    <div class="stat"><b>${A.points.length}</b><span>Atış noktası</span></div>
    <div class="stat"><b>${A.dost.length}</b><span>Dost / sivil hedef</span></div>
    <div class="stat"><b>${fmtN(A.yol, 1)} m</b><span>Noktalar arası yol</span></div>
    <div class="stat"><b>${sure}</b><span>Tahmini süre</span></div></div>`;
}

// ================= mesafe paneli =================
export function renderMesafe(ed) {
  const el = $('#tab-mesafe');
  const items = ed.state.items;
  const points = items.filter((i) => isPoint(i.type));
  const targets = items.filter((i) => isTarget(i.type) || CATALOG[i.type]?.rol === 'dost');
  const meas = items.filter((i) => i.type === 'olcu');
  let h = '';
  if (!points.length || !targets.length) {
    h += `<div class="empty"><span class="big">${icon('arrows')}</span><h4>Mesafe tablosu</h4><div>Atış noktası ve hedef ekledikçe tüm mesafeler burada otomatik listelenir.</div></div>`;
  }
  for (const p of points) {
    const rows = targets
      .map((t) => ({ t, d: Math.hypot(t.x - p.x, t.z - p.z), a: Math.atan2(t.x - p.x, -(t.z - p.z)) / DEG }))
      .sort((a, b) => a.d - b.d);
    h += `<div class="dist-group"><h5><span class="tag a" style="margin:0">${esc(ed.labels.get(p.id))}</span> ${esc(CATALOG[p.type].ad)}</h5><div class="dist-list">${rows
      .map((r) => `<div class="dist-row" data-goto="${r.t.id}"><b>${esc(ed.labels.get(r.t.id))}</b><span class="a">${esc(CATALOG[r.t.type].ad)} · ${r.a >= 0 ? 'sağ' : 'sol'} ${Math.abs(r.a).toFixed(0)}°</span><span class="v">${fmtM(r.d)}</span></div>`)
      .join('')}</div></div>`;
  }
  if (meas.length) {
    h += `<div class="dist-group"><h5>${icon('ruler').replace('<svg', '<svg style="width:16px;height:16px;color:#ffc21a"')} Çizilen ölçüler</h5><div class="dist-list">${meas
      .map((m, i) => `<div class="dist-row" data-goto="${m.id}"><b>Ölçü ${i + 1}</b><span class="v">${fmtM(Math.hypot(m.b.x - m.a.x, m.b.z - m.a.z))}</span></div>`)
      .join('')}</div></div>`;
  }
  el.innerHTML = h;
}

// ================= emniyet paneli =================
export function renderEmniyet(ed) {
  const el = $('#tab-emniyet');
  const A = ed.analyze();
  const ic = { hata: 'alert', uyari: 'alert', bilgi: 'info' };
  let h = `<div class="sec"><div class="sec-title">KONTROL SONUCU</div>`;
  if (!A.W.length) h += `<div class="ok-box"><i>${icon('shield')}</i><div><b>Sorun bulunamadı</b><br><small>Tüm hedefler emniyet açısı ve mesafe kurallarına uygun.</small></div></div>`;
  else h += A.W.map((w) => `<div class="warn-item ${w.lvl}" ${w.id ? `data-goto="${w.id}"` : ''}><i>${icon(ic[w.lvl])}</i><span>${esc(w.text)}</span></div>`).join('');
  h += `</div><div class="sec"><div class="sec-title">KURALLAR</div>
    ${numField('Çelik hedef minimum mesafesi', 'data-e="celikMin" min="1" max="50"', ed.state.emniyet.celikMin, 'm', 0.5)}
    <div style="color:var(--muted);font-size:12px;line-height:1.5">• Her atış noktasından hedef açısı, atış yönüne göre 90°'yi (180° emniyet düzlemi) aşmamalıdır.<br>• Hedefler poligon sınırları içinde ve arka set önünde olmalıdır.<br>• Çelik hedefler sekme riskine karşı minimum mesafeden yakın olmamalıdır.</div></div>`;
  el.innerHTML = h;
  const n = A.W.filter((w) => w.lvl !== 'bilgi').length;
  const badge = $('#warnBadge');
  badge.textContent = n;
  badge.classList.toggle('is-hidden', !n);
  badge.classList.toggle('warn', !A.W.some((w) => w.lvl === 'hata'));
  return A;
}
