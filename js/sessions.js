// Belépési napló: minden belépés egy sessions dokumentum (kezdet, utolsó aktivitás, kilépés).
// Az aktivitást percenként frissítjük, de csak amíg az oldal látható.
// A naplót (napló oldal) csak a config/app.logViewers-ben szereplő admin olvashatja.
import {
  addDoc,
  collection,
  db,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from './firebase.js';
import { el, notify, userName } from './dom.js';

const HEARTBEAT_MS = 60_000;
// Ennyi ideig számít valaki „bent lévőnek” az utolsó aktivitás után.
const ONLINE_WINDOW_MS = 2.5 * 60_000;
const STORAGE_KEY = 'dontesek-session';

let sessionRef = null;
let timer = null;

async function beat(extra = {}) {
  if (!sessionRef) return;
  try {
    await updateDoc(sessionRef, { lastSeenAt: serverTimestamp(), ...extra });
  } catch {
    // A napló nem akadályozhatja a munkát; hiba esetén csendben kihagyjuk.
  }
}

function onVisibility() {
  if (!document.hidden) beat();
}

function onPageHide() {
  // Utolsó aktivitás rögzítése a lap bezárásakor (a kilépést csak a Kilépés gomb jelöli).
  beat();
}

// Munkamenet indítása belépéskor. Ugyanabban a böngészőfülben újratöltés után
// a meglévő munkamenet folytatódik, nem keletkezik új sor.
export async function startSession(uid) {
  stopTimers();
  sessionRef = null;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); } catch { /* nincs tároló */ }
  if (saved && saved.uid === uid && typeof saved.id === 'string') {
    try {
      const ref = doc(db, 'sessions', saved.id);
      await updateDoc(ref, { lastSeenAt: serverTimestamp() });
      sessionRef = ref;
    } catch {
      sessionRef = null; // lezárt vagy nem létező munkamenet: újat kezdünk
    }
  }
  if (!sessionRef) {
    try {
      sessionRef = await addDoc(collection(db, 'sessions'), {
        uid,
        startedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
        endedAt: null,
      });
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ uid, id: sessionRef.id })); } catch { /* nincs tároló */ }
    } catch {
      sessionRef = null;
      return;
    }
  }
  timer = setInterval(() => { if (!document.hidden) beat(); }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
}

function stopTimers() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
}

// Kilépéskor: a munkamenet lezárása, mielőtt a belépés megszűnik.
export async function endSession() {
  stopTimers();
  if (sessionRef) {
    const ref = sessionRef;
    sessionRef = null;
    try {
      await updateDoc(ref, { lastSeenAt: serverTimestamp(), endedAt: serverTimestamp() });
    } catch { /* lásd beat() */ }
  }
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* nincs tároló */ }
}

// ---- Napló oldal ------------------------------------------------------------

const dtFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmt = (d) => (d ? dtFmt.format(d) : '–');

function fmtDuration(ms) {
  if (!ms || ms < 0) return '< 1 perc';
  const min = Math.round(ms / 60_000);
  if (min < 1) return '< 1 perc';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} óra ${m} perc` : `${m} perc`;
}

function stateOf(s, now) {
  if (s.endedAt) return { text: 'Kilépett', cls: 'off' };
  if (s.lastSeenAt && now - s.lastSeenAt.getTime() < ONLINE_WINDOW_MS) return { text: 'Bent van', cls: 'on' };
  return { text: 'Elhagyta az oldalt', cls: 'off' };
}

export function subscribeLog(store, onUpdate) {
  const q = query(collection(db, 'sessions'), orderBy('startedAt', 'desc'), limit(500));
  return onSnapshot(q, (snap) => {
    store.sessions = snap.docs.map((d) => {
      const s = d.data({ serverTimestamps: 'estimate' });
      const t = (v) => (v?.toDate ? v.toDate() : null);
      return { id: d.id, uid: s.uid, startedAt: t(s.startedAt), lastSeenAt: t(s.lastSeenAt), endedAt: t(s.endedAt) };
    }).filter((s) => typeof s.uid === 'string' && s.startedAt);
    onUpdate();
  }, () => notify('Nem sikerült betölteni a naplót.'));
}

export function renderLog(store) {
  const now = Date.now();
  const sessions = store.sessions || [];
  const duration = (s) => (s.endedAt || s.lastSeenAt || s.startedAt) - s.startedAt;

  // Személyenkénti összesítés.
  const byUser = new Map();
  for (const s of sessions) {
    const p = byUser.get(s.uid) || { count: 0, total: 0, last: null, online: false };
    p.count++;
    p.total += duration(s);
    const seen = s.endedAt || s.lastSeenAt || s.startedAt;
    if (!p.last || seen > p.last) p.last = seen;
    if (stateOf(s, now).cls === 'on') p.online = true;
    byUser.set(s.uid, p);
  }
  const people = [...byUser.entries()].sort((a, b) => b[1].last - a[1].last);
  document.getElementById('naplo-people').replaceChildren(...(people.length ? people.map(([uid, p]) => el('tr', null,
    el('th', { scope: 'row', text: userName(store, uid) }),
    el('td', { class: 'num', text: String(p.count) }),
    el('td', { text: fmtDuration(p.total) }),
    el('td', { text: fmt(p.last) }),
    el('td', null, el('span', { class: `presence ${p.online ? 'on' : 'off'}`, text: p.online ? 'Bent van' : 'Nincs bent' })),
  )) : [el('tr', null, el('td', { colspan: '5', class: 'muted', text: 'Még nincs bejegyzés.' }))]));

  document.getElementById('naplo-sessions').replaceChildren(...(sessions.length ? sessions.map((s) => {
    const st = stateOf(s, now);
    return el('tr', null,
      el('th', { scope: 'row', text: userName(store, s.uid) }),
      el('td', { text: fmt(s.startedAt) }),
      el('td', { text: fmt(s.lastSeenAt) }),
      el('td', null, s.endedAt ? fmt(s.endedAt) : el('span', { class: `presence ${st.cls}`, text: st.text })),
      el('td', { text: fmtDuration(duration(s)) }));
  }) : [el('tr', null, el('td', { colspan: '5', class: 'muted', text: 'Még nincs bejegyzés.' }))]));

  document.getElementById('naplo-note').textContent =
    `A bent töltött idő a belépéstől az utolsó aktivitásig (vagy a kilépésig) tart; az aktivitás percenként frissül, amíg az oldal látható. ` +
    `Ha valaki a Kilépés gomb nélkül zárja be az oldalt, „Elhagyta az oldalt” állapotú lesz. Legfeljebb az utolsó 500 belépés látszik.`;
}
