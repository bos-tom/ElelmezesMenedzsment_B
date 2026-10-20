// Feladatok kidolgozása: a közös Drive-mappa linkjei, a feltöltött verziók és a feladatok állapota.
// Állapot: nincs → folyamatban → leadva (ellenőrzésre) ⇄ javítás kell → ellenőrizve → kész.
// A készültség súlyozott (WEIGHT); a ki nem osztott feladat is beleszámít a projekt egészébe.
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

export const STATES = {
  nincs: { label: 'Nincs még anyag', weight: 0 },
  folyamatban: { label: 'Folyamatban', weight: 25 },
  leadva: { label: 'Ellenőrzésre leadva', weight: 50 },
  javitas: { label: 'Javítás kell', weight: 50 },
  ellenorizve: { label: 'Ellenőrizve', weight: 75 },
  kesz: { label: 'Kész', weight: 100 },
};
// Az állapotsáv lépései; a „javítás kell” a leadás lépésén jelenik meg (visszadobás).
const STEPS = ['nincs', 'folyamatban', 'leadva', 'ellenorizve', 'kesz'];
const DRIVE_RE = /^https:\/\/(drive|docs)\.google\.com\//;

export const statusOf = (store, taskId) => store.taskStatus.get(taskId) || { state: 'nincs', note: '' };
export const stateOf = (store, taskId) => statusOf(store, taskId).state;
export const weightOf = (store, taskId) => STATES[stateOf(store, taskId)].weight;

// Súlyozott készültség (0–100) a megadott feladatokra.
export function progressPct(store, tasks) {
  if (!tasks.length) return 0;
  return Math.round(tasks.reduce((n, t) => n + weightOf(store, t.id), 0) / tasks.length);
}

// A feladat legutóbbi verziószáma (v1, v2, …).
export const versionsOf = (store, taskId) => (store.submissions.get(taskId) || []).length;

// ---- Adatok ------------------------------------------------------------------

