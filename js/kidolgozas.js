// Feladatok kidolgozása: a közös Drive-mappa linkjei, a feltöltött anyagok és a feladatok állapota.
// Állapot: nincs → feltöltve (kidolgozó) → ellenőrizve (ellenőr) → kész (koordinátor).
// Adatok: submissions/{id}, taskStatus/{taskId} (lásd firestore.rules), data/kidolgozas.json.
import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from './firebase.js';
import { byName, el, formatTime, notify, userName } from './dom.js';

export const STATES = [
  { id: 'nincs', label: 'Nincs még anyag' },
  { id: 'feltoltve', label: 'Feltöltve' },
  { id: 'ellenorizve', label: 'Ellenőrizve' },
  { id: 'kesz', label: 'Kész' },
];
const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\//;

export const stateOf = (store, taskId) => store.taskStatus.get(taskId) || 'nincs';

// ---- Adatok ------------------------------------------------------------------

export function subscribeWork(store, onUpdate) {
  const known = new Set((store.data?.final?.tasks || []).map((t) => t.id));
  const unsubSub = onSnapshot(collection(db, 'submissions'), (snap) => {
    const subs = new Map();
    snap.forEach((d) => {
      const s = d.data();
      if (!known.has(s.taskId) || typeof s.url !== 'string' || !DRIVE_RE.test(s.url)) return;
      if (!subs.has(s.taskId)) subs.set(s.taskId, []);
      subs.get(s.taskId).push({ id: d.id, uid: s.uid, title: String(s.title || ''), url: s.url, createdAt: s.createdAt?.toDate?.() || null });
    });
    for (const list of subs.values()) list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    store.submissions = subs;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a feltöltött anyagokat.'));

  const unsubSt = onSnapshot(collection(db, 'taskStatus'), (snap) => {
    const st = new Map();
    snap.forEach((d) => {
      const s = d.data().state;
      if (known.has(d.id) && STATES.some((x) => x.id === s)) st.set(d.id, s);
    });
    store.taskStatus = st;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a feladatok állapotát.'));

  return () => { unsubSub(); unsubSt(); };
}

async function setState(store, taskId, state) {
  try {
    await setDoc(doc(db, 'taskStatus', taskId), { state, updatedBy: store.user.uid, updatedAt: serverTimestamp() });
    return true;
  } catch (e) {
    notify(e.code === 'permission-denied' ? 'Ehhez az állapothoz nincs jogosultságod.' : 'Nem sikerült menteni az állapotot.');
    return false;
  }
}

// ---- Felület -----------------------------------------------------------------

function linkBtn(url, text) {
  if (!url) return el('span', { class: 'drive-missing', text: `${text}: a mappa még nincs létrehozva` });
  return el('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener', text });
}

function stepper(state) {
  const idx = STATES.findIndex((s) => s.id === state);
  return el('ol', { class: 'stepper', 'aria-label': `Állapot: ${STATES[idx].label}` },
    ...STATES.map((s, i) => el('li', { class: i < idx ? 'done' : i === idx ? 'current' : null, text: s.label })));
}

function workCard(store, t, drive) {
  const card = el('li', { class: 'work', id: `kidolgozas-${t.id}` });
  const folders = drive?.folders?.[t.id] || {};
  const people = el('div', { class: 'work-people' });
  const stepBox = el('div');
  const subsBox = el('ul', { class: 'subs' });
  const actions = el('div', { class: 'work-actions' });

  // „Feltöltöttem” űrlap: a kidolgozó (vagy a koordinátor) jegyzi be a Drive-ba feltöltött fájlt.
  const titleIn = el('input', { type: 'text', maxlength: '120', placeholder: 'Mi ez? pl. Alaprajz, 1. változat', 'aria-label': 'Az anyag címe' });
  const urlIn = el('input', { type: 'url', maxlength: '500', placeholder: 'A fájl Drive-linkje (https://drive.google.com/…)', 'aria-label': 'Az anyag Drive-linkje' });
  const send = el('button', { class: 'btn primary small', type: 'submit', text: 'Feltöltöttem' });
  const form = el('form', { class: 'sub-form', hidden: true },
    el('p', { class: 'note', text: 'Töltsd fel a fájlt a feladat Drive-mappájába, majd másold ide a linkjét (a fájlon jobb klikk → Megosztás → Link másolása).' }),
    titleIn, urlIn, send);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleIn.value.trim();
    const url = urlIn.value.trim();
    if (!title) { notify('Adj címet az anyagnak.'); return; }
    if (!DRIVE_RE.test(url)) { notify('Csak Google Drive- vagy Google Docs-link adható meg.'); return; }
    send.disabled = true;
    try {
      await addDoc(collection(db, 'submissions'), { taskId: t.id, uid: store.user.uid, title, url, createdAt: serverTimestamp() });
      if (stateOf(store, t.id) === 'nincs') await setState(store, t.id, 'feltoltve');
      titleIn.value = '';
      urlIn.value = '';
      notify('Az anyag bejegyezve.', 'info');
    } catch (err) {
      notify(err.code === 'permission-denied' ? 'Anyagot csak a feladat kidolgozója jegyezhet be.' : 'Nem sikerült menteni, próbáld újra.');
    }
    send.disabled = false;
  });

  card.append(
    el('div', { class: 'task-head' },
      el('span', { class: 'task-title', text: t.title }),
      t.slide && t.slide !== '–' ? el('span', { class: 'task-slide', text: t.slide === 'mind' ? 'minden dia' : `${t.slide} dia` }) : null),
    people,
    el('div', { class: 'work-folders' }, linkBtn(folders.munka, 'Munka mappa'), linkBtn(folders.vegleges, 'Végleges mappa')),
    stepBox, subsBox, form, actions);

  function update() {
    const uid = store.user?.uid;
    const a = store.assignments.get(t.id) || { workers: [], reviewers: [] };
    const isWorker = a.workers.includes(uid);
    const isReviewer = a.reviewers.includes(uid);
    const state = stateOf(store, t.id);
    const names = (l) => l.slice().sort(byName(store)).map((u) => userName(store, u)).join(', ') || '–';
    people.replaceChildren(
      el('span', null, 'Kidolgozó: ', el('b', { text: names(a.workers) })),
      el('span', null, 'Ellenőr: ', el('b', { text: names(a.reviewers) })));
    card.className = `work state-${state}${isWorker || isReviewer ? ' mine' : ''}`;
    stepBox.replaceChildren(stepper(state));

    const subs = store.submissions.get(t.id) || [];
    subsBox.replaceChildren(...(subs.length ? subs.map((s) => {
      const li = el('li', null,
        el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title }),
        el('span', { class: 'muted', text: ` · ${userName(store, s.uid)}${s.createdAt ? `, ${formatTime(s.createdAt)}` : ''}` }));
      if (s.uid === uid) {
        const del = el('button', { class: 'btn link', type: 'button', text: 'törlés', 'aria-label': `${s.title} törlése` });
        del.addEventListener('click', async () => {
          try { await deleteDoc(doc(db, 'submissions', s.id)); } catch { notify('Nem sikerült törölni.'); }
        });
        li.append(' ', del);
      }
      return li;
    }) : [el('li', { class: 'muted', text: 'Még nincs bejegyzett anyag.' })]));

    form.hidden = !(isWorker || store.isCoordinator);

    // Az állapotváltó gombok, szerepkör szerint.
    const btn = (text, next, cls = 'btn small') => {
      const b = el('button', { class: cls, type: 'button', text });
      b.addEventListener('click', async () => { b.disabled = true; await setState(store, t.id, next); b.disabled = false; });
      return b;
    };
    const list = [];
    // A koordinátornak az összes állapot elérhető, neki nem kellenek a szerepkör szerinti gombok.
    if (!store.isCoordinator && isReviewer && state === 'feltoltve') list.push(btn('Ellenőriztem', 'ellenorizve', 'btn small primary'));
    if (!store.isCoordinator && isWorker && state === 'feltoltve') list.push(btn('Vissza: nincs még anyag', 'nincs'));
    if (store.isCoordinator) {
      for (const s of STATES) if (s.id !== state) list.push(btn(s.id === 'kesz' ? 'Késznek jelölöm' : `Állapot: ${s.label.toLowerCase()}`, s.id, s.id === 'kesz' ? 'btn small primary' : 'btn small'));
    }
    actions.replaceChildren(...list);
  }
  return { card, update };
}

