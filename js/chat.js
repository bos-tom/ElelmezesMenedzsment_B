// Csevegő: a közös ablak az oldal alján és a döntésenkénti hozzászólás-ablakok.
// Mindegyik ugyanabból a messages gyűjteményből dolgozik; a döntés alatti ablak
// csak az adott döntéshez címkézett üzeneteket mutatja.
import {
  addDoc,
  collection,
  db,
  deleteDoc,
  doc,
  limitToLast,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from './firebase.js';
import { avatar, el, formatFull, formatTime, notify, userName } from './dom.js';

const MAX_LEN = 1000;
const MIN_INTERVAL_MS = 2000;
const HISTORY_LIMIT = 500;
let lastSentAt = 0;

export function subscribeMessages(store, onUpdate) {
  const q = query(collection(db, 'messages'), orderBy('createdAt'), limitToLast(HISTORY_LIMIT));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    store.messages = snap.docs.map((d) => {
      const m = d.data({ serverTimestamps: 'estimate' });
      if (typeof m.uid !== 'string' || typeof m.text !== 'string') return null;
      return {
        id: d.id,
        uid: m.uid,
        text: m.text,
        decisionId: store.data.byId.has(m.decisionId) ? m.decisionId : null,
        createdAt: m.createdAt?.toDate ? m.createdAt.toDate() : new Date(),
        pending: d.metadata.hasPendingWrites,
      };
    }).filter(Boolean);
    onUpdate();
  }, () => notify('Nem sikerült betölteni a csevegőt. Töltsd újra az oldalt.'));
}

async function sendMessage(store, text, decisionId) {
  await addDoc(collection(db, 'messages'), {
    uid: store.user.uid,
    text,
    decisionId,
    createdAt: serverTimestamp(),
  });
}

