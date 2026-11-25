const P = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  filePlus: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  save: '<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><path d="M7 21v-7h10v7"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  cursor: '<path d="M5 3l14 7.5-6.2 1.8L10 19z"/><path d="M13 13l5 5"/>',
  ruler: '<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>',
  arrows: '<path d="M3 12h18"/><path d="M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5L5 20"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  top: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
  cube: '<path d="M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M12 21.5V12M20.5 7.3L12 12 3.5 7.3"/>',
  eye: '<path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  side: '<path d="M2 19h20"/><path d="M5 19v-7l4-3v10M13 19v-5h6v5"/>',
  orbit: '<circle cx="12" cy="12" r="2.5"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><path d="M19 7.5l1.6-1.6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  focus: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><circle cx="12" cy="12" r="2.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  clip: '<path d="M8 4h8M9 2h6v4H9z"/><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 11h6M9 15h6"/>',
};

export function icon(name, cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    if (!el.firstChild) el.innerHTML = icon(el.dataset.icon);
  });
  root.querySelectorAll('[data-emblem]').forEach((el) => {
    if (!el.firstChild) el.innerHTML = emblem(el.dataset.emblem);
  });
}

/** Program amblemi: altıgen kalkan + nişangah + dağ silüeti */
export function emblem(kind = 'full') {
  const mini = kind === 'mini';
  return `<svg viewBox="0 0 200 200" fill="none">
  <defs>
    <linearGradient id="emG${kind}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6d38a"/><stop offset="1" stop-color="#a87a2a"/></linearGradient>
    <radialGradient id="emR${kind}" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#2a3021"/><stop offset="1" stop-color="#0e110c"/></radialGradient>
  </defs>
  ${mini ? '' : `<circle class="em-spin" cx="100" cy="100" r="96" stroke="#d6a646" stroke-opacity="0.5" stroke-width="1.2" stroke-dasharray="4 10"/>
  <circle class="em-spin2" cx="100" cy="100" r="88" stroke="#d6a646" stroke-opacity="0.25" stroke-width="6" stroke-dasharray="40 26 4 26"/>
  <circle class="em-pulse" cx="100" cy="100" r="78" stroke="#d6a646" stroke-opacity="0.35" stroke-width="1"/>`}
  <path d="M100 22 L166 60 L166 140 L100 178 L34 140 L34 60 Z" fill="url(#emR${kind})" stroke="url(#emG${kind})" stroke-width="${mini ? 12 : 5}" ${mini ? '' : 'class="em-draw"'}/>
  <path d="M48 128 L78 92 L94 108 L116 80 L152 128 Z" fill="#3b4430" opacity="0.95"/>
  <path d="M48 128 L152 128" stroke="#d6a646" stroke-width="${mini ? 6 : 2.5}" opacity="0.8"/>
  <circle cx="100" cy="94" r="${mini ? 30 : 32}" stroke="url(#emG${kind})" stroke-width="${mini ? 10 : 4}" ${mini ? '' : 'class="em-draw"'}/>
  <circle cx="100" cy="94" r="5" fill="#f0c368"/>
  <path d="M100 52 V74 M100 114 V136 M58 94 H80 M120 94 H142" stroke="#f0c368" stroke-width="${mini ? 10 : 4}" stroke-linecap="round"/>
</svg>`;
}
