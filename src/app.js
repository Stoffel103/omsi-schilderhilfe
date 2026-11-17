// Oberfläche der OMSI Schilderhilfe. Kein Framework: DOM wird direkt gebaut.
// Inhalte aus den Kartendateien werden nur als Text eingefügt (nie als HTML).

import { STRINGS, pickLang } from './i18n.js';
import { entriesFromDrop, entriesFromInput, groupByMap, readText } from './io.js';
import { loadMap } from './load.js';
import { describeDays, fmtTime, norm, parseTime, tourValid } from './model.js';
import { routeOf } from './parse/hof.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  lang: pickLang(),
  groups: [],
  mapIdx: 0,
  hofIdx: 0,
  model: null,
  tab: 'tours',
  tourId: null,
  detailTime: '',
  codeLimit: 200,
};
let t = STRINGS[state.lang];

/** Kleines Hilfsmittel zum Bauen von Elementen. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- Sprache ---------- */

function applyLang() {
  t = STRINGS[state.lang];
  document.documentElement.lang = state.lang;
  document.title = t.title;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t[el.dataset.i18n];
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.placeholder = t[el.dataset.i18nPh];
  $('#lang-toggle').textContent = state.lang === 'de' ? 'EN' : 'DE';
  fillDaySelects();
  if (state.model) {
    renderSummary();
    renderAll();
  }
}

function fillDaySelects() {
  for (const sel of [$('#tour-day'), $('#find-day')]) {
    const keep = sel.value;
    sel.replaceChildren(h('option', { value: '', text: t.anyDay }), ...t.dayLong.map((d, i) => h('option', { value: String(i), text: d })));
    sel.value = keep;
  }
  const school = $('#tour-school');
  const keep = school.value;
  school.replaceChildren(
    h('option', { value: '', text: `${t.school}: ${t.anySchool}` }),
    h('option', { value: 'schule', text: t.schoolDays }),
    h('option', { value: 'ferien', text: t.schoolHolidays }),
  );
  school.value = keep;
}

/* ---------- Dateien laden ---------- */

async function handleEntries(entries) {
  const groups = groupByMap(entries);
  if (groups.length === 0) {
    showNotice(t.noMapFound);
    $('#status').hidden = false;
    return;
  }
  // Hof-Dateien, deren Name zur Karte passt, nach vorne
  for (const g of groups) {
    const key = norm(g.name).replace(/[^a-z0-9]/g, '');
    const score = (e) => {
      const f = norm(e.path.split('/').pop()).replace(/[^a-z0-9]/g, '');
      return (key && f.includes(key.slice(0, 6)) ? 2 : 0) + (e.path.split('/').length <= 2 ? 1 : 0);
    };
    g.hofs.sort((a, b) => score(b) - score(a));
  }
  state.groups = groups;
  state.mapIdx = 0;
  state.hofIdx = 0;
  fillMapSelects();
  await reload();
}

async function reload() {
  const group = state.groups[state.mapIdx];
  const prog = $('#progress');
  prog.hidden = false;
  prog.textContent = t.loading;
  try {
    state.model = await loadMap(group, (e) => readText(e.file), {
      hofIndex: state.hofIdx,
      onProgress: (done, total) => {
        if (done % 50 === 0 || done === total) prog.textContent = `${t.loading} ${done}/${total}`;
      },
    });
  } catch (err) {
    console.error(err);
    showNotice(String(err?.message ?? err));
    prog.hidden = true;
    return;
  }
  prog.hidden = true;
  state.tourId = null;
  // Nur eine Hof-Datei ohne Fahrplan: gleich die Ziele zeigen
  if (state.model.tours.length === 0) state.tab = 'codes';
  $('#drop').classList.add('compact');
  $('#status').hidden = false;
  $('#views').hidden = false;
  renderSummary();
  fillStopList();
  renderAll();
}

function fillMapSelects() {
  const mapSel = $('#map-select');
  mapSel.replaceChildren(...state.groups.map((g, i) => h('option', { value: String(i), text: g.name })));
  $('#map-field').hidden = state.groups.length < 2;
  fillHofSelect();
}

