// DOM-segédek. Felhasználói szöveg kizárólag textContent-tel kerül az oldalra.

export function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k);
  return n;
}

const timeFmt = new Intl.DateTimeFormat('hu-HU', { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('hu-HU', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fullFmt = new Intl.DateTimeFormat('hu-HU', { dateStyle: 'long', timeStyle: 'short' });

export function formatTime(date) {
  if (!date) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? timeFmt.format(date) : dateTimeFmt.format(date);
}

export function formatFull(date) {
  return date ? fullFmt.format(date) : '';
}

export function avatar(photoURL, cls = 'avatar') {
  if (!photoURL || !/^https:\/\//.test(photoURL)) return el('span', { class: cls, 'aria-hidden': 'true' });
  const img = el('img', { class: cls, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.src = photoURL;
  return img;
}

let toastTimer;
export function notify(message, kind = 'error') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'error' ? 7000 : 3500);
}

export function userName(store, uid) {
  return store.users.get(uid)?.displayName || 'Ismeretlen tag';
}

const collator = new Intl.Collator('hu');
export const byName = (store) => (a, b) => collator.compare(userName(store, a), userName(store, b));