// A nézet egyszeri felépítése; a visszaadott update() minden adatváltozáskor fut.
export function mountWork(store) {
  const drive = store.data?.drive || {};
  const tasks = (store.data?.final?.tasks || []).filter((t) => !t.owner);

  document.getElementById('work-sources').replaceChildren(
    ...(drive.kiindulo || []).map((k) => el('li', { class: 'source' },
      k.url ? el('a', { href: k.url, target: '_blank', rel: 'noopener', text: k.title }) : el('b', { text: k.title }),
      el('span', { class: 'muted', text: ` – ${k.desc}` }),
      k.url ? null : el('span', { class: 'drive-missing', text: ' (a mappa még nincs létrehozva)' }))));
  document.getElementById('work-root').replaceChildren(
    linkBtn(drive.root, 'A közös mappa megnyitása'),
    linkBtn(drive.prezentacio?.munka, 'Prezentáció – munka'),
    linkBtn(drive.prezentacio?.vegleges, 'Prezentáció – végleges'));

  const cards = tasks.map((t) => workCard(store, t, drive));
  const order = [...new Set(tasks.map((t) => t.group))];
  document.getElementById('work-groups').replaceChildren(...order.map((name) => el('section', { class: 'task-group' },
    el('h3', { class: 'final-group-title', text: name }),
    el('ul', { class: 'work-list' }, ...cards.filter((c, i) => tasks[i].group === name).map((c) => c.card)))));

  const summary = document.getElementById('work-summary');
  return function update() {
    for (const c of cards) c.update();
    const count = (s) => tasks.filter((t) => stateOf(store, t.id) === s).length;
    summary.replaceChildren(...STATES.map((s) => el('span', { class: `work-count state-${s.id}` },
      el('b', { text: String(count(s.id)) }), ` ${s.label.toLowerCase()}`)));
  };
}