function fillHofSelect() {
  const hofs = state.groups[state.mapIdx]?.hofs ?? [];
  $('#hof-select').replaceChildren(...hofs.map((e, i) => h('option', { value: String(i), text: e.path.split('/').pop() })));
  $('#hof-field').hidden = hofs.length === 0;
}

function showNotice(text) {
  const n = $('#notice');
  n.textContent = text ?? '';
  n.hidden = !text;
}

function renderSummary() {
  const m = state.model;
  const group = state.groups[state.mapIdx];
  $('#summary').textContent = t.summary({
    lines: new Set(m.tours.map((x) => x.lineFile)).size,
    tours: m.tours.length,
    termini: m.hof.termini.length,
    routes: m.hof.trips.length,
  });
  const notes = [];
  if (!group.hofs.length) notes.push(t.noHof);
  if (m.missing.length) notes.push(t.missingTrips(m.missing.length));
  showNotice(notes.join(' '));
}

function fillStopList() {
  const stops = new Set();
  for (const tour of state.model.tours) for (const r of tour.rows) if (r.from) stops.add(r.from);
  $('#stop-list').replaceChildren(...[...stops].sort((a, b) => a.localeCompare(b, 'de')).map((s) => h('option', { value: s })));
}

/* ---------- Ansichten ---------- */

function renderAll() {
  renderTabs();
  renderTourList();
  renderTourDetail();
  renderFind();
  renderCodes();
}

function renderTabs() {
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.dataset.panel !== state.tab;
}

function filteredTours() {
  const q = norm($('#tour-search').value);
  const day = $('#tour-day').value;
  const school = $('#tour-school').value;
  return state.model.tours.filter(
    (tour) => (!q || norm(tour.number).includes(q) || norm(tour.lineFile).includes(q)) && tourValid(tour, day, school),
  );
}

function renderTourList() {
  const list = $('#tour-list');
  const tours = filteredTours();
  if (!tours.length) {
    list.replaceChildren(h('li', { class: 'empty', text: t.noTours }));
    return;
  }
  // spielbare Linien zuerst
  const groups = new Map();
  for (const tour of [...tours].sort((a, b) => Number(b.userAllowed) - Number(a.userAllowed))) {
    if (!groups.has(tour.lineFile)) groups.set(tour.lineFile, []);
    groups.get(tour.lineFile).push(tour);
  }
  const items = [];
  for (const [lineFile, ts] of groups) {
    items.push(h('li', { class: 'group', text: `${lineFile} · ${ts[0].userAllowed ? t.playable : t.aiOnly}` }));
    for (const tour of ts) {
      items.push(
        h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              'aria-current': String(tour.id === state.tourId),
              onclick: () => {
                state.tourId = tour.id;
                renderTourList();
                renderTourDetail();
              },
            },
            h('span', { class: 'num', text: tour.number }),
            h('span', { class: 'when', text: `${fmtTime(tour.start)}–${fmtTime(tour.end)}` }),
            h('span', { class: 'days', text: describeDays(tour.days, t) }),
          ),
        ),
      );
    }
  }
  list.replaceChildren(...items);
}

function renderTourDetail() {
  const box = $('#tour-detail');
  const tour = state.model.tours.find((x) => x.id === state.tourId);
  if (!tour) {
    box.replaceChildren(h('p', { class: 'empty', text: t.chooseTour }));
    return;
  }
  const timeInput = h('input', {
    type: 'time',
    value: state.detailTime,
    oninput: (e) => {
      state.detailTime = e.target.value;
      box.querySelector('tbody').replaceWith(tourBody(tour));
    },
  });
  box.replaceChildren(
    h(
      'div',
      { class: 'tour-head' },
      h('div', {}, h('h2', {}, `${t.tour} `, h('span', { class: 'num', text: tour.number })),
        h('div', { class: 'chips' },
          h('span', { class: 'chip', text: tour.lineFile }),
          h('span', { class: 'chip', text: describeDays(tour.days, t) }),
          h('span', { class: 'chip', text: t.tripsCount(tour.rows.length) }),
          tour.aiGroup ? h('span', { class: 'chip', text: tour.aiGroup }) : null)),
      h('label', { class: 'field' }, h('span', { text: t.fromTime }), timeInput),
    ),
    h('div', { class: 'table-wrap' }, h('table', {}, tableHead(), tourBody(tour))),
  );
}

