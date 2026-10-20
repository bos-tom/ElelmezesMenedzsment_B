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
  if (m.auto === 'start') return { auto: true, pct: 100, text: '' };
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
    // A „Feladatok kidolgozása” fül állapotaiból: a kész feladatok aránya.
    const st = (t) => store.taskStatus?.get(t.id) || 'nincs';
    const done = tasks.filter((t) => st(t) === 'kesz').length;
    const started = tasks.filter((t) => st(t) !== 'nincs').length;
    return {
      auto: tasks.length > 0 && done === tasks.length,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      text: `${tasks.length} feladatból ${done} kész`,
      extra: `${started} feladatra van feltöltött anyag`,
    };
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

// Helyzet az idővonalon (0–100): a dátum aránya az első és az utolsó mérföldkő között.
function timeScale(list) {
  const t0 = dayOf(list[0].date).getTime();
  const t1 = dayOf(list[list.length - 1].date).getTime();
  return (time) => Math.max(0, Math.min(100, ((time - t0) / (t1 - t0)) * 100));
}

// A vonal a doboz szélei előtt ennyi százalékkal kezdődik és végződik (a szélső megállók köre elférjen).
const INSET = 4;
const onLine = (p) => INSET + (p * (100 - 2 * INSET)) / 100;

export function renderMilestones(store) {
  const box = document.getElementById('dash-milestones');
  const list = store.data?.final?.milestones;
  if (!box || !Array.isArray(list) || list.length < 2) return;
  const marks = store.milestoneMarks || new Map();
  const scale = timeScale(list);

  let activeFound = false;
  const items = list.map((m) => {
    const r = measure(store, m);
    // Kész, ha magától teljesült, vagy a koordinátor késznek jelölte.
    const done = r.auto || marks.get(m.id) === true;
    let state = 'pending';
    if (done) state = 'done';
    else if (!activeFound) { state = 'active'; activeFound = true; }
    const late = !done && dayOf(m.date) < today();
    return { m, r, done, state, late, manual: !r.auto, at: scale(dayOf(m.date).getTime()) };
  });
  const doneCount = items.filter((x) => x.done).length;
  const lastDone = items.reduce((k, x, i) => (x.done ? i : k), -1);
  const pos = scale(today().getTime());
  const n = list.length;

  // 1. Az idővonal: a megállók a kiszabott idő arányában, alul az eltelt idő, fölötte a kész szakasz.
  const dots = items.map(({ r, state, at }) => el('div', {
    class: `ms-stop ms-${state}`, style: `--x:${onLine(at)}%`,
  },
    state === 'active' && r.pct != null ? el('div', { class: 'ms-pct', text: `${r.pct}%` }) : null,
    stationDot(state, r.pct)));
  const axis = el('div', { class: 'ms-axis', 'aria-hidden': 'true' },
    el('div', { class: 'ms-line' },
      el('span', { class: 'ms-line-elapsed', style: `--p:${pos}%` }),
      el('span', { class: 'ms-line-done', style: `--p:${lastDone < 0 ? 0 : items[lastDone].at}%` })),
    el('span', { class: 'ms-today', style: `--x:${onLine(pos)}%;--p:${pos}%` },
      el('span', { class: 'ms-today-pill', text: `ma · ${dateFmt.format(today())}` })),
    ...dots);

  // 2. Vezetővonalak a megállóktól az egyenlő közű kártyákig.
  const SVG = 'http://www.w3.org/2000/svg';
  const leaders = document.createElementNS(SVG, 'svg');
  leaders.setAttribute('class', 'ms-leaders');
  leaders.setAttribute('viewBox', '0 0 100 30');
  leaders.setAttribute('preserveAspectRatio', 'none');
  leaders.setAttribute('aria-hidden', 'true');
  items.forEach(({ state, at }, i) => {
    const x0 = onLine(at);
    const x1 = ((i + 0.5) / n) * 100;
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', `M${x0} 0 C${x0} 15 ${x1} 15 ${x1} 30`);
    p.setAttribute('class', `ms-leader ms-${state}`);
    p.setAttribute('vector-effect', 'non-scaling-stroke');
    leaders.append(p);
  });

  // 3. A kártyák a részletekkel.
  const cards = items.map(({ m, r, done, state, late, manual }, i) => {
    // A szakaszra kiszabott idő: napok az előző megállótól.
    const span = i > 0 ? Math.round((dayOf(m.date) - dayOf(list[i - 1].date)) / DAY) : 0;
    const li = el('li', { class: `ms ms-${state}${late ? ' late' : ''}` },
      el('div', { class: 'ms-date', text: dateFmt.format(dayOf(m.date)) }),
      el('div', { class: 'ms-label', text: m.label }),
      m.sub ? el('div', { class: 'ms-sub', text: m.sub }) : null,
      span ? el('div', { class: 'ms-span', text: `${span} nap` }) : null,
      state === 'active' && r.pct != null ? el('div', { class: 'ms-pct-inline', text: `${r.pct}% kész` }) : null,
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

  box.style.setProperty('--n', n);
  box.replaceChildren(
    el('div', { class: 'ms-summary' },
      el('p', { class: 'ms-count' }, el('b', { text: `${doneCount} / ${n}` }), ' mérföldkő kész'),
      el('p', { class: 'ms-legend' },
        el('span', null, el('span', { class: 'ms-key ms-key-done' }), 'kész mérföldkövek'),
        el('span', null, el('span', { class: 'ms-key ms-key-elapsed' }), 'eltelt idő'))),
    axis, leaders, el('ol', { class: 'ms-list' }, ...cards));
}
