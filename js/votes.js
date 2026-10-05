// Szavazás, döntések lezárása és újranyitása.
import {
  collection,
  db,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from './firebase.js';
import { avatar, byName, el, formatFull, notify, userName } from './dom.js';

const listenError = () => notify('Nem sikerült frissíteni az adatokat. Töltsd újra az oldalt.');

// ---- Adatok ----------------------------------------------------------------

export function subscribeVotes(store, onUpdate) {
  const unsubVotes = onSnapshot(collection(db, 'votes'), (snap) => {
    const votes = new Map();
    snap.forEach((d) => {
      const v = d.data();
      const dec = store.data.byId.get(v.decisionId);
      if (!dec || !dec.optionsById.has(v.optionId) || typeof v.uid !== 'string') return;
      if (!votes.has(v.decisionId)) votes.set(v.decisionId, new Map());
      votes.get(v.decisionId).set(v.uid, v.optionId);
    });
    store.votes = votes;
    onUpdate();
  }, listenError);

  const unsubStatus = onSnapshot(collection(db, 'status'), (snap) => {
    const status = new Map();
    snap.forEach((d) => {
      const dec = store.data.byId.get(d.id);
      const s = d.data();
      if (!dec) return;
      const closed = s.state === 'closed' && dec.optionsById.has(s.chosenOptionId);
      status.set(d.id, {
        state: closed ? 'closed' : 'open',
        chosenOptionId: closed ? s.chosenOptionId : null,
        closedBy: closed ? s.closedBy : null,
        closedAt: closed && s.closedAt?.toDate ? s.closedAt.toDate() : null,
      });
    });
    store.status = status;
    onUpdate();
  }, listenError);

  return () => { unsubVotes(); unsubStatus(); };
}

export function isClosed(store, decisionId) {
  return store.status.get(decisionId)?.state === 'closed';
}

// Opciónkénti szavazatszám és a vezető opció(k).
export function tally(store, decisionId) {
  const dec = store.data.byId.get(decisionId);
  const counts = new Map(dec.options.map((o) => [o.id, 0]));
  for (const optionId of (store.votes.get(decisionId) || new Map()).values()) {
    counts.set(optionId, counts.get(optionId) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const max = Math.max(...counts.values());
  const leaders = max > 0 ? dec.options.filter((o) => counts.get(o.id) === max).map((o) => o.id) : [];
  return { counts, total, leaders };
}

async function castVote(store, decisionId, optionId) {
  const dec = store.data.byId.get(decisionId);
  if (!dec || !dec.optionsById.has(optionId)) return;
  if (isClosed(store, decisionId)) {
    notify('A döntés le van zárva.');
    return;
  }
  const uid = store.user.uid;
  const ref = doc(db, 'votes', `${decisionId}__${uid}`);
  const mine = store.votes.get(decisionId)?.get(uid);
  try {
    if (mine === optionId) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { decisionId, optionId, uid, updatedAt: serverTimestamp() });
    }
  } catch (e) {
    if (e.code === 'permission-denied') {
      notify(isClosed(store, decisionId) ? 'A döntés le van zárva.' : 'Nincs jogosultságod szavazni ebben a döntésben.');
    } else {
      notify('Nem sikerült menteni a szavazatot, próbáld újra.');
    }
  }
}

async function setStatus(store, decisionId, chosenOptionId) {
  const data = chosenOptionId
    ? { state: 'closed', chosenOptionId, closedBy: store.user.uid, closedAt: serverTimestamp() }
    : { state: 'open', chosenOptionId: null, closedBy: null, closedAt: null };
  try {
    await setDoc(doc(db, 'status', decisionId), data);
    return true;
  } catch (e) {
    notify(e.code === 'permission-denied'
      ? 'Nincs jogosultságod lezárni vagy újranyitni ezt a döntést.'
      : 'Nem sikerült menteni, próbáld újra.');
    return false;
  }
}

// ---- Felület ---------------------------------------------------------------

// A döntéskártya szavazós részei. A statikus tartalmat az app.js rajzolja,
// ez a függvény tölti a szavazósávot, a szavazók listáját és az állapotsort.
// Visszatér egy update() függvénnyel, amelyet minden adatváltozáskor meg kell hívni.
export function mountDecisionVoting(store, dec, { article, stateSlot, confirmSlot, cards }) {
  let pending = false;
  let mode = 'idle'; // 'idle' | 'closing' | 'reopening'
  const optRefs = new Map();

  for (const o of dec.options) {
    const { card, head, slot } = cards.get(o.id);
    const accepted = el('span', { class: 'pill accepted', text: 'Elfogadva', hidden: true });
    head.append(accepted);
    const btn = el('button', { class: 'pick', type: 'button' });
    btn.addEventListener('click', async () => {
      pending = true;
      update();
      await castVote(store, dec.id, o.id);
      pending = false;
      update();
    });
    const count = el('span', { class: 'vcount' });
    const voters = el('ul', { class: 'voters', 'aria-label': `Szavazók: ${o.label}` });
    slot.append(el('div', { class: 'votebar' }, btn, count), voters);
    optRefs.set(o.id, { card, accepted, btn, count, voters });
  }

  // Állapotsor: jelvény, rövid szöveg, admin-gomb.
  const pill = el('span', { class: 'pill' });
  const note = el('span', { class: 'closed-note' });
  const toggleBtn = el('button', { class: 'btn small', type: 'button' });
  toggleBtn.addEventListener('click', () => {
    mode = isClosed(store, dec.id) ? 'reopening' : 'closing';
    renderConfirm();
    update();
    (confirmSlot.querySelector('input:checked') || confirmSlot.querySelector('input, button'))?.focus();
  });
  stateSlot.append(pill, note, toggleBtn);

  const vcSpans = new Map();

  function cancel() {
    mode = 'idle';
    renderConfirm();
    update();
    toggleBtn.focus();
  }

  function renderConfirm() {
    vcSpans.clear();
    confirmSlot.replaceChildren();
    if (mode === 'closing') {
      const { counts, leaders } = tally(store, dec.id);
      const form = el('form', { class: 'confirm' });
      const fs = el('fieldset', null, el('legend', { text: 'Melyik opció legyen az elfogadott döntés?' }));
      const submit = el('button', { class: 'btn primary', type: 'submit', text: 'Lezárás ezzel az opcióval', disabled: leaders.length !== 1 });
      for (const o of dec.options) {
        const radio = el('input', { type: 'radio', name: `close-${dec.id}`, value: o.id, checked: leaders.length === 1 && leaders[0] === o.id });
        radio.addEventListener('change', () => { submit.disabled = false; });
        const vc = el('span', { class: 'vc', text: `(${counts.get(o.id)} szavazat)` });
        vcSpans.set(o.id, vc);
        fs.append(el('label', null, radio, el('span', null, o.label, ' ', vc)));
      }
      form.append(fs, el('div', { class: 'actions' }, submit,
        el('button', { class: 'btn', type: 'button', text: 'Mégse', onclick: cancel })));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const chosen = new FormData(form).get(`close-${dec.id}`);
        if (!chosen || !dec.optionsById.has(chosen)) return;
        submit.disabled = true;
        if (await setStatus(store, dec.id, chosen)) {
          notify('A döntést lezártad.', 'info');
          cancel();
        } else {
          submit.disabled = false;
        }
      });
      confirmSlot.append(form);
    } else if (mode === 'reopening') {
      const yes = el('button', { class: 'btn primary', type: 'button', text: 'Igen, újranyitom' });
      yes.addEventListener('click', async () => {
        yes.disabled = true;
        if (await setStatus(store, dec.id, null)) {
          notify('A döntést újranyitottad, újra lehet szavazni.', 'info');
          cancel();
        } else {
          yes.disabled = false;
        }
      });
      confirmSlot.append(el('div', { class: 'confirm', role: 'group', 'aria-label': 'Újranyitás megerősítése' },
        el('p', { text: 'Biztosan újranyitod a döntést? A leadott szavazatok megmaradnak, és újra lehet szavazni.' }),
        el('div', { class: 'actions' }, yes, el('button', { class: 'btn', type: 'button', text: 'Mégse', onclick: cancel }))));
    }
  }

  function update() {
    const closed = isClosed(store, dec.id);
    const st = store.status.get(dec.id);
    const chosen = closed ? st.chosenOptionId : null;
    const votes = store.votes.get(dec.id) || new Map();
    const uid = store.user?.uid;
    const mine = votes.get(uid);
    const { counts, total } = tally(store, dec.id);

    // Ha közben egy másik admin változtatott az állapoton, a megerősítő panel bezárul.
    if ((mode === 'closing' && closed) || (mode === 'reopening' && !closed)) {
      mode = 'idle';
      renderConfirm();
    }

    article.classList.toggle('is-closed', closed);

    for (const o of dec.options) {
      const r = optRefs.get(o.id);
      const isMine = mine === o.id;
      r.card.classList.toggle('picked', isMine);
      r.card.classList.toggle('accepted', chosen === o.id);
      r.accepted.hidden = chosen !== o.id;
      r.btn.disabled = closed || pending;
      r.btn.setAttribute('aria-pressed', String(isMine));
      r.btn.textContent = closed
        ? (isMine ? 'Erre szavaztál · lezárva' : 'Szavazás lezárva')
        : isMine ? 'Szavazatom visszavonása'
        : mine ? 'Szavazatom áthelyezése ide'
        : 'Erre szavazok';
      r.count.textContent = `${counts.get(o.id)} szavazat`;
      vcSpans.get(o.id)?.replaceChildren(`(${counts.get(o.id)} szavazat)`);

      const voterIds = [...votes].filter(([, opt]) => opt === o.id).map(([u]) => u).sort(byName(store));
      r.voters.replaceChildren(...voterIds.map((u) => {
        const p = store.users.get(u);
        const me = u === uid;
        return el('li', { class: 'voter' + (me ? ' me' : '') },
          avatar(p?.photoURL, 'avatar'),
          el('span', { text: userName(store, u) + (me ? ' (te)' : '') }));
      }));
    }

    pill.className = 'pill ' + (closed ? 'closed' : 'open');
    pill.textContent = closed ? 'Lezárva' : 'Nyitott';
    if (closed) {
      const by = st.closedBy ? userName(store, st.closedBy) : '';
      note.textContent = `Döntés: ${dec.optionsById.get(chosen).label}` +
        (by ? ` · lezárta: ${by}` : '') + (st.closedAt ? `, ${formatFull(st.closedAt)}` : '');
    } else {
      note.textContent = `${total} szavazat`;
    }
    toggleBtn.hidden = !store.isAdmin || mode !== 'idle';
    toggleBtn.textContent = closed ? 'Döntés újranyitása' : 'Döntés lezárása';
  }

  return update;
}