function tableHead(withTour = false) {
  return h('thead', {}, h('tr', {},
    h('th', { text: t.time }),
    h('th', { text: `${t.from} → ${t.to}` }),
    h('th', { text: t.line }),
    h('th', { text: t.route }),
    h('th', { text: t.destination }),
    withTour ? h('th', { text: t.tour }) : null));
}

function tourBody(tour) {
  const now = parseTime(state.detailTime);
  let nextMarked = false;
  return h('tbody', {}, tour.rows.map((r) => {
    let cls = '';
    if (now !== null) {
      const dep = r.departure % 1440;
      if (dep < now) cls = 'past';
      else if (!nextMarked) {
        cls = 'next';
        nextMarked = true;
      }
    }
    return signRow(r, cls);
  }));
}

/** Eine Zeile mit den IBIS-Werten. */
function signRow(r, cls = '', tour = null) {
  const m = r.match;
  const lineCell = m
    ? [h('span', { class: 'lcd', text: m.line || '–' }), m.line && r.ttpLine && norm(r.ttpLine) !== norm(m.line) ? h('span', { class: 'sub', text: r.ttpLine }) : null]
    : [h('span', { class: 'lcd dim', text: '–' })];
  const routeCell = m && m.route !== null
    ? h('span', { class: 'lcd', text: String(m.route).padStart(2, '0') })
    : h('span', { class: 'lcd dim', text: '–' });
  const zielCell = m && m.ziel !== null
    ? [
        h('span', { class: 'lcd', text: String(m.ziel) }),
        m.confidence !== 'sicher' ? h('span', { class: `badge ${m.confidence}`, title: t.confHelp, text: t.conf[m.confidence] }) : null,
        h('span', { class: 'sub', text: m.zielName.replace(/\s{2,}/g, ' · ') }),
        m.altZiele.length ? h('span', { class: 'sub', text: `${t.also} ${m.altZiele.join(', ')}` }) : null,
      ]
    : [h('span', { class: 'lcd dim', text: '–' }), h('span', { class: 'sub', text: r.to || r.tripName })];

  return h('tr', { class: cls || null },
    h('td', { class: 't', text: fmtTime(r.departure) }),
    h('td', { class: 'place' }, r.from || r.tripName, h('span', { class: 'sub', text: `→ ${r.to}` })),
    h('td', { class: 'ibis' }, lineCell),
    h('td', { class: 'ibis' }, routeCell),
    h('td', { class: 'ibis' }, zielCell),
    tour ? h('td', {}, h('button', {
      type: 'button', class: 'btn link', text: tour.number,
      onclick: () => {
        state.tab = 'tours';
        state.tourId = tour.id;
        renderAll();
      },
    })) : null);
}

/* ---------- Fahrt finden ---------- */

function renderFind() {
  const out = $('#find-results');
  const time = parseTime($('#find-time').value);
  const stop = norm($('#find-stop').value);
  const tol = Math.max(0, Number($('#find-tol').value) || 0);
  const day = $('#find-day').value;
  if (time === null && !stop) {
    out.replaceChildren();
    return;
  }
  const hits = [];
  for (const tour of state.model.tours) {
    if (!tourValid(tour, day, '')) continue;
    for (const r of tour.rows) {
      const dep = r.departure % 1440;
      if (time !== null && Math.abs(dep - time) > tol) continue;
      if (stop && !norm(r.from).includes(stop)) continue;
      hits.push({ r, tour, d: time === null ? dep : Math.abs(dep - time) });
    }
  }
  hits.sort((a, b) => a.d - b.d || a.r.departure - b.r.departure);
  if (!hits.length) {
    out.replaceChildren(h('p', { class: 'empty', text: t.noResults }));
    return;
  }
  out.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'table-wrap' },
    h('table', {}, tableHead(true), h('tbody', {}, hits.slice(0, 150).map(({ r, tour }) => signRow(r, '', tour)))))));
}

/* ---------- Ziele & Routen (geht auch nur mit der Hof-Datei) ---------- */

