// Feladatösszesítés és feladatlista a lezárt szavazás után (data/vegeredmeny.json).
// Az összesítés a Tervezési döntések és a Feladatkiosztás fül tetején jelenik meg;
// az intézmény adatai és a lebontott feladatok csak a Feladatkiosztás fülön.
import { dataTable, el } from './dom.js';

const dateFmt = new Intl.DateTimeFormat('hu-HU', { month: 'long', day: 'numeric' });
const fmtDate = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
};

// A 24 döntés végeredménye témánként.
function resultGroups(store, final) {
  return store.data.raw.groups.map((g) => {
    const rows = store.data.decisions.filter((d) => d.group === g && final.results[d.id]).map((d) => {
      const r = final.results[d.id];
      const opt = d.optionsById.get(r.option);
      if (!opt) return null;
      return el('li', { class: 'final-row' + (r.override ? ' override' : '') },
        el('span', { class: 'final-num', text: `${d.num}.` }),
        el('a', { class: 'final-q', href: `#${d.id}`, 'data-goto': 'dontesek', text: d.title }),
        el('span', { class: 'final-a', text: r.label || opt.label }),
        el('span', { class: 'final-votes', text: r.override ? `szavazás ${r.votes} · felülírva` : r.votes }),
        r.override ? el('span', { class: 'final-why', text: r.override }) : null);
    }).filter(Boolean);
    return rows.length ? el('section', { class: 'final-group' },
      el('h3', { class: 'final-group-title' }, el('span', { class: 'gid', text: g.id }), g.title),
      el('ol', { class: 'final-list' }, ...rows)) : null;
  }).filter(Boolean);
}

// Feladatösszesítés: rövid leírás, és lenyitható részletként a döntések végeredménye.
function summaryBox(store, final) {
  return el('section', { class: 'summary-card', 'aria-label': 'Feladatösszesítés' },
    el('h2', { class: 'block-title', text: 'Feladatösszesítés' }),
    el('p', { class: 'note', text: final.note || '' }),
    el('ul', { class: 'final-summary' }, ...(final.summary || []).map((s) => el('li', { text: s }))),
    el('details', { class: 'final-details' },
      el('summary', { text: `A ${Object.keys(final.results).length} döntés végeredménye` }),
      el('div', { class: 'final-groups' }, ...resultGroups(store, final))));
}

function fillTable(id, table) {
  document.getElementById(id).replaceChildren(dataTable(table) || '');
  document.getElementById(`${id}-note`).textContent = table?.note || '';
}

function taskCard(t) {
  return el('li', { class: 'task' + (t.owner ? ' assigned' : '') },
    el('div', { class: 'task-head' },
      el('span', { class: 'task-title', text: t.title }),
      t.slide && t.slide !== '–' ? el('span', { class: 'task-slide', text: t.slide === 'mind' ? 'minden dia' : `${t.slide} dia` }) : null),
    t.desc ? el('p', { class: 'task-desc', text: t.desc }) : null,
    Array.isArray(t.steps) && t.steps.length
      ? el('ol', { class: 'task-steps' }, ...t.steps.map((s) => el('li', { text: s })))
      : null,
    el('div', { class: 'task-owner' }, 'Felelős: ', t.owner ? el('b', { text: t.owner }) : 'még nincs kiosztva'));
}

export function renderSummary(store) {
  const final = store.data?.final;
  for (const box of document.querySelectorAll('.summary-box')) {
    box.replaceChildren(final?.results ? summaryBox(store, final) : '');
  }
  if (!final?.results) return;

  // Az intézmény adatai.
  fillTable('t-evfolyamok', final.evfolyamok);
  fillTable('t-letszam', final.letszamterv);
  fillTable('t-dolgozok', final.dolgozok);
  const k = final.konyhaiLetszam;
  document.getElementById('t-konyha-title').textContent = k?.title || '';
  document.getElementById('t-konyha').replaceChildren(...(k?.points || []).map((p) => el('li', { text: p })));
  document.getElementById('t-konyha-source').textContent = k?.source ? `Forrás: ${k.source}` : '';

  // Határidők és a lebontott feladatok, csoportonként.
  document.getElementById('task-deadlines').replaceChildren(...(final.deadlines || []).map((d) =>
    el('li', null, el('b', { text: `${fmtDate(d.date)}:` }), ` ${d.label}`, d.note ? el('span', { class: 'muted', text: ` (${d.note})` }) : null)));
  const tasks = Array.isArray(final.tasks) ? final.tasks : [];
  const order = [...new Set(tasks.map((t) => t.group))];
  document.getElementById('task-groups').replaceChildren(...order.map((name) => el('section', { class: 'task-group' },
    el('h3', { class: 'final-group-title', text: name }),
    el('ul', { class: 'task-list' }, ...tasks.filter((t) => t.group === name).map(taskCard)))));
}
