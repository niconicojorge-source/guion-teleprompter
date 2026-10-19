// El ?v= de cada import hace que una versión nunca se mezcle con archivos viejos en caché.
import { loadScripts, saveScripts, loadSettings, saveSettings, defaultSettings, LAYOUT_KEYS, uid } from './store.js?v=1.8';
import { norm } from './matcher.js?v=1.8';
import { VoiceFollower, voiceSupported, voiceLog } from './voice.js?v=1.8';
import { openCamera, Recorder, pickMime } from './camera.js?v=1.8';

const VERSION = '1.8';

// ---------- Utilidades ----------
const $ = (s, root = document) => root.querySelector(s);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const svg = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const ICONS = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  restart: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v3.8h3.8"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8.5 5.5v13M15.5 5.5v13"/>', 'stroke-width="3"'),
  sliders: svg('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  more: svg('<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>', 'stroke="none"'),
  import: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/>'),
  chevron: svg('<path d="M9.5 6l6 6-6 6"/>'),
};

const fold = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const countWords = (t) => (t.match(/\S+/g) || []).length;
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'guion';
const pad = (n) => String(n).padStart(2, '0');
const fmtClock = (sec) => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec % 60))}`;
function fmtDuration(words) {
  const s = Math.round((words / 140) * 60);
  return s < 60 ? `~${s} s` : `~${Math.floor(s / 60)}:${pad(s % 60)} min`;
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Hojas (bottom sheets) ----------
const openSheets = [];
function sheet(build, { clear = false, dismissable = true, onClose } = {}) {
  const sh = h('div', { class: 'sheet', role: 'dialog' }, h('div', { class: 'grabber' }));
  const bd = h('div', { class: 'backdrop' + (clear ? ' clear' : '') }, sh);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    bd.remove();
    openSheets.splice(openSheets.indexOf(close), 1);
    onClose?.();
  };
  close.dismissable = dismissable;
  if (dismissable) bd.addEventListener('click', (e) => { if (e.target === bd) close(); });
  build(sh, close);
  document.body.append(bd);
  openSheets.push(close);
  return close;
}

function actionSheet(title, actions) {
  sheet((sh, close) => {
    if (title) sh.append(h('h2', {}, title));
    sh.append(h('div', { class: 'sheet-actions' },
      actions.map((a) => h('button', { class: 'btn' + (a.danger ? ' danger' : ''), onclick: () => { close(); a.run(); } }, a.label)),
      h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
  });
}

function confirmSheet(msg, okLabel) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((sh, close) => {
      sh.append(h('p', { class: 'msg' }, msg), h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn danger', onclick: () => { answered = true; close(); resolve(true); } }, okLabel),
        h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
    }, { onClose: () => { if (!answered) resolve(false); } });
  });
}

// ---------- Datos ----------
let scripts = loadScripts();
let settings = loadSettings();
let currentView = null;

const persist = () => saveScripts(scripts);
const getScript = (id) => scripts.find((s) => s.id === id);
const categories = () => [...new Set(scripts.map((s) => (s.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type.split(';')[0] });
  if (navigator.canShare?.({ files: [file] })) {
    return navigator.share({ files: [file], title }).catch((e) => { if (e.name !== 'AbortError') download(blob, name); });
  }
  download(blob, name);
  return Promise.resolve();
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- Navegación ----------
function go(path) { location.hash = path; }

// A dónde vuelve un guion al cerrarlo: el día de su nicho, o "Otros guiones" si no tiene fecha.
const homeOf = (s) => (s?.date ? `${nicheBase(nicheKey(s.category))}/${s.date.split('-').join('/')}` : scripts.some((x) => x.date) ? '/o' : '/');

function route() {
  const [, view, ...rest] = (location.hash.slice(1) || '/').split('/');
  const id = rest[0];
  // Si se está grabando, no dejamos que un "atrás" corte la toma.
  if (currentView === 'prompter' && P.recording && !(view === 'read' && id === P.id)) {
    go('/read/' + P.id);
    stopRecording();
    return;
  }
  if (view === 'edit' && getScript(id)) return showEditor(id);
  if (view === 'read' && getScript(id)) return showPrompter(id);
  if (view === 'n') return showLibrary({ niche: decodeURIComponent(rest[0] || '_'), parts: rest.slice(1).filter(Boolean) });
  if (view === 'o') return showLibrary({ other: true });
  showLibrary();
}

function setView(name) {
  if (currentView === 'editor' && name !== 'editor') leaveEditor();
  if (currentView === 'prompter' && name !== 'prompter') closePrompter();
  while (openSheets.length) openSheets[openSheets.length - 1]();
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  currentView = name;
}

// ---------- Biblioteca: calendario de producción (Nicho → Año → Mes → Día) ----------
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
// niche: clave del nicho (la categoría; '_' = sin nicho) · parts: [] | [año] | [año, mes] | [año, mes, día]
// other: lista de guiones sin fecha.
let lib = { niche: null, parts: [], other: false };

const nicheKey = (cat) => (cat || '').trim() || '_';
const nicheName = (key) => (key === '_' ? 'Sin nicho' : key);
const nicheBase = (key) => '/n/' + encodeURIComponent(key);
const currentNiche = () => (lib.niche && lib.niche !== '_' ? lib.niche : '');

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(iso, withMonth = false) {
  const [y, m, d] = iso.split('-').map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString('es-AR', withMonth ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const shortDate = (iso) => (iso ? new Date(iso + 'T12:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : '—');
const folderLabel = (parts) => (parts.length === 1 ? parts[0] : parts.length === 2 ? `${MONTHS[Number(parts[1]) - 1]} ${parts[0]}` : dayLabel(parts.join('-')));
const crumbLabel = (parts) => (parts.length === 2 ? MONTHS[Number(parts[1]) - 1] : folderLabel(parts));
const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '') || (a.code || '').localeCompare(b.code || '');

function groupBy(list, keyOf) {
  const groups = new Map();
  for (const s of list) {
    const k = keyOf(s);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  return groups;
}

function showLibrary(state = {}) {
  setView('library');
  lib = { niche: state.niche ?? null, parts: state.parts || [], other: !!state.other };
  renderLibrary();
}

function renderLibrary() {
  $('#version').textContent = `Guion v${VERSION}` + (voiceSupported ? '' : ' · sin reconocimiento de voz en este navegador');
  const q = fold($('#search').value.trim());
  const { niche, parts, other } = lib;
  const dated = scripts.filter((s) => s.date);
  const undated = scripts.filter((s) => !s.date).sort((a, b) => b.updatedAt - a.updatedAt);

  $('#lib-title').textContent = other ? 'Otros guiones'
    : niche != null ? (parts.length ? folderLabel(parts) : nicheName(niche))
      : dated.length ? 'Producción' : 'Guion';
  renderBack();

  const pool = other ? undated : niche != null ? dated.filter((s) => nicheKey(s.category) === niche) : scripts;
  const items = [];

  if (q) {
    pool.filter((s) => fold(`${s.title} ${s.code || ''} ${s.text}`).includes(q)).sort(byDate)
      .forEach((s) => items.push(card(s, true)));
  } else if (other || (niche == null && !dated.length)) {
    undated.forEach((s) => items.push(card(s)));
  } else if (niche == null) {
    // Inicio: un panel por nicho.
    items.push(h('li', { class: 'group' }, 'Elegí el nicho'));
    // Mismo orden que en el Excel (el orden en que se importaron).
    for (const [key, list] of groupBy(dated, (s) => nicheKey(s.category))) {
      items.push(nicheTile(key, list));
    }
    if (undated.length) items.push(nicheTile(null, undated));
  } else {
    const base = nicheBase(niche);
    const [y, m, d] = parts;
    if (d) {
      pool.filter((s) => s.date === `${y}-${m}-${d}`).sort(byDate).forEach((s) => items.push(card(s)));
    } else if (m) {
      const month = pool.filter((s) => s.date.startsWith(`${y}-${m}-`));
      items.push(calendar(Number(y), Number(m), month, `${base}/${y}/${m}`));
    } else if (y) {
      const groups = groupBy(pool.filter((s) => s.date.startsWith(y + '-')), (s) => s.date.slice(5, 7));
      for (const mm of [...groups.keys()].sort()) {
        items.push(folderRow({ label: MONTHS[Number(mm) - 1], path: `${base}/${y}/${mm}`, list: groups.get(mm) }));
      }
    } else {
      const t = todayISO();
      const todays = pool.filter((s) => s.date === t);
      if (todays.length) items.push(folderRow({ label: 'Hoy · ' + dayLabel(t, true), path: `${base}/${t.split('-').join('/')}`, list: todays, dots: true, today: true }));
      const groups = groupBy(pool, (s) => s.date.slice(0, 4));
      for (const yy of [...groups.keys()].sort()) items.push(folderRow({ label: yy, path: `${base}/${yy}`, list: groups.get(yy) }));
    }
  }
  $('#script-list').replaceChildren(...items);

  const empty = $('#empty');
  empty.hidden = items.length > 0;
  empty.textContent = q ? 'No hay guiones que coincidan.'
    : scripts.length ? 'No hay guiones acá.' : 'Todavía no tenés guiones. Creá uno o importá tu Excel.';
}

// Botón "‹ Atrás": vuelve al nivel anterior y muestra su nombre.
function renderBack() {
  const btn = $('#lib-back');
  const { niche, parts, other } = lib;
  btn.hidden = niche == null && !other;
  if (btn.hidden) return;
  const trail = [['Inicio', '/']];
  if (other) trail.push(['Otros guiones', null]);
  else {
    trail.push([nicheName(niche), nicheBase(niche)]);
    parts.forEach((_, i) => trail.push([crumbLabel(parts.slice(0, i + 1)), `${nicheBase(niche)}/${parts.slice(0, i + 1).join('/')}`]));
  }
  const [label, path] = trail[trail.length - 2];
  btn.textContent = '‹ ' + label;
  btn.onclick = () => { $('#search').value = ''; go(path); };
}

function progress(list) {
  const done = list.filter((s) => s.done).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

function nicheTile(key, list) {
  const p = progress(list);
  const t = todayISO();
  const today = key == null ? [] : list.filter((s) => s.date === t);
  const tp = progress(today);
  return h('li', { class: 'niche' + (key == null ? ' other' : '') },
    h('button', { onclick: () => go(key == null ? '/o' : nicheBase(key)) },
      h('span', { class: 'n-main' },
        h('span', { class: 'n-name' }, key == null ? 'Otros guiones' : nicheName(key)),
        h('span', { class: 'n-sub' }, key == null ? `${p.total} sin fecha` : `${p.total} guiones · ${p.done} hechos`),
        today.length ? h('span', { class: 'n-today' + (tp.done === tp.total ? ' all' : '') }, `Hoy: ${tp.done} de ${tp.total} hechos`) : null,
        key == null ? null : h('span', { class: 'meter wide' }, h('i', { style: `width:${p.pct}%` }))),
      h('span', { class: 'chev', html: ICONS.chevron })));
}

function folderRow({ label, path, list, dots, today }) {
  const p = progress(list);
  const bar = dots
    ? h('span', { class: 'dots' }, list.slice().sort(byDate).map((s) => h('i', { class: s.done ? 'ok' : '' })))
    : h('span', { class: 'meter' }, h('i', { style: `width:${p.pct}%` }));
  return h('li', { class: 'folder' + (today ? ' today' : '') },
    h('button', { onclick: () => go(path) },
      h('span', { class: 'f-main' },
        h('span', { class: 'f-name' }, label),
        h('span', { class: 'f-sub' + (p.done === p.total ? ' all' : '') }, `${p.done} de ${p.total} hechos`)),
      bar,
      h('span', { class: 'chev', html: ICONS.chevron })));
}

// Mes como calendario: cada día con guiones muestra un punto por guion (verde = hecho).
function calendar(y, m, list, base) {
  const byDay = groupBy(list, (s) => s.date);
  const t = todayISO();
  const cells = [];
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // semana empieza el lunes
  for (let i = 0; i < lead; i++) cells.push(h('span', { class: 'cal-day blank' }));
  const days = new Date(y, m, 0).getDate();
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const items = (byDay.get(iso) || []).sort(byDate);
    const cls = 'cal-day' + (iso === t ? ' today' : '');
    if (!items.length) { cells.push(h('span', { class: cls + ' off' }, h('b', {}, d))); continue; }
    const p = progress(items);
    cells.push(h('button', { class: cls + (p.done === p.total ? ' all' : ''), 'aria-label': `${dayLabel(iso)}: ${p.done} de ${p.total} hechos`, onclick: () => go(`${base}/${pad(d)}`) },
      h('b', {}, d),
      h('span', { class: 'dots' }, items.map((s) => h('i', { class: s.done ? 'ok' : '' })))));
  }
  const p = progress(list);
  return h('li', { class: 'cal-wrap' },
    h('div', { class: 'cal-head' }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => h('span', {}, x))),
    h('div', { class: 'cal' }, cells),
    h('p', { class: 'cal-sum' + (p.done === p.total ? ' all' : '') }, `${p.done} de ${p.total} guiones hechos este mes`));
}

function setDone(s, value) {
  s.done = value;
  persist();
}

function statusBtn(s, after = renderLibrary) {
  return h('button', {
    class: 'status' + (s.done ? ' ok' : ''),
    'aria-label': s.done ? 'Hecho (tocá para marcar pendiente)' : 'Pendiente (tocá para marcar hecho)',
    onclick: () => { setDone(s, !s.done); after(); },
  }, h('i'));
}

function card(s, showDate = false) {
  const w = countWords(s.text);
  const hook = s.details?.find(([k]) => k.startsWith('Gancho'))?.[1];
  const meta = [showDate && s.date ? dayLabel(s.date, true) : null, s.time, s.code, s.category, fmtDuration(w)];
  return h('li', { class: 'card' + (s.done ? ' done' : '') },
    statusBtn(s),
    h('button', { class: 'card-main', onclick: () => go('/edit/' + s.id) },
      h('h3', {}, s.title || 'Sin título'),
      h('p', {}, hook || s.text.trim().slice(0, 180) || 'Vacío'),
      h('span', { class: 'meta' }, meta.filter(Boolean).join(' · '))),
    h('button', { class: 'card-act play', 'aria-label': 'Leer', html: ICONS.play, onclick: () => readScript(s.id) }),
    h('button', { class: 'card-act', 'aria-label': 'Más opciones', html: ICONS.more, onclick: () => scriptMenu(s.id) }));
}

function readScript(id) {
  const s = getScript(id);
  if (!s || !s.text.trim()) { toast('Este guion está vacío. Escribí algo primero.'); return; }
  go('/read/' + id);
}

function scriptMenu(id, fromEditor = false) {
  const s = getScript(id);
  if (!s) return;
  actionSheet(s.title || 'Sin título', [
    { label: 'Leer en el teleprompter', run: () => readScript(id) },
    { label: s.done ? 'Marcar como pendiente' : 'Marcar como hecho', run: () => { setDone(s, !s.done); if (fromEditor) edStatus(); else renderLibrary(); } },
    {
      label: 'Duplicar',
      run: () => {
        const now = Date.now();
        const copy = { ...s, id: uid(), title: (s.title || 'Sin título') + ' (copia)', code: '', source: '', done: false, createdAt: now, updatedAt: now };
        scripts.unshift(copy);
        persist();
        if (fromEditor) go('/edit/' + copy.id); else renderLibrary();
      },
    },
    { label: 'Exportar como .txt', run: () => shareOrDownload(new Blob([s.text], { type: 'text/plain' }), slug(s.title) + '.txt', s.title) },
    {
      label: 'Eliminar',
      danger: true,
      run: async () => {
        if (!(await confirmSheet('¿Eliminar este guion? No se puede deshacer.', 'Eliminar'))) return;
        scripts = scripts.filter((x) => x.id !== id);
        persist();
        if (fromEditor) { editId = null; go(homeOf(s)); } else renderLibrary();
      },
    },
  ]);
}

function newScript() {
  const now = Date.now();
  const date = lib.parts.length === 3 ? lib.parts.join('-') : '';
  const s = { id: uid(), title: '', category: currentNiche(), text: '', date, done: false, createdAt: now, updatedAt: now };
  scripts.unshift(s);
  persist();
  go('/edit/' + s.id);
}

async function importFiles(files) {
  const excel = files.filter((f) => /\.xlsx$/i.test(f.name));
  const texts = files.filter((f) => !/\.xlsx$/i.test(f.name));
  if (texts.length) {
    const date = lib.parts.length === 3 ? lib.parts.join('-') : '';
    for (const f of texts) {
      const now = Date.now();
      const text = (await f.text()).replace(/\r\n?/g, '\n');
      scripts.unshift({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), category: currentNiche(), text, date, done: false, createdAt: now, updatedAt: now });
    }
    persist();
    renderLibrary();
    toast(texts.length === 1 ? 'Guion importado' : `${texts.length} guiones importados`);
  }
  for (const f of excel) await importExcel(f);
}

// Los guiones del Excel se identifican por línea + código: si importás de nuevo
// una versión actualizada, se actualizan en vez de duplicarse y conservan su estado.
const excelKey = (line, code, date, time, title) => (code ? `${line}|${code}` : `${line}|${date}|${time}|${title}`);

async function importExcel(file) {
  toast('Leyendo el Excel…', 15000);
  let rows;
  try {
    const { readWorkbook, scriptsFromWorkbook } = await import('./xlsx.js?v=1.8');
    rows = scriptsFromWorkbook(await readWorkbook(file));
  } catch (e) {
    toast('No pude leer el Excel: ' + e.message, 6000);
    return;
  }
  $('#toast').hidden = true;
  if (!rows.length) { toast('No encontré ninguna columna "Guion" en ese Excel.', 6000); return; }

  const existing = new Map(scripts.filter((s) => s.source === 'excel').map((s) => [excelKey(s.category, s.code, s.date, s.time, s.title), s]));
  const lines = {};
  let updates = 0;
  for (const r of rows) {
    const b = (lines[r.line] ||= { n: 0, from: '', to: '' });
    b.n++;
    if (r.date && (!b.from || r.date < b.from)) b.from = r.date;
    if (r.date > b.to) b.to = r.date;
    if (existing.has(excelKey(r.line, r.code, r.date, r.time, r.title))) updates++;
  }
  const done = rows.filter((r) => r.done).length;
  sheet((sh, close) => {
    sh.append(
      h('h2', {}, 'Importar Excel'),
      h('p', { class: 'msg' }, `Encontré ${rows.length} guiones en "${file.name}":`),
      h('ul', { class: 'import-sum' }, Object.entries(lines).map(([l, b]) => h('li', {}, h('strong', {}, l), ` · ${b.n} guiones · ${shortDate(b.from)} → ${shortDate(b.to)}`))),
      h('p', { class: 'info' }, [
        'Se ordenan en carpetas por año, mes y día.',
        done ? `${done} figuran como publicados y entran en verde.` : '',
        updates ? `${updates} ya estaban en la app: se actualizan y conservan su estado.` : '',
      ].filter(Boolean).join(' ')),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: () => { close(); applyImport(rows, existing); } }, `Importar ${rows.length} guiones`),
        h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
  });
}

function applyImport(rows, existing) {
  const now = Date.now();
  let added = 0;
  for (const r of rows) {
    const data = { title: r.title, category: r.line, text: r.text, date: r.date, time: r.time, code: r.code, details: r.details, source: 'excel', updatedAt: now };
    const s = existing.get(excelKey(r.line, r.code, r.date, r.time, r.title));
    if (s) Object.assign(s, data, { done: s.done || r.done });
    else { scripts.push({ id: uid(), createdAt: now, done: r.done, ...data }); added++; }
  }
  if (!persist()) toast('No hay espacio para guardar todo en este dispositivo.', 6000);
  else toast(`Listo: ${added} guiones nuevos${rows.length - added ? ` y ${rows.length - added} actualizados` : ''}.`, 4000);
  if ((location.hash || '#/') === '#/') showLibrary(); else go('/');
}

// ---------- Editor ----------
let editId = null;
let saveTimer = 0;

function showEditor(id) {
  setView('editor');
  editId = id;
  const s = getScript(id);
  $('#ed-title').value = s.title;
  $('#ed-cat').value = s.category || '';
  $('#ed-text').value = s.text;
  $('#cat-list').replaceChildren(...categories().map((c) => h('option', { value: c })));
  const info = [s.date ? dayLabel(s.date, true) : null, s.time, s.code].filter(Boolean).join(' · ');
  $('#ed-info').textContent = info;
  $('#ed-info').hidden = !info;
  const details = s.details || [];
  $('#ed-details').hidden = !details.length;
  $('#ed-dl').replaceChildren(...details.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  edStatus();
  edStats();
  if (!s.title && !s.text) setTimeout(() => $('#ed-text').focus(), 60);
}

function edStatus() {
  const s = getScript(editId);
  if (!s) return;
  const b = $('#ed-status');
  b.classList.toggle('ok', !!s.done);
  b.textContent = s.done ? 'Hecho' : 'Pendiente';
}

function edInput() {
  const s = getScript(editId);
  if (!s) return;
  s.title = $('#ed-title').value;
  s.category = $('#ed-cat').value.trim();
  s.text = $('#ed-text').value;
  s.updatedAt = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 300);
  edStats();
}

function edStats() {
  const w = countWords($('#ed-text').value);
  $('#ed-stats').textContent = `${w} palabras · ${fmtDuration(w)} a ritmo normal`;
}

function leaveEditor() {
  clearTimeout(saveTimer);
  const s = getScript(editId);
  if (s && !s.title.trim() && !s.text.trim()) scripts = scripts.filter((x) => x !== s);
  persist();
  editId = null;
}

// ---------- Teleprompter ----------
const P = {
  id: null, mode: 'voice', playing: false, recording: false, counting: false,
  y: 0, targetY: null, pos: -1, painted: -1, words: [], els: [],
  voice: null, stream: null, hasAudio: false, recorder: null,
  touching: false, fingerDown: false, manualTimer: 0,
  heardAny: false, watchdog: 0,
  raf: 0, last: 0, wake: null, cdTimer: 0, recTimer: 0, recStart: 0,
  errAt: {},
};

const scroller = () => $('#scroller');
const readPx = () => $('#text-box').clientHeight * (settings.readPos / 100);

function showPrompter(id) {
  setView('prompter');
  P.id = id;
  renderScript(getScript(id).text);
  P.pos = -1; P.painted = -1; P.y = 0; P.targetY = 0;
  scroller().scrollTop = 0;
  applySettings();
  setMode(settings.mode, true);
  if (settings.camera) startCamera(); else $('#frame').hidden = true;
  requestWake();
  P.last = performance.now();
  cancelAnimationFrame(P.raf);
  P.raf = requestAnimationFrame(tick);
  updateButtons();
}

function closePrompter() {
  cancelCountdown();
  stopPrompting();
  if (P.recording) { P.recording = false; clearInterval(P.recTimer); P.recorder?.stop(); }
  stopCamera();
  cancelAnimationFrame(P.raf);
  try { P.wake?.release(); } catch { /* nada */ }
  P.wake = null;
  P.voice = null;
  $('#heard').hidden = true;
  $('#rec-time').hidden = true;
}

function renderScript(text) {
  const root = $('#script');
  root.replaceChildren();
  P.words = [];
  P.els = [];
  for (const line of text.split('\n')) {
    const p = document.createElement('p');
    if (!line.trim()) { p.className = 'gap'; root.append(p); continue; }
    const toks = line.trim().split(/\s+/);
    // El número de toma ("1.") y las indicaciones entre ( ) o [ ] no se dicen:
    // se muestran atenuadas y el seguimiento de voz no las espera.
    // Una toma que empieza con "(Pregunta en off)" la dice otra persona: va entera atenuada.
    const offLine = /^(\d+[.)]\s*)?\([^)]*\b(off|pregunta)\b[^)]*\)/i.test(line.trim());
    let aside = false;
    toks.forEach((tok, k) => {
      const sp = document.createElement('span');
      sp.textContent = tok;
      if (/^[([]/.test(tok) || (offLine && k > 0)) aside = true;
      if (k === 0 && /^\d+[.)]$/.test(tok)) sp.className = 'w num';
      else if (aside) sp.className = 'w aside';
      else {
        sp.className = 'w';
        const n = norm(tok);
        if (n) { sp.dataset.i = P.words.length; P.words.push(n); P.els.push(sp); }
      }
      if (aside && !offLine && /[)\]][.,;:!?"»]*$/.test(tok)) aside = false;
      p.append(sp);
      if (k < toks.length - 1) p.append(' ');
    });
    root.append(p);
  }
}

function paint(pos) {
  const old = P.painted;
  if (pos > old) for (let k = Math.max(0, old + 1); k <= pos; k++) P.els[k]?.classList.add('read');
  else for (let k = Math.max(0, pos + 1); k <= old; k++) P.els[k]?.classList.remove('read');
  P.els[old]?.classList.remove('cur');
  P.els[pos]?.classList.add('cur');
  P.painted = pos;
}

function targetFor(pos) {
  const idx = Math.min(pos + 1, P.els.length - 1);
  return idx >= 0 ? Math.max(0, P.els[idx].offsetTop - readPx()) : 0;
}

function setPos(pos, fromUser = false) {
  P.pos = pos;
  paint(pos);
  P.targetY = targetFor(pos);
  if (fromUser) {
    if (P.voice) { P.voice.pos = pos; P.voice.resetSession(); }
    if (P.mode !== 'voice') { P.y = P.targetY; scroller().scrollTop = P.y; }
  }
}

function tick(t) {
  const dt = Math.min(0.05, (t - P.last) / 1000);
  P.last = t;
  const sc = scroller();
  if (!P.touching) {
    if (P.mode === 'auto' && P.playing) {
      const max = sc.scrollHeight - sc.clientHeight;
      P.y = Math.min(max, P.y + settings.speed * settings.fontSize * 0.12 * dt);
      sc.scrollTop = P.y;
    } else if (P.mode === 'voice' && P.targetY != null) {
      // Solo se mueve hacia palabras reconocidas del guion (nada de adelantarse por tiempo).
      const d = P.targetY - P.y;
      if (Math.abs(d) > 0.5) {
        P.y += d * (1 - Math.exp(-dt * 9));
        sc.scrollTop = P.y;
      }
    }
  }
  P.raf = requestAnimationFrame(tick);
}

// Primera palabra cuya línea está en (o debajo de) la línea de lectura.
function wordAtReadingLine() {
  const y = scroller().scrollTop + readPx();
  for (let i = 0; i < P.els.length; i++) {
    const el = P.els[i];
    if (el.offsetTop + el.offsetHeight > y) return i;
  }
  return P.els.length - 1;
}

// Al terminar un desplazamiento con el dedo, el teleprompter sigue desde ahí.
function manualScrollEnded() {
  P.touching = false;
  P.y = scroller().scrollTop;
  if (P.mode === 'voice') setPos(wordAtReadingLine() - 1, true);
}

function scheduleManualEnd() {
  clearTimeout(P.manualTimer);
  P.manualTimer = setTimeout(manualScrollEnded, 220);
}

function setMode(mode, initial = false) {
  if (mode === 'voice' && !voiceSupported) {
    toast('Este navegador no tiene reconocimiento de voz, así que pasé a modo Auto. Abrí la app en Safari.', 6000);
    mode = 'auto';
  }
  const was = P.mode;
  P.mode = mode;
  settings.mode = mode;
  saveSettings(settings);
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  P.y = scroller().scrollTop;

  if (mode === 'voice' && (was !== 'voice' || initial)) {
    if (!initial) setPos(wordAtReadingLine() - 1);
  }
  if (P.playing && was !== mode) {
    if (was === 'voice') stopVoice();
    if (mode === 'voice') startVoice();
    if (mode === 'manual') P.playing = false;
  }
  updateButtons();
}

function voiceError(code) {
  const now = Date.now();
  if (now - (P.errAt[code] || 0) < 6000) return;
  P.errAt[code] = now;
  const msgs = {
    'not-allowed': 'Sin permiso para el micrófono o el reconocimiento de voz.',
    'service-not-allowed': 'El reconocimiento de voz está bloqueado. En iPhone activá Siri y Dictado (Ajustes > Siri).',
    'audio-capture': 'No pude usar el micrófono para seguir tu voz.',
    'network': 'El reconocimiento de voz necesita conexión a internet.',
    'language-not-supported': 'Ese idioma no está disponible para el reconocimiento de voz.',
  };
  const msg = msgs[code] || `Error de voz: ${code}`;
  toast(msg, 5000);
  showStatus('⚠︎ ' + msg);
}

// Mensaje en la burbuja de estado, aunque "Mostrar lo que escucho" esté apagado.
function showStatus(text) {
  const el = $('#heard');
  el.textContent = text;
  el.hidden = false;
}

function startVoice() {
  if (!voiceSupported) return;
  if (!P.voice) {
    P.voice = new VoiceFollower({
      onMove: (p) => setPos(p),
      onHeard: (t) => showHeard(t),
      onError: voiceError,
    });
  }
  Object.assign(P.voice, { lang: settings.lang, words: P.words, pos: P.pos });
  P.voice.start();
  showHeard('Escuchando…');
  // Si en unos segundos no llegó nada del reconocimiento, avisamos en pantalla.
  P.heardAny = false;
  clearTimeout(P.watchdog);
  P.watchdog = setTimeout(() => {
    if (P.mode === 'voice' && P.voice?.active && !P.heardAny) {
      showStatus('⚠︎ No me llega nada del reconocimiento de voz. Revisá Siri y Dictado y el permiso de micrófono.');
    }
  }, 7000);
}

function stopVoice() {
  clearTimeout(P.watchdog);
  P.voice?.stop();
  $('#heard').hidden = true;
}

function showHeard(text) {
  if (text !== 'Escuchando…') P.heardAny = true;
  const el = $('#heard');
  if (!settings.showHeard) { el.hidden = true; return; }
  const t = text.trim();
  el.textContent = t.length > 70 ? '…' + t.slice(-70) : t || 'Escuchando…';
  el.hidden = false;
}

function startPrompting() {
  if (P.mode === 'manual') return;
  P.playing = true;
  P.y = scroller().scrollTop;
  if (P.mode === 'voice') { startVoice(); P.voice && (P.voice.paused = false); }
  updateButtons();
}

function stopPrompting() {
  P.playing = false;
  stopVoice();
  updateButtons();
}

function togglePlay() {
  if (P.playing) stopPrompting(); else startPrompting();
}

function restart() {
  P.pos = -1;
  paint(-1);
  P.y = 0;
  P.targetY = 0;
  scroller().scrollTop = 0;
  if (P.voice) { P.voice.pos = -1; P.voice.resetSession(); }
}

function updateButtons() {
  const play = $('#pr-play');
  play.innerHTML = P.playing ? ICONS.pause : ICONS.play;
  play.classList.toggle('ghost', P.mode === 'manual');
  const rec = $('#pr-rec');
  rec.classList.toggle('on', P.recording);
  rec.classList.toggle('counting', P.counting);
  rec.setAttribute('aria-label', P.recording ? 'Detener grabación' : 'Grabar');
}

// ---------- Cámara y grabación ----------
async function startCamera() {
  if (P.stream) return true;
  try {
    const { stream, audio } = await openCamera();
    if (currentView !== 'prompter' || !settings.camera) { stream.getTracks().forEach((t) => t.stop()); return false; }
    P.stream = stream;
    P.hasAudio = audio;
    if (!audio) toast('Sin micrófono: el video se va a grabar sin sonido.', 5000);
    const v = $('#cam');
    v.srcObject = stream;
    v.onloadedmetadata = () => { layoutFrame(); v.play().catch(() => {}); };
    $('#frame').hidden = false;
    return true;
  } catch (e) {
    const msgs = {
      NotAllowedError: 'Permiso de cámara denegado. En iPhone: Ajustes > Safari > Cámara > Permitir.',
      NotFoundError: 'No encontré ninguna cámara.',
      NotReadableError: 'La cámara está siendo usada por otra app.',
    };
    toast(msgs[e.name] || e.message || 'No pude abrir la cámara.', 6000);
    return false;
  }
}

function stopCamera() {
  P.stream?.getTracks().forEach((t) => t.stop());
  P.stream = null;
  $('#cam').srcObject = null;
  $('#frame').hidden = true;
}

function cameraLost() {
  return !P.stream || P.stream.getVideoTracks().every((t) => t.readyState === 'ended');
}

async function onRecord() {
  if (P.recording) return stopRecording();
  if (P.counting) { cancelCountdown(); stopPrompting(); return; }
  if (!settings.camera) { toast('Activá la cámara en Ajustes para grabar.'); return; }
  if (cameraLost()) {
    stopCamera();
    if (!(await startCamera())) return;
  }
  // La voz arranca ya (iOS exige que sea dentro del toque), pero en pausa hasta que termine la cuenta.
  if (P.mode === 'voice') { startVoice(); P.voice && (P.voice.paused = true); }
  startCountdown(Number(settings.countdown) || 0, beginRecording);
}

function startCountdown(n, done) {
  if (!n) { done(); return; }
  const el = $('#countdown');
  let k = n;
  el.textContent = k;
  el.hidden = false;
  P.counting = true;
  updateButtons();
  P.cdTimer = setInterval(() => {
    k--;
    if (k <= 0) { cancelCountdown(); done(); } else el.textContent = k;
  }, 1000);
}

function cancelCountdown() {
  clearInterval(P.cdTimer);
  P.counting = false;
  $('#countdown').hidden = true;
  updateButtons();
}

function beginRecording() {
  try {
    P.recorder = new Recorder(P.stream);
    P.recorder.start();
  } catch (e) {
    toast('No pude iniciar la grabación: ' + e.message, 6000);
    stopPrompting();
    return;
  }
  P.recording = true;
  P.recStart = performance.now();
  const rt = $('#rec-time');
  rt.textContent = '00:00';
  rt.hidden = false;
  P.recTimer = setInterval(() => { rt.textContent = fmtClock((performance.now() - P.recStart) / 1000); }, 250);
  if (P.mode !== 'manual') {
    P.playing = true;
    P.y = scroller().scrollTop;
    if (P.mode === 'voice') { startVoice(); P.voice.paused = false; }
  }
  updateButtons();
}

async function stopRecording() {
  if (!P.recording) return;
  P.recording = false;
  clearInterval(P.recTimer);
  $('#rec-time').hidden = true;
  const duration = (performance.now() - P.recStart) / 1000;
  stopPrompting();
  const blob = await P.recorder.stop();
  P.recorder = null;
  if (!blob.size) { toast('La grabación quedó vacía. Probá de nuevo.'); return; }
  showTake(blob, duration);
}

function showTake(blob, duration) {
  const s = getScript(P.id);
  const ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
  const name = `${slug(s?.title || 'toma')}-${stamp()}.${ext}`;
  const url = URL.createObjectURL(blob);
  const canShare = !!navigator.canShare?.({ files: [new File([blob], name, { type: blob.type.split(';')[0] })] });
  let saved = false;

  sheet((sh, close) => {
    const askClose = async () => {
      if (saved || (await confirmSheet('No guardaste esta toma. ¿Descartarla?', 'Descartar'))) close();
    };
    sh.append(
      h('h2', {}, 'Tu toma'),
      h('video', { class: 'take-video', src: url, controls: true, playsinline: true }),
      h('p', { class: 'info' }, `${fmtClock(duration)} · ${(blob.size / 1048576).toFixed(1)} MB · ${ext.toUpperCase()}`),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: () => { saved = true; shareOrDownload(blob, name, s?.title); } },
          canShare ? 'Guardar en Fotos / Compartir' : 'Descargar video'),
        canShare ? h('button', { class: 'btn', onclick: () => { saved = true; download(blob, name); } }, 'Descargar archivo') : null,
        s && !s.done ? h('button', { class: 'btn ok', onclick: (e) => { setDone(s, true); e.currentTarget.textContent = '✓ Guion marcado como hecho'; e.currentTarget.disabled = true; } }, 'Marcar guion como hecho') : null,
        h('button', { class: 'btn', onclick: askClose }, saved ? 'Cerrar' : 'Cerrar sin guardar')));
  }, { dismissable: false, onClose: () => URL.revokeObjectURL(url) });
}

async function requestWake() {
  try { P.wake = await navigator.wakeLock?.request('screen'); } catch { /* no soportado */ }
}

// ---------- Ajustes ----------
const SAFE = {
  reels: { t: 14, b: 32, l: 6, r: 18, label: 'Reels' },
  tiktok: { t: 9, b: 22, l: 6, r: 15, label: 'TikTok' },
  shorts: { t: 10, b: 25, l: 6, r: 16, label: 'Shorts' },
};

const pct = (v) => v + '%';
const SETTINGS_UI = [
  { section: 'Texto' },
  { key: 'fontSize', label: 'Tamaño de letra', type: 'range', min: 11, max: 80, fmt: (v) => v + ' px' },
  { key: 'boxWidth', label: 'Ancho del texto', type: 'range', min: 20, max: 100, fmt: pct },
  { key: 'lines', label: 'Líneas visibles', type: 'range', min: 1, max: 15 },
  { key: 'readPos', label: 'Línea de lectura', type: 'range', min: 0, max: 70, fmt: pct },
  { key: 'margin', label: 'Márgenes', type: 'range', min: 0, max: 60, fmt: (v) => v + ' px' },
  { key: 'boxOpacity', label: 'Fondo del texto', type: 'range', min: 0, max: 100, fmt: pct },
  { key: 'speed', label: 'Velocidad (modo Auto)', type: 'range', min: 1, max: 20 },
  { key: 'mirrorText', label: 'Espejar texto (para vidrio)', type: 'switch' },
  { action: 'Restaurar tamaño y posición', run: resetLayout, reopen: true },
  { section: 'Cámara' },
  { key: 'camera', label: 'Mostrar cámara', type: 'switch' },
  { key: 'mirrorPreview', label: 'Vista previa en espejo', type: 'switch' },
  { key: 'faceGuide', label: 'Guía de cara', type: 'switch' },
  { key: 'safeZone', label: 'Zonas seguras', type: 'seg', options: [['none', 'No'], ['reels', 'Reels'], ['tiktok', 'TikTok'], ['shorts', 'Shorts']] },
  { key: 'countdown', label: 'Cuenta regresiva', type: 'seg', options: [[0, 'No'], [3, '3 s'], [5, '5 s'], [10, '10 s']] },
  { section: 'Voz' },
  {
    key: 'lang', label: 'Idioma', type: 'select',
    options: [['es-AR', 'Español (Argentina)'], ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['es-US', 'Español (EE. UU.)'], ['en-US', 'English (US)'], ['pt-BR', 'Português (Brasil)']],
  },
  { key: 'showHeard', label: 'Mostrar lo que escucho', type: 'switch' },
  { action: 'Copiar registro de voz (para diagnóstico)', run: copyVoiceLog },
];

function settingRow(f) {
  const v = settings[f.key];
  if (f.type === 'range') {
    const fmt = f.fmt || String;
    const out = h('output', {}, fmt(v));
    return h('label', { class: 'row' }, h('span', {}, f.label, out),
      h('input', {
        type: 'range', min: f.min, max: f.max, step: 1, value: v,
        oninput: (e) => { settings[f.key] = Number(e.target.value); out.textContent = fmt(settings[f.key]); changed(f.key); },
      }));
  }
  if (f.type === 'switch') {
    return h('label', { class: 'row' }, h('span', {}, f.label),
      h('input', { type: 'checkbox', class: 'switch', checked: !!v, onchange: (e) => { settings[f.key] = e.target.checked; changed(f.key); } }));
  }
  if (f.type === 'seg') {
    const seg = h('div', { class: 'seg' });
    for (const [val, lab] of f.options) {
      seg.append(h('button', {
        class: String(val) === String(v) ? 'on' : '',
        onclick: (e) => {
          settings[f.key] = val;
          [...seg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
          changed(f.key);
        },
      }, lab));
    }
    return h('div', { class: 'row col' }, h('span', {}, f.label), seg);
  }
  return h('label', { class: 'row' }, h('span', {}, f.label),
    h('select', { onchange: (e) => { settings[f.key] = e.target.value; changed(f.key); } },
      f.options.map(([val, lab]) => h('option', { value: val, selected: val === v }, lab))));
}

function infoText() {
  const v = $('#cam');
  const cam = P.stream && v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : '—';
  const mime = pickMime() || 'no disponible';
  return `Cámara: ${cam} · Micrófono: ${P.stream ? (P.hasAudio ? 'sí' : 'no') : '—'} · Formato: ${mime} · Voz: ${voiceSupported ? 'disponible' : 'no disponible'} · v${VERSION}`;
}

function openSettings() {
  sheet((sh, close) => {
    sh.append(h('h2', {}, 'Ajustes'));
    for (const f of SETTINGS_UI) {
      if (f.section) sh.append(h('h3', { class: 'sec' }, f.section));
      else if (f.action) sh.append(h('button', { class: 'link-btn', onclick: () => { f.run(); if (f.reopen) { close(); openSettings(); } } }, f.action));
      else sh.append(settingRow(f));
    }
    sh.append(h('p', { class: 'info' }, infoText()));
  }, { clear: true });
}

function copyVoiceLog() {
  const s = getScript(P.id);
  const text = [
    `Guion v${VERSION} · ${navigator.userAgent}`,
    `Modo: ${P.mode} · Idioma: ${settings.lang} · Palabras del guion: ${P.words.length} · Posición: ${P.pos}`,
    `Guion: ${s?.title || '—'}`,
    '',
    ...(voiceLog.length ? voiceLog : ['(vacío: usá el modo Voz y volvé a intentar)']),
  ].join('\n');
  const fallback = () => shareOrDownload(new Blob([text], { type: 'text/plain' }), 'registro-voz.txt', 'Registro de voz');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Registro copiado. Pegalo en el chat.'), fallback);
  } else fallback();
}

function resetLayout() {
  const d = defaultSettings();
  for (const k of LAYOUT_KEYS) settings[k] = d[k];
  changed();
}

function changed(key) {
  saveSettings(settings);
  applySettings();
  if (key === 'camera') { if (settings.camera) startCamera(); else stopCamera(); }
  if (key === 'lang' && P.voice) { P.voice.lang = settings.lang; P.voice.resetSession(); }
  if (key === 'showHeard' && !settings.showHeard) $('#heard').hidden = true;
}

function applySettings() {
  const st = $('#view-prompter').style;
  st.setProperty('--fs', settings.fontSize + 'px');
  st.setProperty('--box-w', settings.boxWidth / 100);
  st.setProperty('--lines', settings.lines);
  st.setProperty('--read', settings.readPos / 100);
  st.setProperty('--margin', settings.margin + 'px');
  st.setProperty('--box-op', settings.boxOpacity / 100);
  $('#text-box').classList.toggle('mirror', settings.mirrorText);
  $('#frame').classList.toggle('selfie', settings.mirrorPreview);
  $('#face').hidden = !settings.faceGuide;
  renderSafe();
  relayout();
  requestAnimationFrame(relayout);
}

function renderSafe() {
  const z = SAFE[settings.safeZone];
  $('#safe').replaceChildren(...(z ? [h('div', { class: 'zone', style: `top:${z.t}%;bottom:${z.b}%;left:${z.l}%;right:${z.r}%` },
    h('span', {}, 'Zona segura · ' + z.label))] : []));
}

function layoutFrame() {
  const v = $('#cam');
  const a = (v.videoWidth || 9) / (v.videoHeight || 16);
  let w = window.innerWidth;
  let hh = w / a;
  if (hh > window.innerHeight) { hh = window.innerHeight; w = hh * a; }
  const f = $('#frame');
  f.style.width = w + 'px';
  f.style.height = hh + 'px';
}

function relayout() {
  if (currentView !== 'prompter') return;
  layoutFrame();
  const box = $('#text-box');
  const script = $('#script');
  script.style.paddingTop = readPx() + 'px';
  script.style.paddingBottom = box.clientHeight + 'px';
  if (P.mode === 'voice') P.targetY = targetFor(P.pos);
}

// ---------- Eventos ----------
function bind() {
  $('#btn-import').innerHTML = ICONS.import;
  $('#ed-more').innerHTML = ICONS.more;
  $('#pr-close').innerHTML = ICONS.close;
  $('#pr-restart').innerHTML = ICONS.restart;
  $('#pr-settings').innerHTML = ICONS.sliders;

  // Biblioteca
  $('#search').addEventListener('input', renderLibrary);
  $('#btn-new').addEventListener('click', newScript);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) importFiles(files);
  });

  // Editor
  for (const id of ['#ed-title', '#ed-cat', '#ed-text']) $(id).addEventListener('input', edInput);
  $('#ed-back').addEventListener('click', () => go(homeOf(getScript(editId))));
  $('#ed-status').addEventListener('click', () => { const s = getScript(editId); if (s) { setDone(s, !s.done); edStatus(); } });
  $('#ed-more').addEventListener('click', () => scriptMenu(editId, true));
  $('#ed-read').addEventListener('click', () => { persist(); readScript(editId); });

  // Teleprompter
  $('#pr-close').addEventListener('click', () => { if (P.recording) stopRecording(); else go(homeOf(getScript(P.id))); });
  $('#pr-restart').addEventListener('click', restart);
  $('#pr-play').addEventListener('click', togglePlay);
  $('#pr-rec').addEventListener('click', onRecord);
  $('#pr-settings').addEventListener('click', openSettings);
  $('#modes').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });

  const sc = scroller();
  sc.addEventListener('touchstart', () => { P.touching = true; P.fingerDown = true; clearTimeout(P.manualTimer); }, { passive: true });
  sc.addEventListener('touchend', () => { P.fingerDown = false; scheduleManualEnd(); }, { passive: true });
  sc.addEventListener('wheel', () => { P.touching = true; scheduleManualEnd(); }, { passive: true });
  sc.addEventListener('scroll', () => { if (P.touching && !P.fingerDown) scheduleManualEnd(); }, { passive: true });

  // Tocar una palabra = seguir desde ahí.
  $('#script').addEventListener('click', (e) => {
    if (P.mode === 'manual') return;
    const w = e.target.closest('.w[data-i]');
    if (w) setPos(Number(w.dataset.i) - 1, true);
  });

  window.addEventListener('resize', () => requestAnimationFrame(relayout));
  window.addEventListener('hashchange', route);

  document.addEventListener('visibilitychange', () => {
    if (currentView !== 'prompter') return;
    if (document.visibilityState === 'hidden') {
      if (P.recording) stopRecording();
      return;
    }
    requestWake();
    if (settings.camera && cameraLost()) { stopCamera(); startCamera(); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openSheets.length) {
      const top = openSheets[openSheets.length - 1];
      if (top.dismissable) top();
      return;
    }
    if (currentView !== 'prompter' || openSheets.length || e.target.matches('input, textarea, select')) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'r' || e.key === 'R') onRecord();
    else if (e.key === 'Escape') go(homeOf(getScript(P.id)));
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (P.mode === 'auto') {
        settings.speed = Math.max(1, Math.min(20, settings.speed + (e.key === 'ArrowUp' ? 1 : -1)));
        saveSettings(settings);
        toast(`Velocidad ${settings.speed}`, 900);
      }
    }
  });
}

bind();
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
