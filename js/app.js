// Belépés, adatbetöltés, renderelés.
import {
  CONFIG_MISSING,
  GoogleAuthProvider,
  USE_EMULATOR,
  auth,
  collection,
  db,
  doc,
  getDoc,
  getRedirectResult,
  onAuthStateChanged,
  onSnapshot,
  serverTimestamp,
  setDoc,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from './firebase.js';
import { avatar, el, notify } from './dom.js';
import { isClosed, mountDecisionVoting, subscribeVotes, tally } from './votes.js';
import { createChatBox, subscribeMessages } from './chat.js';

const ID_RE = /^[a-z0-9_]{1,40}$/;

const store = {
  user: null,
  isAdmin: false,
  nickname: null,
  colorIndex: null,
  data: null,
  users: new Map(),
  votes: new Map(),
  status: new Map(),
  messages: [],
};

let built = false;
let unsubs = [];
const decisionUpdaters = [];
const threadBoxes = [];
let mainChat = null;
const summaryCells = new Map();
const tocMarks = new Map();

// ---- Képernyők -------------------------------------------------------------

const SCREENS = ['loading', 'login', 'denied', 'error', 'app'];
function show(name) {
  for (const s of SCREENS) document.getElementById(`screen-${s}`).hidden = s !== name;
}
function showError(text) {
  document.getElementById('error-text').textContent = text;
  show('error');
}

function renderUserbox() {
  const box = document.getElementById('userbox');
  const u = store.user;
  if (!u) {
    box.replaceChildren(el('button', { class: 'btn primary', type: 'button', 'data-action': 'login', text: 'Belépés Google-fiókkal' }));
    return;
  }
  box.replaceChildren(
    avatar(u.photoURL),
    el('span', { class: 'name', text: displayNameOf(u) }),
    el('button', { class: 'btn small', type: 'button', 'data-action': 'logout', text: 'Kilépés' }),
  );
}

// ---- Belépés ---------------------------------------------------------------

function authErrorMessage(e) {
  switch (e?.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/user-cancelled':
      return null;
    case 'auth/unauthorized-domain':
      return 'Ez a webcím nincs engedélyezve a belépéshez (Firebase → Authentication → Settings → Authorized domains).';
    case 'auth/network-request-failed':
      return 'Nincs internetkapcsolat, vagy a Google nem érhető el. Próbáld újra.';
    default:
      return 'Nem sikerült a belépés, próbáld újra.';
  }
}

// Helyi próbánál: fut-e még az Auth Emulator? (Különben a böngésző hibaoldala jönne fel.)
async function emulatorReachable() {
  try {
    await fetch('http://127.0.0.1:9099/', { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function login() {
  if (USE_EMULATOR && !(await emulatorReachable())) {
    notify('A helyi próbakörnyezet nem fut. Indítsd el az asztali „Döntési oldal (próba)” parancsikonnal, majd töltsd újra ezt az oldalt.');
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // Mobilon vagy letiltott felugró ablaknál átirányításos belépés.
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
      try {
        await signInWithRedirect(auth, provider);
      } catch (e2) {
        const msg = authErrorMessage(e2);
        if (msg) notify(msg);
      }
      return;
    }
    const msg = authErrorMessage(e);
    if (msg) notify(msg);
  }
}

document.addEventListener('click', (e) => {
  // A csevegő döntéscímkéje a döntéshez ugrik, és kinyitja annak hozzászólás-ablakát.
  const tag = e.target.closest('a.dtag');
  if (tag) {
    const thread = document.querySelector(`${tag.getAttribute('href')} details.thread`);
    if (thread) thread.open = true;
    return;
  }
  const t = e.target.closest('[data-action]');
  if (!t) return;
  const action = t.dataset.action;
  if (action === 'login') login();
  else if (action === 'logout') signOut(auth).catch(() => notify('Nem sikerült kilépni, próbáld újra.'));
  else if (action === 'reload') location.reload();
});

// ---- Adatok ----------------------------------------------------------------

async function loadData() {
  const res = await fetch('data/dontesek.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.json();
  const decisions = [];
  const byId = new Map();
  for (const g of raw.groups) {
    for (const d of g.decisions) {
      if (!ID_RE.test(d.id)) continue;
      const options = d.options.filter((o) => ID_RE.test(o.id));
      const dec = { ...d, options, group: g, num: decisions.length + 1, optionsById: new Map(options.map((o) => [o.id, o])) };
      decisions.push(dec);
      byId.set(d.id, dec);
    }
  }
  return { raw, decisions, byId };
}

// ---- Statikus oldal --------------------------------------------------------

function srcChip(code, loc) {
  const ai = code === 'MI';
  const label = ai ? 'MI' : code + (loc ? ` ${loc}` : '');
  return el('span', { class: 'src' + (ai ? ' ai' : ''), title: store.data.raw.sources[code] || code, text: label });
}

function argList(items, kind) {
  if (!items || !items.length) return null;
  const ul = el('ul', { class: `args ${kind}`, 'aria-label': kind === 'pro' ? 'Mellette' : 'Ellene' });
  for (const [t, code, loc] of items) {
    ul.append(el('li', null,
      el('span', { class: 'sign', 'aria-hidden': 'true', text: kind === 'pro' ? '+' : '−' }),
      el('span', null, t, srcChip(code, loc))));
  }
  return ul;
}

// Opcióhoz tartozó táblázat (pl. létszámterv): { caption, cols[], rows[][], lastRowTotal }.
function optTable(t) {
  if (!t || !Array.isArray(t.cols) || !Array.isArray(t.rows)) return null;
  const table = el('table', { class: 'opt-table' },
    t.caption ? el('caption', { text: t.caption }) : null,
    el('thead', null, el('tr', null, ...t.cols.map((c) => el('th', { scope: 'col', text: String(c) })))),
    el('tbody', null, ...t.rows.map((r, i) => el('tr', { class: t.lastRowTotal && i === t.rows.length - 1 ? 'total' : null },
      ...r.map((c, j) => (j === 0 ? el('th', { scope: 'row', text: String(c) }) : el('td', { text: String(c) })))))));
  return el('div', { class: 'opt-table-wrap', role: 'region', 'aria-label': t.caption || 'Táblázat', tabindex: '0' }, table);
}

function buildDecision(dec) {
  const art = el('article', { class: 'decision', id: dec.id, 'aria-labelledby': `h-${dec.id}` });
  const stateSlot = el('div', { class: 'dstate' });
  const confirmSlot = el('div');
  const head = el('div', { class: 'dhead' },
    el('div', { class: 'dnum', text: `${dec.num}. döntés` }),
    el('h3', { id: `h-${dec.id}`, text: dec.title }),
    el('p', { class: 'impact', text: dec.impact }));
  if (dec.depends?.length) {
    const deps = dec.depends.map((id) => store.data.byId.get(id)).filter(Boolean).sort((a, b) => a.num - b.num);
    const line = el('div', { class: 'depends' }, 'Ettől függ: ');
    deps.forEach((d, i) => {
      if (i) line.append(', ');
      line.append(el('a', { href: `#${d.id}`, text: `${d.num}. döntés` }));
    });
    head.append(line);
  }
  head.append(stateSlot);
  art.append(head, confirmSlot);

  const cards = new Map();
  const hasTable = dec.options.some((o) => o.table);
  const opts = el('div', { class: 'options' + (hasTable ? ' has-table' : ''), 'data-count': dec.options.length });
  for (const o of dec.options) {
    const h = el('div', { class: 'opt-head' }, el('h4', { text: o.label }));
    const slot = el('div', { class: 'vote-slot' });
    const card = el('div', { class: 'opt' }, h, optTable(o.table), argList(o.pros, 'pro'), argList(o.cons, 'con'), slot);
    cards.set(o.id, { card, head: h, slot });
    opts.append(card);
  }
  art.append(opts);
  if (dec.suggestion) {
    art.append(el('div', { class: 'suggest' }, el('span', { class: 'tag', text: 'Claude javaslata' }), el('span', { text: dec.suggestion })));
  }

  // Döntés alatti hozzászólás-ablak.
  const box = createChatBox(store, { decisionId: dec.id, label: `Hozzászólások: ${dec.title}` });
  const summary = el('summary', { text: 'Hozzászólások' });
  const details = el('details', { class: 'thread' }, summary, box.root);
  details.addEventListener('toggle', () => { if (details.open) box.scrollToBottom(); });
  threadBoxes.push({ box, summary });

  art.append(details, el('a', { class: 'backlink', href: '#osszesito', text: '↑ Összesítő' }));

  decisionUpdaters.push(mountDecisionVoting(store, dec, { article: art, stateSlot, confirmSlot, cards }));
  return art;
}

function buildPage() {
  const { raw, decisions } = store.data;
  document.getElementById('f-count').textContent = `${decisions.length} kérdés, ${raw.groups.length} témában`;

  const groupsEl = document.getElementById('groups');
  const toc = document.getElementById('toc');
  for (const g of raw.groups) {
    const decs = decisions.filter((d) => d.group === g);
    const sec = el('section', { class: 'group', 'aria-labelledby': `g-${g.id}` },
      el('h2', { id: `g-${g.id}` }, el('span', { class: 'gid', text: g.id }), g.title));
    const ol = el('ol');
    for (const d of decs) {
      sec.append(buildDecision(d));
      const mark = el('span', { class: 'mark' });
      tocMarks.set(d.id, mark);
      ol.append(el('li', null, el('a', { href: `#${d.id}` },
        el('span', { class: 'n', text: `${d.num}.` }), el('span', { text: d.title }), mark)));
    }
    groupsEl.append(sec);
    toc.append(el('div', null, el('h2', { text: g.title }), ol));
  }

  // Összesítő táblázat.
  const tbody = document.getElementById('summary-body');
  for (const d of decisions) {
    const leader = el('td', { 'data-label': 'Vezető opció' });
    const count = el('td', { class: 'count', 'data-label': 'Szavazat' });
    const state = el('td', { 'data-label': 'Állapot' });
    summaryCells.set(d.id, { leader, count, state });
    tbody.append(el('tr', null,
      el('td', { class: 'num', text: `${d.num}.` }),
      el('td', null, el('a', { href: `#${d.id}`, text: d.title })),
      leader, count, state));
  }

  // Közös csevegő.
  mainChat = createChatBox(store, { label: 'Csevegő üzenetei' });
  document.getElementById('chat-main').append(mainChat.root);

  // Források.
  const dl = document.getElementById('sources');
  for (const [k, v] of Object.entries(raw.sources)) {
    dl.append(el('dt', null, srcChip(k, '')), el('dd', { text: v }));
  }
  document.getElementById('sources-note').textContent =
    'Az előadásoknál a szám a PDF oldalszáma (dia), a feladatleírásnál és az írásos anyagnál az oldal. ' +
    'A rendeletnél a paragrafus és a bekezdés. Minden fájl a projektmappa INPUT MAPPA almappájában van. ' +
    `Tartalom: ${raw.version}.`;
}

// ---- Dinamikus részek ------------------------------------------------------

function refresh() {
  if (!built) return;
  const { decisions } = store.data;
  const uid = store.user?.uid;
  let mineCount = 0;
  let closedCount = 0;

  for (const u of decisionUpdaters) u();

  for (const d of decisions) {
    const { counts, total, leaders } = tally(store, d.id);
    const closed = isClosed(store, d.id);
    const voted = store.votes.get(d.id)?.has(uid);
    if (voted) mineCount++;
    if (closed) closedCount++;

    const c = summaryCells.get(d.id);
    if (!total) {
      c.leader.replaceChildren(el('span', { class: 'muted', text: 'Még nincs szavazat' }));
    } else if (leaders.length > 1) {
      c.leader.replaceChildren(`Döntetlen: ${leaders.map((id) => d.optionsById.get(id).label).join(' / ')}`);
    } else {
      c.leader.replaceChildren(`${d.optionsById.get(leaders[0]).label} (${counts.get(leaders[0])})`);
    }
    c.count.textContent = String(total);
    if (closed) {
      const chosen = d.optionsById.get(store.status.get(d.id).chosenOptionId);
      c.state.replaceChildren(el('span', { class: 'pill closed', text: 'Lezárva' }), ' ', chosen.label);
    } else {
      c.state.replaceChildren(el('span', { class: 'pill open', text: 'Nyitott' }));
    }

    const m = tocMarks.get(d.id);
    m.textContent = closed ? 'lezárva' : voted ? '✓' : '';
    m.className = 'mark' + (closed ? ' closed' : '');
    m.title = closed ? 'Lezárt döntés' : voted ? 'Szavaztál' : '';
  }

  document.getElementById('progress').textContent =
    `Szavaztál: ${mineCount} / ${decisions.length} · Lezárva: ${closedCount} / ${decisions.length}`;

  for (const { box, summary } of threadBoxes) {
    const n = box.update();
    summary.textContent = `Hozzászólások (${n})`;
  }
  mainChat.update();
}

let refreshQueued = false;
function scheduleRefresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  // Mikrotaszk (nem requestAnimationFrame), hogy háttérben lévő fülön is frissüljön.
  queueMicrotask(() => {
    refreshQueued = false;
    refresh();
  });
}

function subscribeUsers() {
  return onSnapshot(collection(db, 'users'), (snap) => {
    const users = new Map();
    snap.forEach((d) => {
      const u = d.data();
      users.set(d.id, {
        displayName: typeof u.displayName === 'string' && u.displayName.trim() ? u.displayName : null,
        photoURL: typeof u.photoURL === 'string' ? u.photoURL : null,
        colorIndex: Number.isInteger(u.colorIndex) && u.colorIndex >= 0 && u.colorIndex <= 7 ? u.colorIndex : null,
      });
    });
    store.users = users;
    scheduleRefresh();
  }, () => notify('Nem sikerült betölteni a tagok nevét.'));
}

// A config/app.names-ben megadott becenév elsőbbséget kap a Google-fiók nevével szemben.
function displayNameOf(user) {
  return store.nickname || user.displayName || 'Névtelen';
}

function nicknameFrom(config, user) {
  const email = (user.email || '').toLowerCase();
  const names = config?.names;
  if (!email || !names || typeof names !== 'object') return null;
  const n = names[email];
  return typeof n === 'string' && n.trim() ? n.trim().slice(0, 100) : null;
}

// Csevegőszín: az admin-listabeli hely szerint, így 8 tagig mindenki más színt kap.
function colorIndexFrom(config, user) {
  const admins = Array.isArray(config?.admins) ? config.admins : [];
  const i = admins.findIndex((a) => typeof a === 'string' && a.toLowerCase() === (user.email || '').toLowerCase());
  return i >= 0 ? i % 8 : null;
}

function saveProfile(user) {
  const profile = {
    displayName: displayNameOf(user).slice(0, 100),
    photoURL: user.photoURL && user.photoURL.length <= 2000 ? user.photoURL : null,
    lastSeen: serverTimestamp(),
  };
  if (store.colorIndex != null) profile.colorIndex = store.colorIndex;
  return setDoc(doc(db, 'users', user.uid), profile);
}

function stopListeners() {
  for (const f of unsubs) f();
  unsubs = [];
  store.users = new Map();
  store.votes = new Map();
  store.status = new Map();
  store.messages = [];
}

// ---- Indulás ---------------------------------------------------------------

if (CONFIG_MISSING) {
  showError('A js/firebase-config.js még nincs kitöltve. A README.md 4. lépése leírja, honnan kell bemásolni.');
} else {
  getRedirectResult(auth).catch((e) => {
    const msg = authErrorMessage(e);
    if (msg) notify(msg);
  });

  onAuthStateChanged(auth, async (user) => {
    stopListeners();
    store.user = user;
    store.isAdmin = false;
    store.nickname = null;
    store.colorIndex = null;
    renderUserbox();
    if (!user) {
      show('login');
      return;
    }
    show('loading');

    // Hozzáférés: a config/app csak adminnak olvasható, így ez egyben az admin-ellenőrzés.
    try {
      const snap = await getDoc(doc(db, 'config', 'app'));
      store.isAdmin = snap.exists();
      store.nickname = nicknameFrom(snap.data(), user);
      store.colorIndex = colorIndexFrom(snap.data(), user);
    } catch (e) {
      if (e.code !== 'permission-denied') {
        showError('Nem sikerült kapcsolódni az adatbázishoz. Ellenőrizd az internetkapcsolatot, és töltsd újra az oldalt.');
        return;
      }
    }
    if (store.user !== user) return;
    if (!store.isAdmin) {
      show('denied');
      return;
    }

    if (!built) {
      try {
        store.data = await loadData();
      } catch {
        showError('Nem sikerült betölteni a döntések listáját (data/dontesek.json). Töltsd újra az oldalt.');
        return;
      }
      buildPage();
      built = true;
    }
    if (store.user !== user) return;

    renderUserbox();
    saveProfile(user).catch(() => {});
    unsubs.push(subscribeUsers(), subscribeVotes(store, scheduleRefresh), subscribeMessages(store, scheduleRefresh));
    show('app');
    refresh();
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  });
}