function renderCodes() {
  const out = $('#code-results');
  const hof = state.model.hof;
  const q = norm($('#code-search').value);
  const termName = new Map(hof.termini.map((x) => [x.code, x.name]));
  const termini = hof.termini.filter((x) => !q || String(x.code).includes(q) || norm(x.name).includes(q));
  const routes = hof.trips.filter((x) => !q || String(x.code).includes(q) || norm(x.line) === q || norm(x.name).includes(q)
    || norm(termName.get(x.terminus)).includes(q) || x.stops.some((s) => norm(s).includes(q)));
  const lim = state.codeLimit;
  const more = (n) => n > lim ? h('button', { type: 'button', class: 'btn link more', text: t.showMore(n - lim), onclick: () => { state.codeLimit += 400; renderCodes(); } }) : null;

  out.replaceChildren(h('div', { class: 'cols' },
    h('div', { class: 'card' }, h('h3', { text: `${t.termini} (${termini.length})` }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: t.code }), h('th', { text: t.name }))),
        h('tbody', {}, termini.slice(0, lim).map((x) => h('tr', {},
          h('td', {}, h('span', { class: 'lcd', text: String(x.code) })),
          h('td', { text: x.name.replace(/\s{2,}/g, ' · ') })))))),
      more(termini.length)),
    h('div', { class: 'card' }, h('h3', { text: `${t.routes} (${routes.length})` }),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', { text: t.line }), h('th', { text: t.route }), h('th', { text: t.destination }), h('th', { text: `${t.from} → ${t.to}` }))),
        h('tbody', {}, routes.slice(0, lim).map((x) => h('tr', {},
          h('td', { class: 'ibis' }, h('span', { class: 'lcd', text: x.line })),
          h('td', { class: 'ibis' }, h('span', { class: 'lcd', text: String(routeOf(x)).padStart(2, '0') }), h('span', { class: 'sub', text: String(x.code) })),
          h('td', { class: 'ibis' }, h('span', { class: 'lcd', text: String(x.terminus) }), h('span', { class: 'sub', text: (termName.get(x.terminus) ?? '').replace(/\s{2,}/g, ' · ') })),
          h('td', { class: 'place' }, x.stops[0] ?? x.name, h('span', { class: 'sub', text: `→ ${x.stops[x.stops.length - 1] ?? ''} · ${x.stops.length} ${t.stops}` }))))))),
      more(routes.length))));
}

/* ---------- Beispielkarte ---------- */

async function loadDemo() {
  const base = 'tests/fixtures/';
  const manifest = await (await fetch(`${base}manifest.json`)).json();
  const entries = await Promise.all(manifest.files.map(async (path) => {
    const buf = await (await fetch(base + path.split('/').map(encodeURIComponent).join('/'))).arrayBuffer();
    return { path, file: new File([buf], path.split('/').pop()) };
  }));
  await handleEntries(entries);
}

/* ---------- Ereignisse ---------- */

function bind() {
  $('#lang-toggle').addEventListener('click', () => {
    state.lang = state.lang === 'de' ? 'en' : 'de';
    try { localStorage.setItem('lang', state.lang); } catch { /* egal */ }
    applyLang();
  });

  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    $('#progress').hidden = false;
    $('#progress').textContent = t.loading;
    await handleEntries(await entriesFromDrop(e.dataTransfer));
  });
  // Auch außerhalb der Fläche fallen lassen, ohne dass der Browser die Datei öffnet
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('#pick-folder').addEventListener('change', (e) => handleEntries(entriesFromInput(e.target.files)));
  $('#pick-files').addEventListener('change', (e) => handleEntries(entriesFromInput(e.target.files)));
  $('#demo').addEventListener('click', loadDemo);

  $('#map-select').addEventListener('change', (e) => { state.mapIdx = Number(e.target.value); state.hofIdx = 0; fillHofSelect(); reload(); });
  $('#hof-select').addEventListener('change', (e) => { state.hofIdx = Number(e.target.value); reload(); });

  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => { state.tab = b.dataset.tab; renderTabs(); });
  }
  for (const id of ['#tour-search', '#tour-day', '#tour-school']) $(id).addEventListener('input', renderTourList);
  for (const id of ['#find-time', '#find-stop', '#find-tol', '#find-day']) $(id).addEventListener('input', renderFind);
  $('#code-search').addEventListener('input', () => { state.codeLimit = 200; renderCodes(); });
}

bind();
applyLang();
