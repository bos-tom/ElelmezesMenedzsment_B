// Mérföldkövek a Dashboardon: vízszintes idővonal (metróvonal), „ma” jelölővel.
// Az állomások a data/vegeredmeny.json milestones tömbjéből jönnek.
// Kész: az 1. a lezárt szavazásból, a 2. akkor, ha minden feladatnak van kidolgozója;
// a többit a koordinátor jelöli késznek (milestones/{id}, lásd firestore.rules).
import { collection, db, doc, onSnapshot, serverTimestamp, setDoc } from './firebase.js';
import { el, notify } from './dom.js';

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric' });
const dayOf = (iso) => new Date(`${iso}T00:00:00`);
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export function subscribeMilestones(store, onUpdate) {
  return onSnapshot(collection(db, 'milestones'), (snap) => {
    const marks = new Map();
    snap.forEach((d) => { if (typeof d.data().done === 'boolean') marks.set(d.id, d.data().done); });
    store.milestoneMarks = marks;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a mérföldköveket.'));
}

async function setMark(store, id, done) {
  try {
    await setDoc(doc(db, 'milestones', id), { done, updatedBy: store.user.uid, updatedAt: serverTimestamp() });
  } catch (e) {
    notify(e.code === 'permission-denied' ? 'Csak a koordinátor jelölheti késznek a mérföldkövet.' : 'Nem sikerült menteni, próbáld újra.');
  }
}

// Az állomás mérőszáma és az automatikus készültség.
function measure(store, m) {
  const final = store.data?.final;
  const tasks = (final?.tasks || []).filter((t) => !t.owner);
  if (m.auto === 'final') {
    const n = Object.keys(final?.results || {}).length;
    return { auto: n > 0, pct: n > 0 ? 100 : 0, text: `${n} döntés lezárva` };
  }
  if (m.auto === 'assignments') {
    const assigned = tasks.filter((t) => store.assignments.get(t.id)?.workers.length).length;
    const signed = tasks.filter((t) => store.signups.get(t.id)?.kidolgozo.size).length;
    return {
      auto: tasks.length > 0 && assigned === tasks.length,
      pct: tasks.length ? Math.round((assigned / tasks.length) * 100) : 0,
      text: `${tasks.length} feladatból ${assigned} kiosztva`,
      extra: `${signed} feladatra van jelentkező`,
    };
  }
  if (m.id === 'kidolgozas') {
    const steps = tasks.reduce((n, t) => n + (t.steps?.length || 0), 0);
    return { auto: false, pct: null, text: `${tasks.length} feladat, ${steps} lépés` };
  }
  return { auto: false, pct: null, text: '' };
}

function daysText(date, done) {
  if (done) return 'kész';
  const diff = Math.round((dayOf(date) - today()) / DAY);
  if (diff > 1) return `még ${diff} nap`;
  if (diff === 1) return 'holnap';
  if (diff === 0) return 'ma';
  return `${-diff} napja lejárt`;
}

// Kör az állomáson: kész = pipa, folyamatban = részben kitöltött gyűrű, hátralévő = üres.
function stationDot(state, pct) {
  const SVG = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };
  const root = s('svg', { viewBox: '0 0 40 40', class: 'ms-dot', 'aria-hidden': 'true', focusable: 'false' });
  root.append(s('circle', { cx: 20, cy: 20, r: 16, class: 'ms-dot-bg' }));
  if (state === 'done') {
    root.append(s('path', { d: 'M12 20.5 L18 26.5 L28.5 14', class: 'ms-check' }));
  } else if (state === 'active') {
    const c = 2 * Math.PI * 16;
    const p = pct == null ? 0 : pct;
    root.append(s('circle', {
      cx: 20, cy: 20, r: 16, class: 'ms-ring',
      'stroke-dasharray': `${c} ${c}`, 'stroke-dashoffset': c * (1 - p / 100),
      transform: 'rotate(-90 20 20)', 'stroke-opacity': p > 0 ? 1 : 0,
    }));
    root.append(s('circle', { cx: 20, cy: 20, r: 5, class: 'ms-core' }));
  }
  return root;
}

// A „ma” jelölő helye: két szomszédos állomás között a dátumok arányában (egyenlő közű állomások).
function todayPosition(list) {
  const t = today().getTime();
  const times = list.map((m) => dayOf(m.date).getTime());
  if (t <= times[0]) return 0;
  if (t >= times[times.length - 1]) return 100;
  const i = times.findIndex((x, k) => t >= x && t < times[k + 1]);
  const frac = (t - times[i]) / (times[i + 1] - times[i]);
  return ((i + frac) / (list.length - 1)) * 100;
}

export function renderMilestones(store) {
  const box = document.getElementById('dash-milestones');
  const list = store.data?.final?.milestones;
  if (!box || !Array.isArray(list) || list.length < 2) return;
  const marks = store.milestoneMarks || new Map();

  let activeFound = false;
  const items = list.map((m) => {
    const r = measure(store, m);
    // Kész, ha magától teljesült, vagy a koordinátor késznek jelölte.
    const done = r.auto || marks.get(m.id) === true;
    let state = 'pending';
    if (done) state = 'done';
    else if (!activeFound) { state = 'active'; activeFound = true; }
    const late = !done && dayOf(m.date) < today();
    return { m, r, done, state, late, manual: !r.auto };
  });
  const doneCount = items.filter((x) => x.done).length;
  const lastDone = items.reduce((k, x, i) => (x.done ? i : k), -1);

  const pos = todayPosition(list);
  // Keskeny kijelzőn (függőleges vonal) a „ma” címke annál az állomásnál van, amely után a mai nap következik.
  const todayIdx = Math.min(list.length - 1, Math.floor((pos / 100) * (list.length - 1) + 1e-9));
  const stations = items.map(({ m, r, done, state, late, manual }, i) => {
    // Az eltelt idő aránya ezen a szakaszon (függőleges nézethez).
    const elapsed = Math.max(0, Math.min(1, (pos / 100) * (list.length - 1) - i));
    const li = el('li', {
      class: `ms ms-${state}${late ? ' late' : ''}${i < lastDone ? ' seg-done' : ''}`,
      style: `--e:${(elapsed * 100).toFixed(1)}%`,
    },
      i === todayIdx ? el('span', { class: 'ms-today-tag', 'aria-hidden': 'true', text: 'ma' }) : null,
      // Az aktuális állomás fölött a haladás százaléka (a gyűrű ennyire telt meg).
      state === 'active' && r.pct != null ? el('div', { class: 'ms-pct', text: `${r.pct}%` }) : null,
      stationDot(state, r.pct),
      el('div', { class: 'ms-date', text: dateFmt.format(dayOf(m.date)) }),
      el('div', { class: 'ms-label', text: m.label }),
      m.sub ? el('div', { class: 'ms-sub', text: m.sub }) : null,
      r.text ? el('div', { class: 'ms-metric', text: r.text }) : null,
      r.extra && !done ? el('div', { class: 'ms-sub', text: r.extra }) : null,
      el('div', { class: 'ms-days', text: daysText(m.date, done) }));
    // A koordinátor kézzel is jelölhet; a magától teljesült állomásnál nincs gomb.
    if (store.isCoordinator && m.auto !== 'final' && manual) {
      const btn = el('button', { class: 'btn small', type: 'button', text: done ? 'Visszavonás' : 'Késznek jelölöm' });
      btn.addEventListener('click', async () => { btn.disabled = true; await setMark(store, m.id, !done); btn.disabled = false; });
      li.append(btn);
    }
    li.setAttribute('aria-label', `${m.label}, ${dateFmt.format(dayOf(m.date))}: ${done ? 'kész' : state === 'active' ? 'folyamatban' : 'hátravan'}${r.text ? `, ${r.text}` : ''}`);
    return li;
  });

  const progress = lastDone < 0 ? 0 : (lastDone / (list.length - 1)) * 100;
  // Rétegek: alul az eltelt idő (sraffozott), fölötte a kész mérföldkövek (zöld), legfelül a „ma”.
  const line = el('div', { class: 'ms-line', 'aria-hidden': 'true' },
    el('span', { class: 'ms-line-elapsed', style: `--p:${pos}%` }),
    el('span', { class: 'ms-line-done', style: `--p:${progress}%` }),
    el('span', { class: 'ms-today', style: `--p:${pos}%` },
      el('span', { class: 'ms-today-pill', text: `ma · ${dateFmt.format(today())}` })));
  box.style.setProperty('--n', list.length);
  box.replaceChildren(
    el('p', { class: 'ms-summary' },
      `${list.length} mérföldkőből ${doneCount} kész. `,
      el('span', { class: 'ms-key ms-key-done' }), ' kész mérföldkövek ',
      el('span', { class: 'ms-key ms-key-elapsed' }), ' eltelt idő'),
    el('div', { class: 'ms-track' }, line, el('ol', { class: 'ms-list' }, ...stations)));
}
