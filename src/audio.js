let ctx = null;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

/** Sentezlenmiş sinematik açılış sesi: derin darbe + yükselen ton + metalik parıltı */
export function playIntro(enabled = true) {
  if (!enabled) return;
  try {
    const a = ac();
    a.resume?.();
    const t = a.currentTime + 0.05;
    const master = a.createGain();
    master.gain.value = 0.55;
    const comp = a.createDynamicsCompressor();
    master.connect(comp).connect(a.destination);

    // derin darbe
    const o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 1.6);
    const og = a.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    o.connect(og).connect(master);
    o.start(t);
    o.stop(t + 2.3);

    // gürültü "whoosh"
    const len = a.sampleRate * 2.5;
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
    const n = a.createBufferSource();
    n.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.25, t + 0.9);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    n.connect(bp).connect(ng).connect(master);
    n.start(t);

    // pad akoru
    for (const [f, del] of [[220, 0.6], [329.6, 0.75], [440, 0.9], [659.3, 1.1]]) {
      const p = a.createOscillator();
      p.type = 'triangle';
      p.frequency.value = f;
      const pg = a.createGain();
      pg.gain.setValueAtTime(0.0001, t + del);
      pg.gain.exponentialRampToValueAtTime(0.07, t + del + 0.4);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + del + 2.8);
      p.connect(pg).connect(master);
      p.start(t + del);
      p.stop(t + del + 3);
    }
  } catch (e) {
    /* ses desteklenmiyor */
  }
}

export function playClick(enabled = true) {
  if (!enabled) return;
  try {
    const a = ac();
    const t = a.currentTime;
    const o = a.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.04);
    const g = a.createGain();
    g.gain.setValueAtTime(0.04, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.07);
  } catch (e) { /* */ }
}
