// Visszaszámlálók (tanórai bemutató, leadás). Függetlenek a belépéstől és a Firebase-től.
// Minden .countdown[data-deadline] doboz a saját időpontjáig számol vissza;
// a határidőt az index.html-ben kell átírni (magyar idő, novemberben UTC+1).

const URGENT_DAYS = 7;
const pad = (n) => String(n).padStart(2, '0');

const boxes = [...document.querySelectorAll('.countdown[data-deadline]')].map((box) => ({
  box,
  deadline: new Date(box.dataset.deadline).getTime(),
  label: box.querySelector('.cd-label'),
  parts: Object.fromEntries([...box.querySelectorAll('[data-part]')].map((el) => [el.dataset.part, el])),
  done: false,
}));

function tick() {
  const now = Date.now();
  for (const c of boxes) {
    if (c.done) continue;
    const left = c.deadline - now;
    if (left <= 0) {
      c.done = true;
      c.box.classList.add('over');
      c.box.classList.remove('urgent');
      c.label.textContent = c.box.dataset.over || 'Lejárt';
      for (const p of Object.values(c.parts)) p.textContent = '00';
      continue;
    }
    const total = Math.floor(left / 1000);
    const d = Math.floor(total / 86400);
    c.parts.d.textContent = String(d);
    c.parts.h.textContent = pad(Math.floor((total % 86400) / 3600));
    c.parts.m.textContent = pad(Math.floor((total % 3600) / 60));
    c.parts.s.textContent = pad(total % 60);
    c.box.classList.toggle('urgent', d < URGENT_DAYS);
  }
  return boxes.some((c) => !c.done);
}

if (tick()) {
  const timer = setInterval(() => { if (!tick()) clearInterval(timer); }, 1000);
}