export function subscribeWork(store, onUpdate) {
  const known = new Set((store.data?.final?.tasks || []).map((t) => t.id));
  const unsubSub = onSnapshot(collection(db, 'submissions'), (snap) => {
    const subs = new Map();
    snap.forEach((d) => {
      const s = d.data();
      if (!known.has(s.taskId) || typeof s.url !== 'string' || !DRIVE_RE.test(s.url)) return;
      if (!subs.has(s.taskId)) subs.set(s.taskId, []);
      subs.get(s.taskId).push({ id: d.id, uid: s.uid, title: String(s.title || ''), url: s.url, createdAt: s.createdAt?.toDate?.() || new Date() });
    });
    // Időrendben: a legrégebbi a v1.
    for (const list of subs.values()) list.sort((a, b) => a.createdAt - b.createdAt);
    store.submissions = subs;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a feltöltött anyagokat.'));

  const unsubSt = onSnapshot(collection(db, 'taskStatus'), (snap) => {
    const st = new Map();
    snap.forEach((d) => {
      const s = d.data();
      if (known.has(d.id) && STATES[s.state]) st.set(d.id, { state: s.state, note: typeof s.note === 'string' ? s.note : '' });
    });
    store.taskStatus = st;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a feladatok állapotát.'));

  return () => { unsubSub(); unsubSt(); };
}

async function setState(store, taskId, state, note = '') {
  const data = { state, updatedBy: store.user.uid, updatedAt: serverTimestamp() };
  if (note) data.note = note.slice(0, 500);
  try {
    await setDoc(doc(db, 'taskStatus', taskId), data);
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
  const pos = STEPS.indexOf(state === 'javitas' ? 'leadva' : state);
  return el('ol', { class: 'stepper', 'aria-label': `Állapot: ${STATES[state].label}` },
    ...STEPS.map((s, i) => el('li', {
      class: i < pos ? 'done' : i === pos ? (state === 'javitas' ? 'current fix' : 'current') : null,
      text: i === pos && state === 'javitas' ? STATES.javitas.label : STATES[s].label,
    })));
}

function workCard(store, t, drive) {
  const card = el('li', { class: 'work', id: `kidolgozas-${t.id}` });
  const folders = drive?.folders?.[t.id] || {};
  const people = el('div', { class: 'work-people' });
  const stepBox = el('div');
  const noteBox = el('p', { class: 'work-note', hidden: true });
  const subsBox = el('ol', { class: 'subs' });
  const actions = el('div', { class: 'work-actions' });

  // Új verzió bejegyzése: a kidolgozó (vagy a koordinátor) a Drive-ba feltöltött fájl címét és linkjét adja meg.
  const titleIn = el('input', { type: 'text', maxlength: '120', placeholder: 'Mi ez? pl. Alaprajz, javított', 'aria-label': 'Az anyag címe' });
  const urlIn = el('input', { type: 'url', maxlength: '500', placeholder: 'A fájl Drive-linkje (https://drive.google.com/…)', 'aria-label': 'Az anyag Drive-linkje' });
  const send = el('button', { class: 'btn primary small', type: 'submit', text: 'Feltöltöttem (új verzió)' });
  const form = el('form', { class: 'sub-form', hidden: true },
    el('p', { class: 'note', text: 'Töltsd fel a fájlt a feladat „munka” mappájába (a kész változatot a „végleges” mappába), majd másold ide a linkjét: a fájlon jobb klikk → Megosztás → Link másolása. Minden bejegyzés új verzió.' }),
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
      // Új verzió: ha még nem indult el, vagy javítás után jött, „folyamatban” (a megjegyzés megmarad).
      const cur = statusOf(store, t.id);
      if (cur.state === 'nincs' || cur.state === 'javitas') await setState(store, t.id, 'folyamatban', cur.note);
      titleIn.value = '';
      urlIn.value = '';
      notify('Az új verzió bejegyezve.', 'info');
    } catch (err) {
      notify(err.code === 'permission-denied' ? 'Anyagot csak a feladat kidolgozója jegyezhet be.' : 'Nem sikerült menteni, próbáld újra.');
    }
    send.disabled = false;
  });

  // „Javítás kell” megjegyzés az ellenőrtől.
  const fixIn = el('textarea', { rows: '2', maxlength: '500', placeholder: 'Mit kell javítani? (rövid megjegyzés a kidolgozónak)', 'aria-label': 'Mit kell javítani' });
  const fixSend = el('button', { class: 'btn small danger', type: 'submit', text: 'Visszaküldöm javításra' });
  const fixForm = el('form', { class: 'sub-form', hidden: true }, fixIn, fixSend);
  fixForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const note = fixIn.value.trim();
    if (!note) { notify('Írd le röviden, mit kell javítani.'); return; }
    fixSend.disabled = true;
    if (await setState(store, t.id, 'javitas', note)) { fixIn.value = ''; fixForm.hidden = true; }
    fixSend.disabled = false;
  });

  card.append(
    el('div', { class: 'task-head' },
      el('span', { class: 'task-title', text: t.title }),
      t.slide && t.slide !== '–' ? el('span', { class: 'task-slide', text: t.slide === 'mind' ? 'minden dia' : `${t.slide} dia` }) : null),
    people,
    el('div', { class: 'work-folders' }, linkBtn(folders.munka, 'Munka mappa'), linkBtn(folders.vegleges, 'Végleges mappa')),
    stepBox, noteBox, subsBox, form, actions, fixForm);

  function update() {
    const uid = store.user?.uid;
    const a = store.assignments.get(t.id) || { workers: [], reviewers: [] };
    const isWorker = a.workers.includes(uid);
    const isReviewer = a.reviewers.includes(uid);
    const coord = store.isCoordinator;
    const { state, note } = statusOf(store, t.id);
    const subs = store.submissions.get(t.id) || [];
    const names = (l) => l.slice().sort(byName(store)).map((u) => userName(store, u)).join(', ') || 'még nincs kiosztva';
    people.replaceChildren(
      el('span', null, 'Kidolgozó: ', el('b', { text: names(a.workers) })),
      el('span', null, 'Ellenőr: ', el('b', { text: names(a.reviewers) })));
    card.className = `work state-${state}${isWorker || isReviewer ? ' mine' : ''}`;
    stepBox.replaceChildren(stepper(state));
    noteBox.hidden = !(note && ['javitas', 'folyamatban', 'leadva'].includes(state));
    noteBox.replaceChildren(el('b', { text: 'Az ellenőr megjegyzése: ' }), note);

    subsBox.replaceChildren(...(subs.length ? subs.map((s, i) => {
      const li = el('li', null,
        el('span', { class: 'ver', text: `v${i + 1}` }), ' ',
        el('a', { href: s.url, target: '_blank', rel: 'noopener', text: s.title }),
        el('span', { class: 'muted', text: ` · ${userName(store, s.uid)}, ${formatTime(s.createdAt)}` }));
      if (s.uid === uid) {
        const del = el('button', { class: 'btn link', type: 'button', text: 'törlés', 'aria-label': `${s.title} törlése` });
        del.addEventListener('click', async () => {
          try { await deleteDoc(doc(db, 'submissions', s.id)); } catch { notify('Nem sikerült törölni.'); }
        });
        li.append(' ', del);
      }
      return li;
    }) : [el('li', { class: 'muted none', text: 'Még nincs bejegyzett verzió.' })]));

    form.hidden = !((isWorker || coord) && state !== 'kesz');

    // Gombok szerepkör és állapot szerint.
    const btn = (text, next, cls = 'btn small', keepNote = false) => {
      const b = el('button', { class: cls, type: 'button', text });
      b.addEventListener('click', async () => { b.disabled = true; await setState(store, t.id, next, keepNote ? note : ''); b.disabled = false; });
      return b;
    };
    const list = [];
    if (isWorker || coord) {
      if (state === 'nincs') list.push(btn('Elkezdtem', 'folyamatban'));
      if ((state === 'folyamatban' || state === 'javitas') && subs.length) list.push(btn('Ellenőrzésre leadom', 'leadva', 'btn small primary', true));
      if (state === 'leadva') list.push(btn('Leadás visszavonása', 'folyamatban', 'btn small', true));
    }
    if (isReviewer || coord) {
      if (state === 'leadva') {
        list.push(btn('Ellenőriztem, rendben', 'ellenorizve', 'btn small primary'));
        const fix = el('button', { class: 'btn small danger', type: 'button', text: 'Javítás kell' });
        fix.addEventListener('click', () => { fixForm.hidden = false; fixIn.focus(); });
        list.push(fix);
      }
    }
    if (coord) {
      if (state === 'ellenorizve') list.push(btn('Késznek jelölöm (végleges)', 'kesz', 'btn small primary'));
      // Bármelyik állapot kézzel is beállítható (pl. tévedés javítására).
      const sel = el('select', { 'aria-label': 'Állapot kézi beállítása' },
        ...Object.entries(STATES).map(([id, s]) => el('option', { value: id, selected: id === state, text: s.label })));
      sel.addEventListener('change', async () => { sel.disabled = true; await setState(store, t.id, sel.value); sel.disabled = false; });
      list.push(el('label', { class: 'state-select' }, 'Állapot: ', sel));
    }
    if (state !== 'leadva') fixForm.hidden = true;
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
    summary.replaceChildren(
      el('span', { class: 'work-total' }, 'A projekt készültsége: ', el('b', { text: `${progressPct(store, tasks)}%` })),
      ...Object.entries(STATES).map(([id, s]) => el('span', { class: `work-count state-${id}` },
        el('b', { text: String(count(id)) }), ` ${s.label.toLowerCase()}`)));
  };
}
