// Visszaszámlálás a beadási határidőig (Moodle). Független a belépéstől és a Firebase-től.

// 2026. november 29. 23:59, magyar idő (novemberben CET = UTC+1).
const DEADLINE = new Date('2026-11-29T23:59:00+01:00');
const URGENT_DAYS = 7;

const box = document.getElementById('countdown');
const parts = {
  d: document.getElementById('cd-d'),
  h: document.getElementById('cd-h'),
  m: document.getElementById('cd-m'),
  s: document.getElementById('cd-s'),
};
const label = document.getElementById('cd-label');

const pad = (n) => String(n).padStart(2, '0');

function tick() {
  const left = DEADLINE.getTime() - Date.now();
  if (left <= 0) {
    box.classList.add('over');
    box.classList.remove('urgent');
    label.textContent = 'A leadási határidő lejárt';
    for (const p of Object.values(parts)) p.textContent = '00';
    return false;
  }
  const total = Math.floor(left / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  parts.d.textContent = String(d);
  parts.h.textContent = pad(h);
  parts.m.textContent = pad(m);
  parts.s.textContent = pad(s);
  box.classList.toggle('urgent', d < URGENT_DAYS);
  return true;
}

if (tick()) {
  const timer = setInterval(() => { if (!tick()) clearInterval(timer); }, 1000);
}