// Egy csevegőablak. options.decisionId: ha meg van adva, ez egy döntés alatti ablak.
export function createChatBox(store, { decisionId = null, label }) {
  const isThread = decisionId != null;
  const nodes = new Map();
  let lastIds = [];

  const list = el('ol', { class: 'msglist', role: 'log', 'aria-label': label, tabindex: '0' });
  const newBtn = el('button', { class: 'btn small primary newmsg', type: 'button', text: 'Új üzenet ↓', hidden: true });
  newBtn.addEventListener('click', () => scrollToBottom());
  list.addEventListener('scroll', () => { if (isAtBottom()) newBtn.hidden = true; });

  const taId = `ta-${decisionId || 'main'}`;
  const ta = el('textarea', {
    id: taId,
    rows: '2',
    maxlength: String(MAX_LEN),
    placeholder: isThread ? 'Hozzászólás ehhez a döntéshez…' : 'Írj üzenetet…',
  });
  const counter = el('span', { class: 'hint', 'aria-live': 'off' });
  const sendBtn = el('button', { class: 'btn primary', type: 'submit', text: isThread ? 'Hozzászólás küldése' : 'Üzenet küldése' });
  const left = el('div', { class: 'left' });

  let select = null;
  if (!isThread) {
    select = el('select', { id: 'chat-tag' },
      el('option', { value: '', text: 'Nincs címke' }),
      ...store.data.decisions.map((d) => el('option', { value: d.id, text: `${d.num}. ${d.title}` })));
    left.append(el('label', { class: 'lbl', for: 'chat-tag', text: 'Döntéshez:' }), select);
  }
  left.append(counter);

  const form = el('form', { class: 'composer' },
    el('label', { class: 'sr-only', for: taId, text: isThread ? 'Hozzászólás' : 'Üzenet' }),
    ta,
    el('div', { class: 'row' }, left, sendBtn),
    el('div', { class: 'hint', text: 'Enter: küldés · Shift+Enter: új sor' }));

  const root = el('div', { class: 'chatbox' }, el('div', { class: 'msgwrap' }, list, newBtn), form);

  function updateCounter() {
    const n = ta.value.trim().length;
    counter.textContent = `${n} / ${MAX_LEN}`;
    counter.classList.toggle('over', n > MAX_LEN);
  }
  updateCounter();
  ta.addEventListener('input', updateCounter);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    if (text.length > MAX_LEN) {
      notify(`Az üzenet legfeljebb ${MAX_LEN} karakter lehet.`);
      return;
    }
    const now = Date.now();
    if (now - lastSentAt < MIN_INTERVAL_MS) {
      notify('Túl gyorsan küldesz. Várj egy pillanatot, és próbáld újra.');
      return;
    }
    let tag = isThread ? decisionId : (select.value || null);
    if (tag && !store.data.byId.has(tag)) tag = null;

    lastSentAt = now;
    const draft = ta.value;
    ta.value = '';
    updateCounter();
    sendBtn.disabled = true;
    try {
      const sending = sendMessage(store, text, tag);
      // A helyi másolat azonnal megjelenik; a küldés gomb a szerver válaszáig sem blokkol sokáig.
      setTimeout(() => { sendBtn.disabled = false; }, MIN_INTERVAL_MS);
      await sending;
    } catch (err) {
      ta.value = draft;
      updateCounter();
      notify(err.code === 'permission-denied'
        ? 'Nincs jogosultságod üzenetet küldeni.'
        : 'Nem sikerült elküldeni, próbáld újra.');
    }
  });

  function isAtBottom() {
    return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  }
  function scrollToBottom() {
    list.scrollTop = list.scrollHeight;
    newBtn.hidden = true;
  }

  function buildNode(m) {
    const who = el('span', { class: 'who' });
    const av = el('span');
    const time = el('time');
    const del = el('span', { class: 'del' });
    const meta = el('div', { class: 'meta' }, av, who, time);
    if (!isThread && m.decisionId) {
      const d = store.data.byId.get(m.decisionId);
      meta.append(el('a', { class: 'dtag', href: `#${d.id}`, text: `${d.num}. ${d.title}` }));
    }
    meta.append(del);
    const li = el('li', { class: 'msg' }, meta, el('p', { class: 'text', text: m.text }));

    function showDelete() {
      const btn = el('button', { class: 'btn link small', type: 'button', text: 'Törlés', 'aria-label': 'Üzenet törlése' });
      btn.addEventListener('click', () => {
        const yes = el('button', { class: 'btn danger solid small', type: 'button', text: 'Igen, törlöm' });
        const no = el('button', { class: 'btn small', type: 'button', text: 'Mégse' });
        yes.addEventListener('click', async () => {
          yes.disabled = true;
          try {
            await deleteDoc(doc(db, 'messages', m.id));
          } catch {
            notify('Nem sikerült törölni, próbáld újra.');
            showDelete();
          }
        });
        no.addEventListener('click', () => { showDelete(); del.querySelector('button')?.focus(); });
        del.replaceChildren(el('span', { text: 'Törlöd?' }), yes, no);
        no.focus();
      });
      del.replaceChildren(btn);
    }

    let shownPhoto;
    function update(msg) {
      const p = store.users.get(msg.uid);
      const me = msg.uid === store.user?.uid;
      who.textContent = userName(store, msg.uid) + (me ? ' (te)' : '');
      if (shownPhoto !== (p?.photoURL || null)) {
        shownPhoto = p?.photoURL || null;
        av.replaceChildren(avatar(shownPhoto, 'avatar sm'));
      }
      time.textContent = msg.pending ? 'küldés…' : formatTime(msg.createdAt);
      time.dateTime = msg.createdAt.toISOString();
      time.title = formatFull(msg.createdAt);
      li.classList.toggle('mine', me);
      li.classList.toggle('pending', msg.pending);
      const canDelete = !msg.pending && (me || store.isAdmin);
      if (canDelete && !del.firstChild) showDelete();
      if (!canDelete) del.replaceChildren();
    }
    return { li, update };
  }

  function update() {
    const msgs = isThread ? store.messages.filter((m) => m.decisionId === decisionId) : store.messages;
    const wasAtBottom = isAtBottom();
    const known = new Set(lastIds);
    const added = msgs.filter((m) => !known.has(m.id));
    const firstRender = lastIds.length === 0 && nodes.size === 0;

    const seen = new Set();
    const children = msgs.map((m) => {
      seen.add(m.id);
      let n = nodes.get(m.id);
      if (!n) { n = buildNode(m); nodes.set(m.id, n); }
      n.update(m);
      return n.li;
    });
    for (const id of nodes.keys()) if (!seen.has(id)) nodes.delete(id);
    list.replaceChildren(...(children.length ? children : [el('li', { class: 'empty', text: isThread ? 'Még nincs hozzászólás ehhez a döntéshez.' : 'Még nincs üzenet. Írd meg az elsőt!' })]));
    lastIds = msgs.map((m) => m.id);

    const ownNew = added.some((m) => m.uid === store.user?.uid);
    if (firstRender || wasAtBottom || ownNew) scrollToBottom();
    else if (added.length) newBtn.hidden = false;

    return msgs.length;
  }

  return { root, update, scrollToBottom };
}
