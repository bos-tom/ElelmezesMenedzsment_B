// Feladatkiosztás: jelentkezés kidolgozásra és ellenőrzésre (mint a szavazásnál),
// és a koordinátor kiosztása a jelentkezések alapján.
// Adatok: signups/{taskId}__{role}__{uid}, assignments/{taskId} (lásd firestore.rules).
import {
  collection,
  db,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from './firebase.js';
import { avatar, byName, el, notify, userName } from './dom.js';

const ROLES = {
  kidolgozo: { button: 'Kidolgozásra jelentkezem', undo: 'Kidolgozói jelentkezésem visszavonása', label: 'Kidolgozásra jelentkezett' },
  ellenorzo: { button: 'Ellenőrnek jelentkezem', undo: 'Ellenőri jelentkezésem visszavonása', label: 'Ellenőrnek jelentkezett' },
};
const SIZE_LABEL = { kicsi: 'kis feladat', 'közepes': 'közepes feladat', nagy: 'nagy feladat' };

// ---- Adatok ------------------------------------------------------------------

export function subscribeTasks(store, onUpdate) {
  const known = new Set((store.data?.final?.tasks || []).map((t) => t.id));
  const unsubSignups = onSnapshot(collection(db, 'signups'), (snap) => {
    const signups = new Map();
    snap.forEach((d) => {
      const s = d.data();
      if (!known.has(s.taskId) || !ROLES[s.role] || typeof s.uid !== 'string') return;
      if (!signups.has(s.taskId)) signups.set(s.taskId, { kidolgozo: new Set(), ellenorzo: new Set() });
      signups.get(s.taskId)[s.role].add(s.uid);
    });
    store.signups = signups;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a jelentkezéseket.'));

  const unsubAssign = onSnapshot(collection(db, 'assignments'), (snap) => {
    const assignments = new Map();
    snap.forEach((d) => {
      if (!known.has(d.id)) return;
      const a = d.data();
      const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
      assignments.set(d.id, { workers: list(a.workers), reviewers: list(a.reviewers) });
    });
    store.assignments = assignments;
    onUpdate();
  }, () => notify('Nem sikerült betölteni a kiosztást.'));

  return () => { unsubSignups(); unsubAssign(); };
}

async function toggleSignup(store, taskId, role) {
  const uid = store.user.uid;
  const ref = doc(db, 'signups', `${taskId}__${role}__${uid}`);
  const mine = store.signups.get(taskId)?.[role].has(uid);
  try {
    if (mine) await deleteDoc(ref);
    else await setDoc(ref, { taskId, role, uid, createdAt: serverTimestamp() });
  } catch (e) {
    notify(e.code === 'permission-denied' ? 'Nincs jogosultságod jelentkezni.' : 'Nem sikerült menteni a jelentkezést, próbáld újra.');
  }
}

async function saveAssignment(store, taskId, workers, reviewers) {
  try {
    await setDoc(doc(db, 'assignments', taskId), {
      workers, reviewers, updatedBy: store.user.uid, updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    notify(e.code === 'permission-denied' ? 'Csak a koordinátor oszthat ki feladatot.' : 'Nem sikerült menteni a kiosztást, próbáld újra.');
    return false;
  }
}

// A feladat rövid neve a táblázatban és a Dashboardon: „P1”, „P7/a”, vagy a teljes cím.
export const shortName = (t) => (t.title.includes(' · ') ? t.title.split(' · ')[0] : t.title);

// Kinek mi van kiosztva: { work: [feladat], review: [feladat] }.
export function assignedTo(store, uid) {
  const tasks = (store.data?.final?.tasks || []).filter((t) => !t.owner);
  const a = (t) => store.assignments.get(t.id);
  return {
    work: tasks.filter((t) => a(t)?.workers.includes(uid)),
    review: tasks.filter((t) => a(t)?.reviewers.includes(uid)),
  };
}

// ---- Felület -----------------------------------------------------------------

const names = (store, uids) => [...uids].sort(byName(store)).map((u) => userName(store, u));

function chips(store, uids) {
  const me = store.user?.uid;
  return [...uids].sort(byName(store)).map((u) => {
    const p = store.users.get(u);
    return el('li', { class: 'voter' + (u === me ? ' me' : '') },
      avatar(p?.photoURL, 'avatar'),
      el('span', { text: userName(store, u) + (u === me ? ' (te)' : '') }));
  });
}

function taskCard(store, t, titles) {
  const refs = { roles: {} };
  const card = el('li', { class: 'task', id: `feladat-${t.id}` });
  const head = el('div', { class: 'task-head' },
    el('span', { class: 'task-title', text: t.title }),
    el('span', { class: 'task-meta' },
      t.size ? el('span', { class: `task-size size-${t.size === 'közepes' ? 'kozepes' : t.size}`, text: SIZE_LABEL[t.size] || t.size }) : null,
      t.slide && t.slide !== '–' ? el('span', { class: 'task-slide', text: t.slide === 'mind' ? 'minden dia' : `${t.slide} dia` }) : null));
  card.append(head);
  if (t.desc) card.append(el('p', { class: 'task-desc', text: t.desc }));
  if (t.output) card.append(el('p', { class: 'task-output' }, el('b', { text: 'Elkészítendő: ' }), t.output));
  if (t.steps?.length) card.append(el('ol', { class: 'task-steps' }, ...t.steps.map((s) => el('li', { text: s }))));
  if (t.sources?.length) card.append(el('p', { class: 'task-src' }, el('b', { text: 'Kiinduló anyag: ' }), t.sources.join(' · ')));
  if (t.dependsOn?.length) {
    card.append(el('p', { class: 'task-src' }, el('b', { text: 'Előfeltétel: ' }),
      t.dependsOn.map((id) => titles.get(id) || id).join(', ')));
  }

  if (t.owner) {
    card.classList.add('assigned');
    card.append(el('div', { class: 'task-owner' }, 'Felelős: ', el('b', { text: t.owner })));
    return { card, update() {} };
  }

  // Jelentkezés: két szerep, mint a szavazásnál.
  const signupBox = el('div', { class: 'signup' });
  for (const role of Object.keys(ROLES)) {
    const btn = el('button', { class: `pick signup-${role}`, type: 'button' });
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await toggleSignup(store, t.id, role);
      btn.disabled = false;
    });
    const count = el('span', { class: 'vcount' });
    const list = el('ul', { class: 'voters', 'aria-label': `${ROLES[role].label}: ${t.title}` });
    signupBox.append(el('div', { class: 'signup-col' }, el('div', { class: 'votebar' }, btn, count), list));
    refs.roles[role] = { btn, count, list };
  }
  card.append(signupBox);

  // Kiosztás: mindenki látja, a koordinátor módosíthatja.
  const assignLine = el('div', { class: 'task-owner' });
  const assignBtn = el('button', { class: 'btn small', type: 'button', text: 'Kiosztás', hidden: true });
  const panel = el('div', { class: 'assign-panel', hidden: true });
  assignBtn.addEventListener('click', () => { openPanel(); });
  card.append(el('div', { class: 'assign-row' }, assignLine, assignBtn), panel);

  function openPanel() {
    const a = store.assignments.get(t.id) || { workers: [], reviewers: [] };
    const s = store.signups.get(t.id) || { kidolgozo: new Set(), ellenorzo: new Set() };
    const people = [...store.users.keys()].sort(byName(store));
    const group = (role, chosen, signed, legend) => el('fieldset', null, el('legend', { text: legend }),
      ...people.map((u) => el('label', null,
        el('input', { type: 'checkbox', name: `${t.id}-${role}`, value: u, checked: chosen.includes(u) }),
        el('span', { text: userName(store, u) }),
        signed.has(u) ? el('span', { class: 'signed', text: 'jelentkezett' }) : null)));
    const form = el('form', { class: 'confirm' },
      group('workers', a.workers, s.kidolgozo, 'Kidolgozók (több is választható)'),
      group('reviewers', a.reviewers, s.ellenorzo, 'Ellenőrök (több is választható)'));
    const save = el('button', { class: 'btn primary', type: 'submit', text: 'Kiosztás mentése' });
    const cancel = el('button', { class: 'btn', type: 'button', text: 'Mégse' });
    cancel.addEventListener('click', closePanel);
    form.append(el('div', { class: 'actions' }, save, cancel));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pick = (role) => [...form.querySelectorAll(`input[name="${t.id}-${role}"]:checked`)].map((i) => i.value);
      save.disabled = true;
      if (await saveAssignment(store, t.id, pick('workers'), pick('reviewers'))) {
        notify('A kiosztás elmentve.', 'info');
        closePanel();
      } else {
        save.disabled = false;
      }
    });
    panel.replaceChildren(form);
    panel.hidden = false;
    assignBtn.hidden = true;
    form.querySelector('input')?.focus();
  }
  function closePanel() {
    panel.hidden = true;
    panel.replaceChildren();
    update();
  }

  function update() {
    const s = store.signups.get(t.id) || { kidolgozo: new Set(), ellenorzo: new Set() };
    const me = store.user?.uid;
    for (const [role, r] of Object.entries(refs.roles)) {
      const mine = s[role].has(me);
      r.btn.textContent = mine ? ROLES[role].undo : ROLES[role].button;
      r.btn.setAttribute('aria-pressed', String(mine));
      r.btn.classList.toggle('mine', mine);
      r.count.textContent = `${s[role].size} jelentkező`;
      r.list.replaceChildren(...chips(store, s[role]));
    }
    const a = store.assignments.get(t.id);
    const assigned = a && (a.workers.length || a.reviewers.length);
    card.classList.toggle('assigned', !!assigned);
    assignLine.replaceChildren(assigned
      ? el('span', null, `Kiosztva · ${a.workers.length > 1 ? 'kidolgozók' : 'kidolgozó'}: `, el('b', { text: names(store, a.workers).join(', ') || '–' }),
        ` · ${a.reviewers.length > 1 ? 'ellenőrök' : 'ellenőr'}: `, el('b', { text: names(store, a.reviewers).join(', ') || '–' }))
      : 'Még nincs kiosztva');
    assignBtn.hidden = !store.isCoordinator || !panel.hidden;
    assignBtn.textContent = assigned ? 'Kiosztás módosítása' : 'Kiosztás';
  }

  return { card, update };
}

// Személyenkénti összesítés: ki hány feladatra jelentkezett kidolgozónak, illetve ellenőrnek.
function renderMatrix(store, tasks) {
  const count = (fn) => tasks.reduce((n, t) => n + (fn(t) ? 1 : 0), 0);
  const people = [...store.users.keys()].sort(byName(store));
  const rows = people.map((u) => {
    const sig = (role) => count((t) => store.signups.get(t.id)?.[role].has(u));
    const { work, review } = assignedTo(store, u);
    const list = (label, ts) => (ts.length ? el('div', null, `${label}: `, el('b', { text: ts.map(shortName).join(', ') })) : null);
    return el('tr', { class: u === store.user?.uid ? 'me' : null },
      el('th', { scope: 'row', text: userName(store, u) }),
      el('td', { class: 'num', text: String(sig('kidolgozo')) }),
      el('td', { class: 'num', text: String(sig('ellenorzo')) }),
      el('td', { class: 'assigned-cell' },
        work.length || review.length ? [list('kidolgozó', work), list('ellenőr', review)] : el('span', { class: 'muted', text: '–' })));
  });
  document.getElementById('signup-matrix').replaceChildren(
    el('div', { class: 'table-wrap' }, el('table', { class: 'data-table' },
      el('thead', null, el('tr', null,
        el('th', { scope: 'col', text: 'Név' }),
        el('th', { scope: 'col', text: 'Jelentkezés: kidolgozás' }),
        el('th', { scope: 'col', text: 'Jelentkezés: ellenőrzés' }),
        el('th', { scope: 'col', text: 'Kiosztott feladatok' }))),
      el('tbody', null, ...rows))));
}

// A feladatkártyák egyszeri felépítése; a visszaadott update() minden adatváltozáskor fut.
export function mountTasks(store) {
  const tasks = store.data?.final?.tasks || [];
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const cards = [];
  const order = [...new Set(tasks.map((t) => t.group))];
  document.getElementById('task-groups').replaceChildren(...order.map((name) => el('section', { class: 'task-group' },
    el('h3', { class: 'final-group-title', text: name }),
    el('ul', { class: 'task-list' }, ...tasks.filter((t) => t.group === name).map((t) => {
      const c = taskCard(store, t, titles);
      cards.push(c);
      return c.card;
    })))));
  return function update() {
    for (const c of cards) c.update();
    renderMatrix(store, tasks.filter((t) => !t.owner));
  };
}
