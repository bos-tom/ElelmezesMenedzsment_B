// Dashboard: személyenkénti haladásjelző sziluettel.
// A tagok listája a config/app.admins sorrendjét követi (ugyanaz, mint a csevegőszíneké).
// Sziluett: a config/app.male listában szereplők férfi, a többiek női sziluettet kapnak.
// A haladás egyelőre mindenkinél 0%; később a személyes feladatlista kipipált elemeiből számoljuk.
import { el } from './dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Egyszerű, egymáshoz illő sziluettek (viewBox 0 0 100 140).
const FIGURES = {
  // Női: hosszabb haj a fej körül, harang alakú ruha.
  no: [
    'M50 8 C34 8 26 20 26 34 C26 46 28 54 24 62 L38 58 C42 60 46 62 50 62 C54 62 58 60 62 58 L76 62 C72 54 74 46 74 34 C74 20 66 8 50 8 Z',
    'M50 50 C41 50 34 43 34 33 C34 23 41 16 50 16 C59 16 66 23 66 33 C66 43 59 50 50 50 Z',
    'M30 70 C38 64 44 62 50 62 C56 62 62 64 70 70 L86 130 C66 136 34 136 14 130 Z',
  ],
  // Férfi: rövid haj, szélesebb váll, egyenes törzs.
  ferfi: [
    'M50 12 C38 12 32 20 32 30 L32 34 L68 34 L68 30 C68 20 62 12 50 12 Z',
    'M50 52 C40 52 33 44 33 34 C33 24 40 16 50 16 C60 16 67 24 67 34 C67 44 60 52 50 52 Z',
    'M18 76 C24 66 36 62 50 62 C64 62 76 66 82 76 L84 132 C62 136 38 136 16 132 Z',
  ],
};

let uid = 0;

function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

// Sziluett, amely alulról a haladás arányában töltődik fel.
function figure(kind, percent) {
  const id = `fig-clip-${++uid}`;
  const paths = FIGURES[kind] || FIGURES.no;
  const root = svg('svg', { viewBox: '0 0 100 140', class: 'figure', 'aria-hidden': 'true', focusable: 'false' });
  const clip = svg('clipPath', { id });
  for (const d of paths) clip.append(svg('path', { d }));
  const defs = svg('defs', {});
  defs.append(clip);
  root.append(defs);
  for (const d of paths) root.append(svg('path', { d, class: 'figure-base' }));
  const h = Math.round(140 * Math.max(0, Math.min(100, percent)) / 100);
  root.append(svg('rect', { x: 0, y: 140 - h, width: 100, height: h, class: 'figure-fill', 'clip-path': `url(#${id})` }));
  return root;
}

// A tagok a configból: név (becenév vagy a cím @ előtti része), sziluett, szín.
export function membersFrom(config) {
  const admins = Array.isArray(config?.admins) ? config.admins.filter((a) => typeof a === 'string') : [];
  const names = config?.names && typeof config.names === 'object' ? config.names : {};
  const male = new Set((Array.isArray(config?.male) ? config.male : []).map((e) => String(e).toLowerCase()));
  return admins.map((raw, i) => {
    const email = raw.toLowerCase();
    const nick = typeof names[email] === 'string' && names[email].trim() ? names[email].trim() : email.split('@')[0];
    return { key: email, name: nick, figure: male.has(email) ? 'ferfi' : 'no', color: i % 8 };
  });
}

// Egyelőre nincs feladatlista: mindenkinél 0 / 0.
function progressOf(/* member */) {
  return { done: 0, total: 0 };
}

// Összesített haladás: kör alakú jelző a tábla közepén.
function overallGauge(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  const ring = svg('svg', { viewBox: '0 0 120 120', class: 'gauge-ring', 'aria-hidden': 'true', focusable: 'false' });
  ring.append(
    svg('circle', { cx: 60, cy: 60, r, class: 'gauge-track' }),
    svg('circle', {
      cx: 60, cy: 60, r, class: 'gauge-value',
      'stroke-dasharray': `${c} ${c}`, 'stroke-dashoffset': c * (1 - pct / 100),
      transform: 'rotate(-90 60 60)',
      // 0%-nál a lekerekített vonalvég egy pöttyöt rajzolna; azt elrejtjük.
      'stroke-opacity': pct > 0 ? 1 : 0,
    }),
  );
  return el('div', {
    class: 'gauge',
    role: 'progressbar',
    'aria-label': 'A csoport összesített haladása',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': String(pct),
  },
  el('div', { class: 'gauge-dial' }, ring, el('div', { class: 'gauge-pct', text: `${pct}%` })),
  el('div', { class: 'gauge-label', text: 'Összesen' }),
  el('div', { class: 'person-sub', text: total ? `${done} / ${total} feladat kész` : 'Még nincs kiosztott feladat' }));
}

export function renderDashboard(members) {
  const board = document.getElementById('dash-people');
  let sumDone = 0;
  let sumTotal = 0;
  const cards = members.map((m) => {
    const { done, total } = progressOf(m);
    sumDone += done;
    sumTotal += total;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return el('div', { class: 'person', 'data-color': m.color },
      figure(m.figure, pct),
      el('div', { class: 'person-name', text: m.name }),
      el('div', { class: 'person-pct', text: `${pct}%` }),
      el('div', {
        class: 'person-bar',
        role: 'progressbar',
        'aria-label': `${m.name} haladása`,
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(pct),
      }, el('span', { style: `width:${pct}%` })),
      el('div', { class: 'person-sub', text: total ? `${done} / ${total} feladat kész` : 'Még nincs kiosztott feladat' }));
  });

  // Két sor, arányosan: soronként fele-fele a tagoknak, a sor közepén az összesített jelző.
  const perRow = Math.max(1, Math.ceil(members.length / 2));
  const left = Math.ceil(perRow / 2);
  const right = perRow - left;
  board.style.setProperty('--left', left);
  board.style.setProperty('--right', right);
  board.style.setProperty('--gauge-col', left + 1);
  board.replaceChildren(overallGauge(sumDone, sumTotal), ...cards);
}
