// El ?v= de cada import hace que una versión nunca se mezcle con archivos viejos en caché.
import { loadScripts, saveScripts, loadSettings, saveSettings, loadNiches, saveNiches as saveNichesLocal, defaultSettings, LAYOUT_KEYS, isDesktop, uid, setAccount, sampleScript, legacyData, markLegacyMigrated, dropLegacyIfMigrated, forgetAccount } from './store.js?v=3.3';
import { cloudEnabled, currentUser, takeSessionFromUrl, signIn, signUp, signOut, resetPassword, setPassword, signupOpen, Sync } from './cloud.js?v=3.3';
import { norm } from './matcher.js?v=3.3';
import { VoiceFollower, voiceSupported, voiceLog, logVoice } from './voice.js?v=3.3';
import { openCamera, Recorder, pickMime } from './camera.js?v=3.3';
import { AudioBridge } from './audio.js?v=3.3';
import { createRenderer } from './editor.js?v=3.3';

const VERSION = '3.3';

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
  check: svg('<path d="M5.5 12.5l4.2 4.2L18.5 8"/>', 'stroke-width="2.8"'),
  back: svg('<path d="M14.5 6l-6 6 6 6"/>', 'stroke-width="2.6"'),
  person: svg('<circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c1.2-3.4 4-5 7-5s5.8 1.6 7 5"/>'),
  calendar: svg('<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>'),
  list: svg('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1" fill="currentColor"/><circle cx="4.8" cy="12" r="1" fill="currentColor"/><circle cx="4.8" cy="17.5" r="1" fill="currentColor"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  shrink: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
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
// Con cuentas: cada cuenta tiene sus datos aparte en el teléfono y en el servidor.
const urlAuth = takeSessionFromUrl();
const me = cloudEnabled ? currentUser() : null;
setAccount(me?.id);
let sync = null;
let scripts = loadScripts();
let settings = loadSettings();
let currentView = null;

// Si el teléfono se queda sin espacio, avisarlo siempre: si no, los cambios se pierden al cerrar.
let fullWarnAt = 0;
const persist = () => {
  const ok = saveScripts(scripts);
  sync?.schedule();
  if (!ok && Date.now() - fullWarnAt > 8000) {
    fullWarnAt = Date.now();
    toast('⚠︎ No pude guardar: este dispositivo se quedó sin espacio. Lo último que cambiaste puede perderse.', 7000);
  }
  return ok;
};
const getScript = (id) => scripts.find((s) => s.id === id);
const categories = () => [...new Set(scripts.map((s) => (s.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type.split(';')[0] });
  if (navigator.canShare?.({ files: [file] })) {
    // true = se guardó o compartió; false = el usuario canceló.
    return navigator.share({ files: [file], title }).then(() => true)
      .catch((e) => { if (e.name === 'AbortError') return false; download(blob, name); return true; });
  }
  download(blob, name);
  return Promise.resolve(true);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000); // un video grande tarda en escribirse
}

// ---------- Navegación ----------
function go(path) { location.hash = path; }

// A dónde vuelve un guion al cerrarlo: el día de su nicho, o "Otros guiones" si no tiene fecha.
const homeOf = (s) => (inList(s) ? nicheBase(nicheKey(s.category)) : s?.date ? `${nicheBase(nicheKey(s.category))}/${s.date.split('-').join('/')}` : scripts.some((x) => x.date) ? '/o' : '/');

function route() {
  if (cloudEnabled && !currentUser()) return showLogin();
  const [, view, ...rest] = (location.hash.slice(1) || '/').split('/');
  const id = rest[0];
  // Si se está grabando (o hay tomas en pausa), un "atrás" no las pierde: se abre el editor.
  if (currentView === 'prompter' && (P.recording || P.session) && !(view === 'read' && id === P.id)) {
    go('/read/' + P.id);
    finishSession();
    return;
  }
  if (view === 'edit' && getScript(id)) return showEditor(id);
  if (view === 'read' && getScript(id)) return showPrompter(id);
  if (view === 'n') {
    let niche = '_';
    try { niche = decodeURIComponent(rest[0] || '_'); } catch { /* enlace roto: inicio */ return go('/'); }
    return showLibrary({ niche, parts: rest.slice(1).filter(Boolean) });
  }
  if (view === 'o') return showLibrary({ other: true });
  showLibrary();
}

function setView(name) {
  if (currentView === 'editor' && name !== 'editor') leaveEditor();
  if (currentView === 'prompter' && name !== 'prompter') closePrompter();
  // La hoja de "Tu toma" no se cierra sola al navegar: se perdería el video.
  for (const close of [...openSheets].reverse()) if (close.dismissable !== false) close();
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

// Nichos: lista propia (así puede haber nichos vacíos) + los que aparezcan en guiones con fecha.
let niches = loadNiches();
function saveNiches(list) {
  const ok = saveNichesLocal(list);
  sync?.schedule();
  return ok;
}
function syncNiches() {
  const names = new Set(niches.map((n) => n.name));
  let changed = false;
  for (const s of scripts) {
    const c = (s.category || '').trim();
    if (!c || names.has(c)) continue;
    // "courier" escrito a mano va al nicho "Courier" en vez de crear otro.
    const same = niches.find((n) => fold(n.name) === fold(c));
    if (same) { s.category = same.name; changed = true; continue; }
    if (s.date) { niches.push({ name: c, perDay: 3 }); names.add(c); changed = true; }
  }
  if (changed) { saveNiches(niches); persist(); }
}
const nicheOf = (key) => niches.find((n) => n.name === key);
const perDay = (key) => nicheOf(key)?.perDay || 3;
// Cada nicho se organiza como calendario (año, mes, día) o como lista (uno después del otro).
const isList = (key) => nicheOf(key)?.layout === 'list';
const inList = (s) => !!s && isList(nicheKey(s.category));
const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || byDate(a, b) || a.createdAt - b.createdAt;
const listOf = (key) => scripts.filter((s) => nicheKey(s.category) === key).sort(byOrder);

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
  syncNiches();
  $('#version').textContent = `Guion v${VERSION}` + (voiceSupported ? '' : ' · sin reconocimiento de voz en este navegador');
  renderSyncState();
  const q = fold($('#search').value.trim());
  const { niche, parts, other } = lib;
  const dated = scripts.filter((s) => s.date);
  const undated = scripts.filter((s) => !s.date && !inList(s)).sort((a, b) => b.updatedAt - a.updatedAt);
  const listMode = niche != null && !other && isList(niche);

  $('#lib-title').textContent = other ? 'Otros guiones'
    : niche != null ? (parts.length ? folderLabel(parts) : nicheName(niche)) : 'Producción';
  renderBack();

  const pool = other ? undated : listMode ? listOf(niche) : niche != null ? dated.filter((s) => nicheKey(s.category) === niche) : scripts;
  const items = [];

  if (q) {
    pool.filter((s) => fold(`${s.title} ${s.code || ''} ${s.text}`).includes(q)).sort(byDate)
      .forEach((s) => items.push(card(s, true)));
  } else if (other) {
    undated.forEach((s) => items.push(card(s)));
  } else if (niche == null) {
    // Inicio: un panel por nicho, en el orden en que se crearon o importaron.
    items.push(h('li', { class: 'group' }, 'Elegí el nicho'));
    const byNiche = groupBy(scripts.filter((s) => s.date || inList(s)), (s) => nicheKey(s.category));
    for (const n of niches) items.push(nicheTile(n.name, byNiche.get(n.name) || []));
    if (byNiche.has('_')) items.push(nicheTile('_', byNiche.get('_')));
    items.push(addNicheTile());
    if (undated.length) items.push(nicheTile(null, undated));
  } else if (listMode) {
    // Lista: todos los guiones del nicho, uno después del otro y numerados.
    items.push(nicheToolbar(niche));
    if (!pool.length) items.push(h('li', { class: 'hint' }, 'Este nicho todavía no tiene guiones. Importá un archivo con el botón de arriba, o tocá "+ Nuevo guion".'));
    else {
      const p = progress(pool);
      items.push(h('li', { class: 'group' }, `${pool.length} guiones · ${p.done} hechos`));
    }
    pool.forEach((s, i) => items.push(card(s, true, i + 1)));
  } else {
    const base = nicheBase(niche);
    const [y, m, d] = parts;
    if (d) {
      // Día: sus guiones y, si faltan, lugares vacíos hasta completar los videos del día.
      const iso = `${y}-${m}-${d}`;
      const list = pool.filter((s) => s.date === iso).sort(byDate);
      list.forEach((s) => items.push(card(s)));
      for (let k = list.length; k < perDay(niche); k++) items.push(slotCard(niche, iso, k + 1));
    } else if (m) {
      items.push(calendar(Number(y), Number(m), pool.filter((s) => s.date.startsWith(`${y}-${m}-`)), `${base}/${y}/${m}`));
    } else if (y) {
      const groups = groupBy(pool.filter((s) => s.date.startsWith(y + '-')), (s) => s.date.slice(5, 7));
      for (let mm = 1; mm <= 12; mm++) {
        items.push(folderRow({ label: MONTHS[mm - 1], path: `${base}/${y}/${pad(mm)}`, list: groups.get(pad(mm)) || [] }));
      }
    } else {
      if (niche !== '_') items.push(nicheToolbar(niche));
      if (!pool.length) items.push(h('li', { class: 'hint' }, 'Este nicho todavía no tiene guiones. Importá un archivo (PDF, Word, Excel o texto) con el botón de arriba, o abrí un día del calendario y escribilos ahí.'));
      const t = todayISO();
      items.push(folderRow({ label: 'Hoy · ' + dayLabel(t, true), path: `${base}/${t.split('-').join('/')}`, list: pool.filter((s) => s.date === t), dots: true, today: true }));
      const groups = groupBy(pool, (s) => s.date.slice(0, 4));
      const years = new Set([...groups.keys(), t.slice(0, 4)]);
      for (const yy of [...years].sort()) items.push(folderRow({ label: yy, path: `${base}/${yy}`, list: groups.get(yy) || [] }));
    }
  }
  $('#script-list').replaceChildren(...items);

  const empty = $('#empty');
  empty.hidden = items.length > 0;
  empty.textContent = q ? 'No hay guiones que coincidan.' : 'No hay guiones acá.';
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
  btn.replaceChildren(h('span', { class: 'back-ic', html: ICONS.back }), h('span', {}, label));
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
  const sub = key == null ? `${p.total} sin fecha` : p.total ? `${p.total} guiones · ${p.done} hechos` : 'Vacío · importá un archivo o escribí los guiones';
  return h('li', { class: 'niche' + (key == null ? ' other' : '') },
    h('button', { onclick: () => go(key == null ? '/o' : nicheBase(key)) },
      h('span', { class: 'n-main' },
        h('span', { class: 'n-name' }, key == null ? 'Otros guiones' : nicheName(key)),
        h('span', { class: 'n-sub' }, sub),
        today.length ? h('span', { class: 'n-today' + (tp.done === tp.total ? ' all' : '') }, `Hoy: ${tp.done} de ${tp.total} hechos`) : null,
        key == null || !p.total ? null : h('span', { class: 'meter wide' }, h('i', { style: `width:${p.pct}%` }))),
      h('span', { class: 'chev', html: ICONS.chevron })));
}

function addNicheTile() {
  return h('li', { class: 'niche add' },
    h('button', { onclick: addNiche },
      h('span', { class: 'n-main' },
        h('span', { class: 'n-name' }, '+ Agregar nicho'),
        h('span', { class: 'n-sub' }, 'Como calendario (año, mes y día) o como lista, uno después del otro'))));
}

function nicheToolbar(key) {
  return h('li', { class: 'toolbar' },
    h('button', { class: 'tool-btn', onclick: () => pickExcel(key) }, h('span', { class: 'ic', html: ICONS.import }), 'Importar archivo'),
    h('button', { class: 'tool-btn', onclick: () => nicheMenu(key) }, h('span', { class: 'ic', html: ICONS.more }), 'Opciones'));
}

function folderRow({ label, path, list, dots, today }) {
  const p = progress(list);
  const bar = dots
    ? h('span', { class: 'dots' }, list.slice().sort(byDate).map((s) => h('i', { class: s.done ? 'ok' : '' })))
    : h('span', { class: 'meter' + (p.total ? '' : ' none') }, h('i', { style: `width:${p.pct}%` }));
  return h('li', { class: 'folder' + (today ? ' today' : '') + (p.total ? '' : ' empty') },
    h('button', { onclick: () => go(path) },
      h('span', { class: 'f-main' },
        h('span', { class: 'f-name' }, label),
        h('span', { class: 'f-sub' + (p.total && p.done === p.total ? ' all' : '') }, p.total ? `${p.done} de ${p.total} hechos` : 'Sin guiones')),
      bar,
      h('span', { class: 'chev', html: ICONS.chevron })));
}

// Mes como calendario: cada día con guiones muestra un punto por guion (verde = hecho).
// Los días sin guiones también se abren, para escribirlos ahí.
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
    const open = () => go(`${base}/${pad(d)}`);
    if (!items.length) { cells.push(h('button', { class: cls + ' empty', 'aria-label': `${dayLabel(iso)}: sin guiones`, onclick: open }, h('b', {}, d))); continue; }
    const p = progress(items);
    cells.push(h('button', { class: cls + (p.done === p.total ? ' all' : ''), 'aria-label': `${dayLabel(iso)}: ${p.done} de ${p.total} hechos`, onclick: open },
      h('b', {}, d),
      h('span', { class: 'dots' }, items.map((s) => h('i', { class: s.done ? 'ok' : '' })))));
  }
  const p = progress(list);
  return h('li', { class: 'cal-wrap' },
    h('div', { class: 'cal-head' }, ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x) => h('span', {}, x))),
    h('div', { class: 'cal' }, cells),
    h('p', { class: 'cal-sum' + (p.total && p.done === p.total ? ' all' : '') }, p.total ? `${p.done} de ${p.total} guiones hechos este mes` : 'Este mes no tiene guiones todavía'));
}

function slotCard(niche, iso, n) {
  return h('li', { class: 'slot' },
    h('button', { onclick: () => createScript({ category: niche === '_' ? '' : niche, date: iso }) },
      h('span', { class: 'slot-plus' }, '+'),
      h('span', { class: 'slot-text' }, h('strong', {}, `Video ${n}`), h('span', {}, 'Tocá para escribir el guion'))));
}

// ---------- Nichos: crear, renombrar, eliminar ----------
function promptSheet({ title, value = '', placeholder = '', ok = 'Aceptar', type = 'text' }) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((sh, close) => {
      const input = h('input', { class: 'prompt-input', type, value, placeholder, inputmode: type === 'number' ? 'numeric' : null, autocomplete: 'off' });
      const submit = () => { answered = true; close(); resolve(input.value.trim() || null); };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      sh.append(h('h2', {}, title), input,
        h('div', { class: 'sheet-actions' },
          h('button', { class: 'btn primary', onclick: submit }, ok),
          h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
      setTimeout(() => input.focus(), 60);
    }, { onClose: () => { if (!answered) resolve(null); } });
  });
}

const nicheExists = (name, except = null) => niches.some((n) => n.name !== except && fold(n.name) === fold(name));

// "¿Cómo lo querés organizar?": calendario o lista. Devuelve el elemento y la elección actual.
function layoutPicker(initial, onChange = () => {}) {
  let value = initial;
  const opts = [
    ['calendar', 'Calendario', 'Por año, mes y día, con videos por día'],
    ['list', 'Lista', 'Todos, uno después del otro'],
  ];
  const btns = opts.map(([v, title, sub]) => h('button', {
    type: 'button', class: 'layout-opt', 'aria-pressed': String(v === value),
    onclick: () => { value = v; btns.forEach((b, i) => b.setAttribute('aria-pressed', String(opts[i][0] === v))); onChange(v); },
  }, h('span', { class: 'lo-ic', html: v === 'list' ? ICONS.list : ICONS.calendar }), h('strong', {}, title), h('span', {}, sub)));
  return { el: h('div', { class: 'layout-pick' }, h('p', { class: 'pick-q' }, '¿Cómo lo querés organizar?'), h('div', { class: 'layout-opts' }, btns)), get value() { return value; } };
}

function addNiche() {
  sheet((sh, close) => {
    const input = h('input', { class: 'prompt-input', placeholder: 'Ej.: Finanzas personales', autocomplete: 'off' });
    const pick = layoutPicker('calendar');
    const submit = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (nicheExists(name) || name === '_') { toast('Ya existe un nicho con ese nombre.'); return; }
      close();
      niches.push({ name, perDay: 3, layout: pick.value });
      saveNiches(niches);
      go(nicheBase(name));
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    sh.append(h('h2', {}, 'Nuevo nicho'), input, pick.el,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: submit }, 'Crear nicho'),
        h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
    setTimeout(() => input.focus(), 60);
  });
}

// Pasa un nicho a calendario o a lista. Al pasar a calendario, los guiones sin fecha se
// acomodan desde hoy, N por día, en el orden de la lista.
async function setLayout(key, layout) {
  const n = nicheOf(key);
  if (!n || (n.layout || 'calendar') === layout) return;
  if (layout === 'calendar') {
    const list = listOf(key);
    const undated = list.filter((s) => !s.date);
    if (undated.length) {
      const ok = await confirmSheet(`${undated.length} guiones no tienen fecha. Los acomodo en el calendario desde hoy, ${perDay(key)} por día, en el orden de la lista.`, 'Acomodar');
      if (!ok) return;
      spreadUndated(key, todayISO());
    }
  } else {
    listOf(key).forEach((s, i) => { s.order = i; });
  }
  n.layout = layout;
  persist();
  saveNiches(niches);
  go(nicheBase(key));
  renderLibrary();
}

// Guiones sin fecha de un nicho: al calendario desde `start`, N por día, en el orden de la lista.
function spreadUndated(key, start) {
  const list = listOf(key);
  const used = groupBy(list.filter((s) => s.date), (s) => s.date);
  let iso = start;
  for (const s of list.filter((x) => !x.date)) {
    while ((used.get(iso)?.length || 0) >= perDay(key)) iso = nextDay(iso);
    s.date = iso;
    if (!used.has(iso)) used.set(iso, []);
    used.get(iso).push(s);
  }
}

// "Nicho|código" -> "Nuevo nicho|código" (así una nueva importación lo sigue reconociendo).
function rekey(xkey, from, to) {
  return xkey && from && xkey.startsWith(from + '|') ? to + xkey.slice(from.length) : xkey;
}

function nextDay(iso) {
  const d = new Date(iso + 'T12:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nicheMenu(key) {
  const n = nicheOf(key);
  if (!n) return;
  const count = scripts.filter((s) => (s.category || '').trim() === key).length;
  actionSheet(key, [
    { label: 'Importar archivo a este nicho', run: () => pickExcel(key) },
    isList(key)
      ? { label: 'Organizar como calendario', run: () => setLayout(key, 'calendar') }
      : { label: 'Organizar como lista (uno después del otro)', run: () => setLayout(key, 'list') },
    !isList(key) && {
      label: `Videos por día: ${perDay(key)}`,
      run: async () => {
        const v = parseInt(await promptSheet({ title: 'Videos por día', value: String(perDay(key)), type: 'number', ok: 'Guardar' }), 10);
        if (!v) return;
        n.perDay = Math.max(1, Math.min(10, v));
        saveNiches(niches);
        renderLibrary();
      },
    },
    {
      label: 'Renombrar nicho',
      run: async () => {
        const name = await promptSheet({ title: 'Renombrar nicho', value: key, ok: 'Guardar' });
        if (!name || name === key) return;
        if (nicheExists(name, key) || name === '_') { toast('Ya existe un nicho con ese nombre.'); return; }
        for (const s of scripts) {
          if ((s.category || '').trim() !== key) continue;
          s.category = name;
          s.xkey = rekey(s.xkey, key, name);
        }
        n.name = name;
        persist();
        saveNiches(niches);
        go(nicheBase(name) + (lib.parts.length ? '/' + lib.parts.join('/') : ''));
      },
    },
    {
      label: 'Eliminar nicho',
      danger: true,
      run: async () => {
        const msg = `¿Eliminar el nicho "${key}"${count ? ` y sus ${count} guiones` : ''}? No se puede deshacer.`;
        if (!(await confirmSheet(msg, 'Eliminar'))) return;
        scripts = scripts.filter((s) => (s.category || '').trim() !== key);
        niches = niches.filter((x) => x !== n);
        persist();
        saveNiches(niches);
        go('/');
      },
    },
  ].filter(Boolean));
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

function card(s, showDate = false, num = 0) {
  const w = countWords(s.text);
  const hook = s.details?.find(([k]) => k.startsWith('Gancho'))?.[1];
  const meta = [showDate && s.date ? dayLabel(s.date, true) : null, s.time, s.code, s.category, fmtDuration(w)];
  return h('li', { class: 'card' + (s.done ? ' done' : '') },
    statusBtn(s),
    h('button', { class: 'card-main', onclick: () => go('/edit/' + s.id) },
      h('h3', {}, num ? h('span', { class: 'n' }, num + '.') : null, s.title || 'Sin título'),
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
  const list = !fromEditor && inList(s) ? listOf(nicheKey(s.category)) : null;
  const at = list ? list.indexOf(s) : -1;
  actionSheet(s.title || 'Sin título', [
    { label: 'Leer en el teleprompter', run: () => readScript(id) },
    ...(list && at > 0 ? [{ label: 'Subir un lugar', run: () => moveInList(s, -1) }] : []),
    ...(list && at < list.length - 1 ? [{ label: 'Bajar un lugar', run: () => moveInList(s, 1) }] : []),
    { label: s.done ? 'Marcar como pendiente' : 'Marcar como hecho', run: () => { setDone(s, !s.done); if (fromEditor) edStatus(); else renderLibrary(); } },
    {
      label: 'Duplicar',
      run: () => {
        const now = Date.now();
        const copy = { ...s, id: uid(), title: (s.title || 'Sin título') + ' (copia)', code: '', source: '', xkey: '', done: false, createdAt: now, updatedAt: now };
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

function createScript(fields) {
  const now = Date.now();
  const s = { id: uid(), title: '', category: '', text: '', date: '', done: false, createdAt: now, updatedAt: now, ...fields };
  scripts.unshift(s);
  persist();
  go('/edit/' + s.id);
}

// "+ Nuevo guion": en un día, para ese día; dentro de un nicho, para hoy; si no, sin fecha.
function newScript() {
  if (lib.niche != null && !lib.other && isList(lib.niche)) {
    const list = listOf(lib.niche);
    createScript({ category: currentNiche(), date: '', order: list.length ? (list[list.length - 1].order ?? list.length) + 1 : 0 });
    return;
  }
  const date = lib.parts.length === 3 ? lib.parts.join('-') : lib.niche != null ? todayISO() : '';
  createScript({ category: currentNiche(), date });
}

// En un nicho en lista: subir o bajar un guion un lugar.
function moveInList(s, delta) {
  const list = listOf(nicheKey(s.category));
  list.forEach((x, i) => { x.order = i; });
  const i = list.indexOf(s);
  const j = i + delta;
  if (j < 0 || j >= list.length) return;
  [list[i].order, list[j].order] = [list[j].order, list[i].order];
  persist();
  renderLibrary();
}

// El botón de importar de arriba, dentro de un nicho, importa a ese nicho.
let importTarget = null;
function pickExcel(target) {
  importTarget = target;
  $('#file-import').click();
}

// Acepta cualquier archivo y se fija qué es por su contenido, no solo por el nombre:
// planillas (Excel nuevo y viejo, Numbers, OpenDocument, CSV) y documentos (PDF, Word, Pages,
// OpenDocument, RTF, HTML, texto). De cada uno saca los guiones y los muestra antes de importar.
async function importFiles(files, target = null) {
  const xlsx = () => import('./xlsx.js?v=3.3');
  const docs = () => import('./docs.js?v=3.3');
  for (const f of files) {
    if (f.size > 40 * 1024 * 1024) { toast(`"${f.name}" es demasiado grande (más de 40 MB).`, 6000); continue; }
    try {
      const head = new Uint8Array(await f.slice(0, 8).arrayBuffer());
      const sig = String.fromCharCode(...head.slice(0, 5));
      const sheetsOf = (load) => importRows(f, target, async () => {
        const { scriptsFromWorkbook } = await xlsx();
        const list = await load();
        return { rows: scriptsFromWorkbook(list), sheets: list };
      });
      const docOf = (load) => importRows(f, target, async () => {
        const { splitScripts } = await docs();
        const text = await load();
        return { variants: splitScripts(text, { name: f.name, line: target || docNiche(f.name), niches: niches.map((n) => n.name) }) };
      });
      if (sig.startsWith('PK\x03\x04')) {
        const { zipKind, readWorkbook, readDocx, readODT, readAnySheet, pagesPreview } = await xlsx();
        const kind = await zipKind(f);
        if (kind === 'xlsx') await sheetsOf(() => readWorkbook(f));
        else if (kind === 'sheet') await sheetsOf(() => readAnySheet(f));
        else if (kind === 'docx') await docOf(() => readDocx(f));
        else if (kind === 'odt') await docOf(() => readODT(f));
        else if (kind === 'pages') {
          const pdf = await pagesPreview(f);
          if (pdf) await docOf(async () => (await docs()).readPDF(pdf));
          else toast(`"${f.name}" es de Pages. Abrilo y exportalo como PDF o Word, y volvé a importarlo.`, 8000);
        } else if (kind === 'keynote') toast(`"${f.name}" es una presentación de Keynote. Exportala como PDF y volvé a importarla.`, 8000);
        else toast(`"${f.name}" es un archivo comprimido (.zip). Descomprimilo e importá los archivos de adentro.`, 7000);
      } else if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) {
        // Formato viejo de Office: un .xls se lee; un .doc o .ppt hay que guardarlo de nuevo.
        if (/\.(doc|dot|ppt|pps)$/i.test(f.name)) toast(`"${f.name}" es un Word o PowerPoint viejo. Abrilo y guardalo como .docx o PDF, y volvé a importarlo.`, 8000);
        else await sheetsOf(() => readXlsOrExplain(f, xlsx));
      } else if (sig === '%PDF-') {
        await docOf(async () => (await docs()).readPDF(f));
      } else if (/^(image|video|audio)\//.test(f.type)) {
        toast(`"${f.name}" no es un documento. Elegí un PDF, Word, Excel, Numbers o texto.`, 6000);
      } else {
        const { decodeText, readRTF, readHTML } = await docs();
        const text = decodeText(await f.arrayBuffer());
        if (/\0/.test(text.slice(0, 2000))) { toast(`No sé leer "${f.name}". Probá con un PDF, Word, Excel o texto.`, 6000); continue; }
        if (/^\s*\{\\rtf/.test(text)) await docOf(() => readRTF(text));
        else if (/\.(html?|xhtml)$/i.test(f.name) || /^\s*<(!doctype html|html)\b/i.test(text)) await docOf(() => readHTML(text));
        else if (/\.(csv|tsv)$/i.test(f.name) || /csv|tab-separated/.test(f.type) || looksTabular(text)) {
          // Una tabla en texto: si tiene una columna de guiones se usa; si no, se lee como documento.
          await importRows(f, target, async () => {
            const { readCSV, scriptsFromWorkbook } = await xlsx();
            const list = readCSV(text, f.name.replace(/\.[^.]+$/, ''));
            const rows = scriptsFromWorkbook(list);
            if (rows.length) return { rows, sheets: list };
            const { splitScripts } = await docs();
            return { variants: splitScripts(text, { name: f.name, line: target || docNiche(f.name), niches: niches.map((n) => n.name) }) };
          });
        } else await docOf(() => text);
      }
    } catch (e) {
      toast(`No pude leer "${f.name}": ${e.message}`, 6000);
    }
  }
}

async function readXlsOrExplain(f, xlsx) {
  try {
    return await (await xlsx()).readAnySheet(f);
  } catch (e) {
    throw new Error(/cargar/.test(e.message) ? e.message : 'no parece un Excel. Si es otro tipo de archivo, guardalo como PDF, Word o Excel (.xlsx).');
  }
}

// Texto copiado de una planilla: la mayoría de los renglones tiene tabulaciones.
function looksTabular(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 50);
  return lines.length >= 2 && lines.filter((l) => l.includes('\t')).length >= lines.length * 0.6;
}

// Nicho de un documento importado desde el inicio: uno existente si el nombre del archivo lo
// menciona ("Guiones Courier.pdf" → Courier); si no, el nombre del archivo.
function docNiche(fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const f = fold(base);
  const known = niches.slice().sort((a, b) => b.name.length - a.name.length).find((n) => fold(n.name).length > 2 && f.includes(fold(n.name)));
  if (known) return known.name;
  const clean = base.replace(/[_]+/g, ' ').replace(/\s*\(\d+\)$/, '').replace(/\s+/g, ' ').trim() || 'Guiones';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// Los guiones del Excel se identifican por nicho + código: si importás de nuevo una versión
// actualizada, se actualizan en vez de duplicarse y conservan su estado.
const excelKey = (line, code, date, time, title) => (code ? `${line}|${code}` : `${line}|${date}|${time}|${title}`);
const keyOfScript = (s) => s.xkey || excelKey(s.category, s.code, s.date, s.time, s.title);

// Claves de una importación. Si al importar varias hojas a un mismo nicho se repite un
// código (A001 en dos hojas), la clave incluye la hoja para que no se pisen.
function importPlan(rows, target) {
  const lineOf = (r) => target || niches.find((n) => fold(n.name) === fold(r.line))?.name || r.line;
  const base = (r) => excelKey(lineOf(r), r.code, r.date, r.time, r.title);
  const counts = new Map();
  for (const r of rows) counts.set(base(r), (counts.get(base(r)) || 0) + 1);
  const inSheet = new Map();
  for (const r of rows) inSheet.set(`${base(r)}|${r.sheet}`, (inSheet.get(`${base(r)}|${r.sheet}`) || 0) + 1);
  // Dos guiones iguales en la misma hoja (sin código ni fecha): se distinguen por su orden.
  const nth = new Map();
  let k = 0;
  for (const r of rows) {
    const b = `${base(r)}|${r.sheet}`;
    if (inSheet.get(b) > 1) { k = (nth.get(b + '#') || 0) + 1; nth.set(b + '#', k); nth.set(r, `${b}|${k}`); }
  }
  const keyFor = (r) => nth.get(r) || (counts.get(base(r)) > 1 ? `${base(r)}|${r.sheet}` : base(r));
  const existing = new Map(scripts.filter((s) => s.source === 'excel').map((s) => [keyOfScript(s), s]));
  return { lineOf, keyFor, existing };
}

// Cómo se ve un guion en la vista previa: "Lun 19 oct · 09:00 · Título" o "Día 2 · Título".
function previewLabel(r, i) {
  if (!r.date && !r.day) return `${i + 1}. ${r.title}`;
  return [r.date ? shortDayDate(r.date) : `Día ${r.day}`, r.time, r.title].filter(Boolean).join(' · ');
}
const shortDayDate = (iso) => new Date(iso + 'T12:00').toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });

// Lee el archivo y muestra lo que encontró: las hojas o nichos, cómo se dividió el texto, una
// vista previa, y si va al calendario (N por día) o en lista. `load` devuelve
// { rows, sheets } (planillas) o { variants: [{ id, label, rows }] } (documentos).
async function importRows(file, target, load) {
  toast('Leyendo el archivo…', 20000);
  let found;
  try {
    found = await load();
  } catch (e) {
    toast(`No pude leer "${file.name}": ${e.message}`, 7000);
    return;
  }
  $('#toast').hidden = true;
  const variants = (found.variants || [{ id: 'sheet', label: '', rows: found.rows }]).filter((v) => v.rows.length);
  if (!variants.length) {
    const names = (found.sheets || []).map((x) => `"${x.name}"`).join(', ');
    toast(found.sheets
      ? (found.sheets.length
        ? `No encontré guiones en ${names}. Cada guion tiene que estar en una celda, en una columna (idealmente con el título "Guion").`
        : 'El archivo no tiene hojas con datos.')
      : `No encontré texto en "${file.name}".`, 9000);
    return;
  }

  sheet((sh, close) => {
    let variant = variants[0];
    let rows = [];
    let groups = [];
    let chosen = new Set();
    const groupKey = (r) => `${r.sheet}\u0000${r.line}`;
    const go1 = h('button', { class: 'btn primary' });
    const info = h('p', { class: 'info' });
    const msg = h('p', { class: 'msg' });
    const sum = h('ul', { class: 'import-sum' });
    const preview = h('ol', { class: 'import-preview' });
    // Guiones sin fecha: se reparten en el calendario desde el día elegido, N por día.
    const startDefault = lib.parts.length === 3 ? lib.parts.join('-') : todayISO();
    const from = h('input', { type: 'date', class: 'ed-date', value: startDefault });
    const spread = h('div', { class: 'spread' },
      h('p', { class: 'msg' }),
      h('label', {}, 'Empezar el ', from));
    const pending = (sel, plan) => sel.filter((r) => !r.date && !plan.existing.has(plan.keyFor(r)));
    const selected = () => rows.filter((r) => chosen.has(groupKey(r)));
    // Por defecto calendario (N por día), salvo que el nicho ya esté organizado como lista.
    const known = target ? nicheOf(target) : nicheOf(variants[0].rows[0].line);
    const pick = layoutPicker(known?.layout || 'calendar', () => refresh());
    // Un documento importado desde el inicio: a qué nicho va (uno existente o uno nuevo).
    let dest = target;
    const docLines = [...new Set(variants[0].rows.map((r) => r.line))];
    const nichePick = !target && variants[0].label && docLines.length === 1 ? (() => {
      const suggested = niches.find((n) => fold(n.name) === fold(docLines[0]))?.name || docLines[0];
      const names = [...new Set([suggested, ...niches.map((n) => n.name)])];
      dest = suggested;
      const select = h('select', { class: 'prompt-input niche-select', onchange: (e) => { dest = e.target.value; refresh(); } },
        names.map((n) => h('option', { value: n, selected: n === suggested }, nicheOf(n) ? n : `${n} (nicho nuevo)`)));
      return h('label', { class: 'niche-pick' }, h('span', { class: 'pick-q' }, 'Nicho'), select);
    })() : null;

    // "¿Cómo están separados?": solo si el texto se puede dividir de más de una forma.
    const splitBtns = variants.map((v) => h('button', {
      type: 'button', class: 'split-opt', 'aria-pressed': String(v === variant),
      onclick: () => { setVariant(v); splitBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(variants[i] === v))); },
    }, `${v.label} · ${v.rows.length}`));
    const splitPick = variants.length > 1 ? h('div', { class: 'split-pick' }, h('p', { class: 'pick-q' }, '¿Cómo están separados los guiones?'), h('div', { class: 'split-opts' }, splitBtns)) : null;

    const setVariant = (v) => {
      variant = v;
      rows = v.rows;
      groups = [...groupBy(rows, groupKey)].map(([key, list]) => {
        const dates = list.map((r) => r.date).filter(Boolean).sort();
        return { key, name: list[0].sheet, line: list[0].line, list, from: dates[0], to: dates[dates.length - 1] };
      });
      chosen = new Set(groups.map((g) => g.key));
      const multi = groups.length > 1;
      msg.textContent = `Encontré ${rows.length === 1 ? '1 guion' : `${rows.length} guiones`} en "${file.name}"${multi ? '. Elegí cuáles importar:' : ':'}`;
      sum.className = 'import-sum' + (multi ? ' pick' : '');
      sum.replaceChildren(...groups.map((g) => {
        const days = new Set(g.list.map((r) => r.date || (r.day ? 'd' + r.day : '')).filter(Boolean)).size;
        const text = [h('strong', {}, target && !variant.label ? g.name : g.line), ` · ${g.list.length} guiones${g.from ? ` · ${shortDate(g.from)} → ${shortDate(g.to)}` : days > 1 ? ` · ${days} días` : ''}`];
        if (!multi) return h('li', {}, text);
        const cb = h('input', { type: 'checkbox', checked: true, onchange: (e) => { if (e.target.checked) chosen.add(g.key); else chosen.delete(g.key); refresh(); } });
        return h('li', {}, h('label', {}, cb, h('span', {}, text)));
      }));
      refresh();
    };

    const refresh = () => {
      const sel = selected();
      const plan = importPlan(sel, dest);
      const updates = sel.filter((r) => plan.existing.has(plan.keyFor(r))).length;
      const done = sel.filter((r) => r.done).length;
      const undated = pending(sel, plan);
      const byDay = undated.filter((r) => r.day);
      const loose = undated.length - byDay.length;
      const asList = pick.value === 'list';
      const per = dest ? perDay(dest) : 3;
      spread.hidden = asList || !undated.length;
      spread.firstChild.textContent = [
        byDay.length ? `${byDay.length} van por día como en el archivo (Día 1 = el día que elijas).` : '',
        loose ? `${loose === 1 ? '1 guion no tiene fecha' : `${loose} guiones no tienen fecha`}: los acomodo en el calendario, ${per} por día, en el orden del archivo.` : '',
      ].filter(Boolean).join(' ');
      const shown = sel.slice(0, 6);
      preview.replaceChildren(...shown.map((r, i) => h('li', {}, previewLabel(r, i))),
        ...(sel.length > shown.length ? [h('li', { class: 'more' }, `y ${sel.length - shown.length} más`)] : []));
      go1.textContent = sel.length ? `Importar ${sel.length === 1 ? '1 guion' : `${sel.length} guiones`}` : 'Elegí al menos uno';
      go1.disabled = !sel.length;
      info.textContent = [
        (dest ? `Todo va al nicho "${dest}"` : groups.length > 1 ? 'Cada uno va a su nicho' : `Va al nicho "${plan.lineOf(sel[0] || rows[0])}"`) + (asList ? ', uno después del otro en el orden del archivo.' : ', ordenado por año, mes y día.'),
        done ? `${done} figuran como publicados y entran en verde.` : '',
        updates ? `${updates} ya estaban en la app: se actualizan y conservan su estado.` : '',
      ].filter(Boolean).join(' ');
    };
    go1.onclick = () => {
      close();
      applyImport(selected(), dest, from.value || todayISO(), pick.value);
    };
    sh.append(
      h('h2', {}, target ? `Importar a ${target}` : 'Importar archivo'),
      ...[msg, sum, nichePick, splitPick, preview].filter(Boolean),
      pick.el,
      spread,
      info,
      h('div', { class: 'sheet-actions' }, go1, h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
    setVariant(variant);
  });
}

// Fechas para los guiones nuevos sin fecha, desde `start`: los que traen "Día N" van a ese día;
// el resto completa cada día hasta los videos por día del nicho (contando los que ya hay).
function spreadDates(rows, lineOf, keyFor, existing, start) {
  const used = new Map();
  const count = (line, iso) => used.get(`${line}|${iso}`) || 0;
  const add = (line, iso) => used.set(`${line}|${iso}`, count(line, iso) + 1);
  for (const s of scripts) if (s.date) used.set(`${s.category}|${s.date}`, count(s.category, s.date) + 1);
  for (const r of rows) if (r.date && !existing.has(keyFor(r))) add(lineOf(r), r.date);
  const dates = new Map();
  for (const r of rows) {
    if (r.date || !r.day || existing.has(keyFor(r))) continue;
    let iso = start;
    for (let i = 1; i < r.day; i++) iso = nextDay(iso);
    add(lineOf(r), iso);
    dates.set(r, iso);
  }
  const day = new Map();
  for (const r of rows) {
    if (r.date || dates.has(r) || existing.has(keyFor(r))) continue;
    const line = lineOf(r);
    let iso = day.get(line) || start;
    while (count(line, iso) >= perDay(line)) iso = nextDay(iso);
    add(line, iso);
    day.set(line, iso);
    dates.set(r, iso);
  }
  return dates;
}

function applyImport(rows, target = null, start = todayISO(), layout = 'calendar') {
  const { lineOf, keyFor, existing } = importPlan(rows, target);
  // Cada nicho del archivo queda organizado como se eligió.
  const toCalendar = [];
  for (const line of new Set(rows.map(lineOf))) {
    const n = nicheOf(line);
    if (n && isList(line) && layout === 'calendar') toCalendar.push(line);
    if (n) n.layout = layout;
    else niches.push({ name: line, perDay: 3, layout });
  }
  const auto = layout === 'list' ? new Map() : spreadDates(rows, lineOf, keyFor, existing, start);
  // Orden de la lista: el del archivo, después de los guiones que ya había.
  const imported = new Set(rows.map((r) => existing.get(keyFor(r))).filter(Boolean));
  const orderBase = new Map();
  for (const sc of scripts) if (!imported.has(sc)) orderBase.set(nicheKey(sc.category), Math.max(orderBase.get(nicheKey(sc.category)) ?? -1, sc.order ?? -1));
  const seen = new Map();
  const now = Date.now();
  let added = 0;
  for (const r of rows) {
    const key = keyFor(r);
    const s = existing.get(key);
    const date = r.date || s?.date || auto.get(r) || '';
    const line = lineOf(r);
    seen.set(line, (seen.get(line) ?? (orderBase.get(line) ?? -1)) + 1);
    const data = { title: r.title, category: line, text: r.text, date, time: r.time, code: r.code, order: seen.get(line), details: r.details, source: 'excel', xkey: key, updatedAt: now };
    if (s) Object.assign(s, data, { done: s.done || r.done });
    else { scripts.push({ id: uid(), createdAt: now, done: r.done, ...data }); added++; }
  }
  // Un nicho que era lista y pasa a calendario: sus guiones sin fecha también se acomodan.
  for (const line of toCalendar) spreadUndated(line, start);
  if (!persist()) return;
  saveNiches(niches);
  toast(`Listo: ${added} guiones nuevos${rows.length - added ? ` y ${rows.length - added} actualizados` : ''}.`, 4000);
  const dest = target ? nicheBase(target) : '/';
  if ((location.hash.slice(1) || '/') === dest) renderLibrary(); else go(dest);
}

// ---------- Cuenta y sincronización ----------
const SYNC_TEXT = {
  ok: 'Todo guardado en tu cuenta',
  syncing: 'Sincronizando…',
  pending: 'Hay cambios por subir',
  offline: 'Sin internet: se sube cuando vuelva',
  error: 'No se pudo sincronizar, reintento en un rato',
  expired: 'La sesión venció',
};

function startSync() {
  sync = new Sync({
    uid: me.id,
    getScripts: () => scripts,
    setScripts: (list) => { scripts = list; saveScripts(scripts); },
    getNiches: () => niches,
    setNiches: (list) => { niches = list; saveNichesLocal(list); },
    onStatus: (st) => { renderSyncState(); if (st === 'ok') dropLegacyIfMigrated(me.id); },
    onChange: () => {
      if (currentView === 'library') renderLibrary();
      else if (currentView === 'editor' && !getScript(editId)) go('/');
    },
    onExpired: () => { toast('Tu sesión venció. Volvé a entrar con tu email y contraseña.', 6000); showLogin(); },
  });
  sync.run();
  // Al volver a la app o recuperar internet, se trae lo nuevo de otros dispositivos.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.schedule(200); });
  window.addEventListener('online', () => sync.schedule(200));
  setInterval(() => { if (document.visibilityState === 'visible' && !P.recording) sync.schedule(0); }, 120000);
}

function renderSyncState() {
  const el = $('#sync-state');
  if (!el) return;
  el.hidden = !sync;
  if (!sync) return;
  el.dataset.state = sync.status;
  el.textContent = SYNC_TEXT[sync.status] || '';
}

function accountMenu() {
  const user = currentUser();
  if (!user) return;
  let timer = 0;
  sheet((sh, close) => {
    const state = h('p', { class: 'acct-state' });
    const paint = () => {
      const n = sync?.count() || 0;
      state.dataset.state = sync?.status || 'ok';
      state.textContent = (SYNC_TEXT[sync?.status] || '') + (n && sync?.status !== 'syncing' ? ` · ${n} sin subir` : '');
    };
    paint();
    timer = setInterval(paint, 1000);
    sh.append(
      h('div', { class: 'acct-head' },
        h('span', { class: 'acct-avatar' }, (user.email || '?')[0].toUpperCase()),
        h('div', { class: 'acct-who' }, h('strong', {}, user.email), state)),
      h('p', { class: 'info' }, 'Tus guiones y nichos se guardan en tu cuenta y solo vos los podés ver. Los videos quedan en este teléfono.'),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn', onclick: () => { sync?.run().then(paint); } }, 'Sincronizar ahora'),
        h('button', { class: 'btn', onclick: () => { close(); changePassword(); } }, 'Cambiar contraseña'),
        h('button', { class: 'btn danger', onclick: () => { close(); logout(); } }, 'Cerrar sesión'),
        h('button', { class: 'btn', onclick: () => close() }, 'Listo')));
  }, { onClose: () => clearInterval(timer) });
}

async function logout() {
  const user = currentUser();
  if (sync) {
    await sync.run();
    const n = sync.count();
    if (n && !(await confirmSheet(`Hay ${n} cambios que todavía no se subieron (sin internet). Si cerrás sesión ahora, se pierden.`, 'Cerrar sesión igual'))) return;
  }
  await signOut();
  if (user) forgetAccount(user.id);
  location.replace(location.pathname + '#/');
  location.reload();
}

function passwordSheet(title, run) {
  sheet((sh, close) => {
    const input = h('input', { class: 'prompt-input', type: 'password', autocomplete: 'new-password', placeholder: 'Nueva contraseña (mínimo 8)', minlength: 8 });
    const msg = h('p', { class: 'auth-msg', hidden: true });
    const ok = h('button', { class: 'btn primary' }, 'Guardar');
    ok.onclick = async () => {
      if (input.value.length < 8) { msg.hidden = false; msg.textContent = 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
      ok.disabled = true;
      try { await run(input.value); close(); toast('Listo, contraseña cambiada.'); } catch (e) { msg.hidden = false; msg.textContent = e.message; } finally { ok.disabled = false; }
    };
    sh.append(h('h2', {}, title), input, msg, h('div', { class: 'sheet-actions' }, ok, h('button', { class: 'btn', onclick: () => close() }, 'Cancelar')));
    setTimeout(() => input.focus(), 60);
  });
}
const changePassword = () => passwordSheet('Cambiar contraseña', setPassword);
const askNewPassword = () => passwordSheet('Elegí una contraseña nueva', setPassword);

// Pantalla de entrada: entrar o crear cuenta con email y contraseña.
function showLogin(notice = '') {
  setView('login');
  let mode = 'in';
  const email = h('input', { class: 'auth-input', type: 'email', inputmode: 'email', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Email', 'aria-label': 'Email' });
  const pass = h('input', { class: 'auth-input', type: 'password', autocomplete: 'current-password', placeholder: 'Contraseña', 'aria-label': 'Contraseña' });
  const msg = h('p', { class: 'auth-msg', hidden: !notice }, notice);
  const go1 = h('button', { class: 'btn primary auth-go', type: 'submit' });
  const forgot = h('button', { class: 'auth-link', type: 'button' }, '¿Olvidaste tu contraseña?');
  const tabs = [['in', 'Entrar'], ['up', 'Crear cuenta']].map(([m, label]) => h('button', { type: 'button', 'data-m': m, onclick: () => setMode(m) }, label));
  const say = (text, kind = 'error') => { msg.hidden = !text; msg.textContent = text; msg.dataset.kind = kind; };
  function setMode(m) {
    mode = m;
    tabs.forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    go1.textContent = m === 'in' ? 'Entrar' : 'Crear cuenta';
    pass.autocomplete = m === 'in' ? 'current-password' : 'new-password';
    pass.placeholder = m === 'in' ? 'Contraseña' : 'Contraseña (mínimo 8 caracteres)';
    forgot.hidden = m !== 'in';
    say('');
  }
  const form = h('form', { class: 'auth-form', novalidate: true },
    h('div', { class: 'seg auth-tabs' }, tabs), email, pass, msg, go1, forgot);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const em = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Escribí un email válido.');
    if (pass.value.length < (mode === 'up' ? 8 : 1)) return say(mode === 'up' ? 'La contraseña tiene que tener al menos 8 caracteres.' : 'Escribí tu contraseña.');
    go1.disabled = true;
    say(mode === 'in' ? 'Entrando…' : 'Creando tu cuenta…', 'info');
    try {
      const user = mode === 'in' ? await signIn(em, pass.value) : await signUp(em, pass.value);
      if (!user) {
        setMode('in');
        email.value = em;
        say('¡Cuenta creada! Te mandamos un mail para confirmarla: tocá el link y después entrá acá con tu email y contraseña.', 'info');
        return;
      }
      await afterLogin(user);
    } catch (err) {
      say(err.message);
    } finally {
      go1.disabled = false;
    }
  });
  forgot.onclick = async () => {
    const em = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return say('Escribí tu email arriba y tocá de nuevo "¿Olvidaste tu contraseña?".');
    try { await resetPassword(em); say('Te mandamos un mail con un link para elegir una contraseña nueva.', 'info'); } catch (err) { say(err.message); }
  };
  setMode('in');
  if (notice) say(notice, 'info');
  const foot = h('p', { class: 'auth-foot' }, 'Cada cuenta es independiente: tus guiones solo los ves vos.');
  $('#login-card').replaceChildren(
    h('img', { class: 'auth-icon', src: 'icons/icon-192.png', alt: '' }),
    h('h1', { class: 'auth-title' }, 'Guion'),
    h('p', { class: 'auth-sub' }, 'Tu teleprompter y calendario de grabación'),
    form,
    foot);
  // Registro cerrado (solo por invitación): no se ofrece "Crear cuenta".
  signupOpen().then((open) => {
    if (open) return;
    if (mode === 'up') setMode('in');
    tabs[1].parentNode.hidden = true;
    foot.textContent = 'Acceso solo por invitación: pedile tu cuenta a quien te pasó la app.';
  });
}

// Primera vez de una cuenta en este teléfono: si el teléfono tiene guiones de antes de las
// cuentas y la cuenta está vacía, se ofrece subirlos. Después se arranca de cero con la cuenta.
async function afterLogin(user) {
  setAccount(user.id);
  const hasLocal = loadScripts().length > 0 || loadNiches().length > 0;
  if (!hasLocal) {
    const legacy = legacyData();
    let empty = true;
    try { empty = await Sync.remoteEmpty(); } catch { /* sin red: se decide con lo que hay */ }
    if (legacy) {
      const n = legacy.scripts.length;
      const up = await choiceSheet(
        empty ? `Este teléfono tiene ${n} guiones guardados. ¿Los subimos a tu cuenta?` : `Tu cuenta ya tiene guiones. Este teléfono tiene ${n} guiones más de antes. ¿Los sumamos a tu cuenta?`,
        empty ? 'Sí, subirlos a mi cuenta' : 'Sí, sumarlos', 'No, empezar sin ellos');
      if (up) { saveScripts(legacy.scripts); saveNichesLocal(legacy.niches); markLegacyMigrated(user.id); }
      else if (empty) saveScripts([sampleScript()]);
    } else if (empty) {
      saveScripts([sampleScript()]);
    }
  }
  location.replace(location.pathname + '#/');
  location.reload();
}

function choiceSheet(msg, yes, no) {
  return new Promise((resolve) => {
    let answered = false;
    sheet((sh, close) => {
      sh.append(h('p', { class: 'msg' }, msg), h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn primary', onclick: () => { answered = true; close(); resolve(true); } }, yes),
        h('button', { class: 'btn', onclick: () => { answered = true; close(); resolve(false); } }, no)));
    }, { dismissable: false, onClose: () => { if (!answered) resolve(false); } });
  });
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
  $('#ed-date').value = s.date || '';
  const names = [...new Set([...niches.map((n) => n.name), ...categories()])];
  $('#cat-list').replaceChildren(...names.map((c) => h('option', { value: c })));
  const info = [s.time, s.code].filter(Boolean).join(' · ');
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
  const cat = $('#ed-cat').value.trim();
  if (cat !== s.category) s.xkey = rekey(s.xkey, s.category, cat);
  s.category = cat;
  s.date = $('#ed-date').value;
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
  heardAny: false, watchdog: 0, hist: [],
  raf: 0, last: 0, wake: null, cdTimer: 0, recTimer: 0, recStart: 0,
  errAt: {},
};

const scroller = () => $('#scroller');
const readPx = () => $('#text-box').clientHeight * (settings.readPos / 100);

function showPrompter(id) {
  setView('prompter');
  P.id = id;
  renderScript(getScript(id).text);
  P.pos = -1; P.painted = -1; P.y = 0; P.targetY = 0; P.hist = [];
  scroller().scrollTop = 0;
  applySettings();
  setMode(settings.mode, true);
  if (settings.camera) startCamera(); else $('#frame').hidden = true;
  requestWake();
  P.last = performance.now();
  cancelAnimationFrame(P.raf);
  P.raf = requestAnimationFrame(tick);
  updateButtons();
  // Mover la ventana no avisa con ningún evento: se revisa cada tanto.
  clearInterval(P.camTimer);
  if (isDesktop()) P.camTimer = setInterval(placeUnderCamera, 800);
}

// Pantalla completa (compu): el texto queda pegado al borde de arriba, junto a la webcam.
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else document.documentElement.requestFullscreen?.().catch(() => toast('Este navegador no deja usar pantalla completa.'));
}

function closePrompter() {
  clearInterval(P.camTimer);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  cancelCountdown();
  stopPrompting();
  if (P.recording) { P.recording = false; clearInterval(P.recTimer); P.recorder?.stop(); }
  P.session = null;
  renderRecState();
  P.bridge?.release();
  stopCamera();
  cancelAnimationFrame(P.raf);
  P.touching = false;
  P.fingerDown = false;
  clearTimeout(P.manualTimer);
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

// Adelanto: el reconocimiento de voz del iPhone entrega cada palabra con casi un segundo de
// demora. Mientras leés de corrido, el texto sube como si ya hubieras dicho las palabras que
// te da tiempo a decir en esa demora (según tu velocidad). Si frenás, no se adelanta más.
const LEAD_SECONDS = [0, 0.6, 1.0, 1.5];
function leadWords() {
  const lat = LEAD_SECONDS[settings.lead ?? 2] || 0;
  const now = performance.now();
  P.hist = P.hist.filter((x) => now - x.t < 4000);
  const h = P.hist;
  if (!lat || h.length < 2 || now - h[h.length - 1].t > 1500) return 0;
  const secs = (h[h.length - 1].t - h[0].t) / 1000;
  if (secs < 0.4) return 1;
  const rate = Math.min(5, (h[h.length - 1].pos - h[0].pos) / secs); // palabras por segundo
  return Math.max(0, Math.min(8, Math.round(rate * lat)));
}

// Dónde debe quedar el texto en modo voz: adelantado, pero sin que la línea que estás
// diciendo se vaya por arriba del recuadro.
function voiceTarget(pos) {
  const lead = leadWords();
  let y = targetFor(Math.min(pos + lead, P.els.length - 1));
  const cur = P.els[pos];
  if (lead && cur) y = Math.min(y, Math.max(targetFor(pos), cur.offsetTop - settings.fontSize * 0.55));
  return y;
}

function setPos(pos, fromUser = false) {
  const prev = P.pos;
  P.pos = pos;
  paint(pos);
  if (fromUser || P.mode !== 'voice' || pos < prev) {
    P.hist = [];
    P.targetY = targetFor(pos);
  } else {
    P.hist.push({ t: performance.now(), pos });
    // Nunca retrocede por el adelanto: solo si volvés atrás en el guion.
    P.targetY = Math.max(P.targetY ?? 0, voiceTarget(pos));
  }
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
        P.y += d * (1 - Math.exp(-dt * 16));
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
    giveup: 'El reconocimiento de voz no responde. Cerrá y volvé a abrir el guion, o usá el modo Auto.',
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
  P.hist = [];
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
  rec.setAttribute('aria-label', P.recording ? 'Pausar grabación' : P.session ? 'Seguir grabando' : 'Grabar');
  // Con una sesión en curso, "Listo" ocupa el lugar de Ajustes.
  const active = !!(P.recording || P.session);
  $('#pr-done').hidden = !active;
  $('#pr-settings').hidden = active;
}

// ---------- Cámara y grabación ----------
async function startCamera() {
  if (P.stream) return true;
  try {
    const { stream, audio } = await openCamera();
    if (currentView !== 'prompter' || !settings.camera) { stream.getTracks().forEach((t) => t.stop()); return false; }
    // Dos aperturas a la vez (volver a la app + grabar): se queda la primera.
    if (P.stream) { stream.getTracks().forEach((t) => t.stop()); return true; }
    P.stream = stream;
    P.hasAudio = audio;
    watchAudio(stream.getAudioTracks()[0]);
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

const audioState = (t) => (t ? `${t.readyState}${t.muted ? ' silenciado' : ''}${t.enabled ? '' : ' deshabilitado'}` : 'sin pista');

function watchAudio(track) {
  if (!track) return;
  track.onended = () => logVoice('mic', 'la pista de audio se cortó');
  track.onmute = () => logVoice('mic', 'silenciado');
  track.onunmute = () => logVoice('mic', 'activo de nuevo');
}

// El iPhone le está sacando el micrófono a la grabación una y otra vez (pelea con el
// reconocimiento de voz): se pausa la voz en esta toma para no perder el audio.
function voiceYield() {
  if (P.voiceYielded || !P.recording) return;
  P.voiceYielded = true;
  logVoice('mic', 'el reconocimiento le saca el micrófono a la toma: voz en pausa');
  stopVoice();
  toast('El iPhone le estaba sacando el micrófono a la grabación: pausé el seguimiento por voz en esta toma para no perder el audio. Podés mover el texto con el dedo.', 8000);
}

// Una sesión de grabación junta varias tomas: cada vez que pausás y retomás empieza una
// toma nueva. Con "Listo" se abre el editor para recortarlas y unirlas.
async function onRecord() {
  if (P.recording) return pauseRecording();
  if (P.counting) { cancelCountdown(); stopPrompting(); renderRecState(); return; }
  if (P.preparing || P.finishing) return;
  if (!settings.camera) { toast('Activá la cámara en Ajustes para grabar.'); return; }
  // El audio de la toma se arma con Web Audio, que iOS solo deja arrancar dentro del toque.
  P.bridge ||= new AudioBridge({ log: logVoice, onFight: voiceYield });
  P.bridge.unlock();
  P.preparing = true;
  try {
    if (cameraLost()) {
      stopCamera();
      if (!(await startCamera())) return;
    }
    if (currentView !== 'prompter' || !P.stream) return; // saliste mientras se preparaba
    if (!(await P.bridge.prepare(P.stream.getAudioTracks()[0]))) toast('No pude abrir el micrófono: esta toma se va a grabar sin sonido.', 5000);
    if (currentView !== 'prompter' || !P.stream) { P.bridge.release(); return; }
    if (P.mode === 'voice') { startVoice(); P.voice && (P.voice.paused = true); }
    startCountdown(Number(settings.countdown) || 0, beginRecording);
  } finally {
    P.preparing = false;
  }
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

const sessionTime = () => (P.session?.clips || []).reduce((a, c) => a + c.duration, 0);

// Cartel de arriba: grabando (toma y tiempo) o en pausa (cuántas tomas van).
function renderRecState() {
  const rt = $('#rec-time');
  if (P.recording) {
    const n = P.session.clips.length + 1;
    rt.dataset.state = 'rec';
    rt.textContent = `${n > 1 ? `Toma ${n} · ` : ''}${fmtClock((performance.now() - P.recStart) / 1000)}`;
    rt.hidden = false;
  } else if (P.session?.clips.length) {
    const n = P.session.clips.length;
    rt.dataset.state = 'paused';
    rt.textContent = `En pausa · ${n} ${n === 1 ? 'toma' : 'tomas'} · ${fmtClock(sessionTime())}`;
    rt.hidden = false;
  } else {
    rt.hidden = true;
  }
}

function beginRecording() {
  if (currentView !== 'prompter' || !P.stream) return;
  try {
    // Video de la cámara + la salida fija del puente de audio (nunca se corta).
    logVoice('rec', `inicio · micrófono: ${audioState(P.bridge.track)}`);
    P.recorder = new Recorder(new MediaStream([...P.stream.getVideoTracks(), P.bridge.output]));
    P.recorder.start();
    P.voiceYielded = false;
    P.bridge.start();
  } catch (e) {
    toast('No pude iniciar la grabación: ' + e.message, 6000);
    stopPrompting();
    return;
  }
  P.session ||= { clips: [] };
  P.recording = true;
  P.recStart = performance.now();
  if (P.voice) P.voice.gentle = true;
  renderRecState();
  P.recTimer = setInterval(renderRecState, 250);
  if (P.mode !== 'manual') {
    P.playing = true;
    P.y = scroller().scrollTop;
    if (P.mode === 'voice') { startVoice(); P.voice.paused = false; }
  }
  updateButtons();
}

// Cierra la toma en curso (pausa). El texto se queda donde ibas.
async function pauseRecording() {
  if (!P.recording) return;
  P.recording = false;
  clearInterval(P.recTimer);
  const duration = (performance.now() - P.recStart) / 1000;
  P.bridge.stop();
  const silent = P.bridge.silentRatio();
  logVoice('rec', `fin de toma · micrófono: ${audioState(P.bridge.track)} · silencio del sistema: ${Math.round(silent * 100)}%`);
  if (P.voice) P.voice.gentle = false;
  // Primero se cierra la grabación y después se corta la voz (cortarla puede silenciar el micrófono).
  const pending = P.recorder.stop();
  stopPrompting();
  const blob = await pending;
  P.recorder = null;
  if (blob.size) P.session.clips.push({ blob, duration, silent });
  else toast('Esa toma quedó vacía.');
  renderRecState();
  updateButtons();
}

// "Listo": termina la sesión y abre el editor con todas las tomas.
async function finishSession() {
  if (P.finishing) return;
  P.finishing = true;
  try {
    if (P.counting) { cancelCountdown(); stopPrompting(); }
    await pauseRecording();
    const clips = P.session?.clips || [];
    P.session = null;
    P.bridge?.release();
    renderRecState();
    updateButtons();
    if (clips.length) openTakeEditor(clips);
  } finally {
    P.finishing = false;
  }
}

const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// Editor de tomas: ver cada una, descartarla o recortarle el principio y el final, y
// guardar todo unido (o cada toma por separado).
function openTakeEditor(clips) {
  const s = getScript(P.id);
  const items = clips.map((c, i) => ({ ...c, n: i + 1, url: URL.createObjectURL(c.blob), start: 0, end: c.duration, dur: c.duration, keep: true }));
  let sel = items[0];
  let saved = false;
  let renderer = null;
  const outUrls = [];

  sheet((sh, close) => {
    sh.classList.add('take-editor');
    const player = h('video', { class: 'take-video', playsinline: true, controls: true, preload: 'auto' });
    const warn = h('div', {});
    const strip = h('div', { class: 'tk-strip' });
    const summary = h('p', { class: 'tk-sum' });
    const range = h('div', { class: 'trim-sel' });
    const head = h('div', { class: 'trim-head' });
    const hl = h('button', { class: 'trim-h l', 'aria-label': 'Inicio del recorte' });
    const hr = h('button', { class: 'trim-h r', 'aria-label': 'Final del recorte' });
    const track = h('div', { class: 'trim' }, range, head, hl, hr);
    const trimInfo = h('p', { class: 'trim-info' });
    const discardBtn = h('button', { class: 'btn tk-discard' });
    const trimBox = h('div', { class: 'trim-box' },
      h('div', { class: 'trim-top' }, h('strong', { class: 'trim-title' }), h('button', { class: 'tk-preview', onclick: () => previewRange() }, '▶︎ Ver recorte')),
      track, trimInfo, discardBtn);
    const actions = h('div', { class: 'sheet-actions' });
    let previewing = false;
    let result = null; // archivos listos para guardar (mientras se muestran, no se repinta la edición)

    const kept = () => items.filter((it) => it.keep);
    const trimmed = (it) => it.start > 0.05 || it.end < it.dur - 0.05;

    function paintStrip() {
      strip.replaceChildren(...items.map((it) => h('button', {
        class: 'tk-card' + (it === sel ? ' on' : '') + (it.keep ? '' : ' off'),
        onclick: () => select(it),
      },
      h('strong', {}, `Toma ${it.n}`),
      h('span', {}, it.keep ? fmtClock(it.end - it.start) + (trimmed(it) ? ' ✂︎' : '') : 'Descartada'),
      it.silent > 0.5 ? h('em', {}, 'sin sonido') : null)));
      const k = kept();
      summary.textContent = k.length
        ? `Video final: ${k.length} ${k.length === 1 ? 'toma' : 'tomas'} · ${fmtClock(k.reduce((a, it) => a + it.end - it.start, 0))}`
        : 'Descartaste todas las tomas.';
      paintActions();
    }

    function paintTrim() {
      const d = sel.dur || 1;
      const l = (sel.start / d) * 100;
      const r = (sel.end / d) * 100;
      range.style.left = l + '%';
      range.style.width = Math.max(0, r - l) + '%';
      hl.style.left = l + '%';
      hr.style.left = r + '%';
      trimBox.querySelector('.trim-title').textContent = `Toma ${sel.n}`;
      trimInfo.textContent = `Desde ${fmtTime(sel.start)} hasta ${fmtTime(sel.end)} · queda ${fmtTime(sel.end - sel.start)}`;
      discardBtn.textContent = sel.keep ? 'Descartar esta toma' : 'Recuperar esta toma';
      discardBtn.classList.toggle('danger', sel.keep);
      track.classList.toggle('off', !sel.keep);
      warn.replaceChildren(sel.silent > 0.5
        ? h('p', { class: 'warn' }, '⚠︎ El iPhone silenció el micrófono en esta toma. Escuchala antes de usarla.')
        : sel.silent > 0.08 ? h('p', { class: 'warn' }, `⚠︎ Esta toma tuvo cortes de sonido (~${Math.round(sel.silent * sel.duration)} s).`) : '');
    }

    function paintHead() {
      head.style.left = ((player.currentTime || 0) / (sel.dur || 1)) * 100 + '%';
    }

    function select(it) {
      sel = it;
      result = null;
      trimBox.hidden = strip.hidden = summary.hidden = false;
      previewing = false;
      player.src = it.url;
      paintStrip();
      paintTrim();
    }

    player.addEventListener('loadedmetadata', () => {
      if (result || player.src !== sel.url) return; // está mostrando el video ya armado
      const d = player.duration;
      // Safari sabe la duración real; si no, queda la medida al grabar.
      if (Number.isFinite(d) && d > 0) {
        if (sel.end >= sel.dur - 0.05 || sel.end > d) sel.end = d;
        sel.dur = d;
        paintTrim();
        paintStrip();
      }
      if (player.audioTracks && player.audioTracks.length === 0) {
        logVoice('rec', `la toma ${sel.n} quedó SIN pista de audio`);
        sel.silent = 1;
        paintTrim();
      }
    });
    player.addEventListener('timeupdate', () => {
      if (result) return;
      paintHead();
      if (previewing && player.currentTime >= sel.end - 0.03) { player.pause(); previewing = false; }
    });
    player.addEventListener('seeked', paintHead);

    function previewRange() {
      previewing = true;
      player.currentTime = sel.start;
      player.play().catch(() => {});
    }

    // Manijas del recorte: se arrastran con el dedo; el video muestra ese momento.
    for (const [handle, side] of [[hl, 'l'], [hr, 'r']]) {
      const move = (e) => {
        const box = track.getBoundingClientRect();
        const t = Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * sel.dur;
        if (side === 'l') sel.start = Math.min(t, sel.end - 0.5);
        else sel.end = Math.max(t, sel.start + 0.5);
        sel.start = Math.max(0, sel.start);
        sel.end = Math.min(sel.dur, sel.end);
        player.pause();
        previewing = false;
        player.currentTime = side === 'l' ? sel.start : sel.end;
        paintTrim();
      };
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        handle.classList.add('drag');
        handle.onpointermove = move;
        move(e);
      });
      const end = () => { handle.onpointermove = null; handle.classList.remove('drag'); paintStrip(); };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      // Con teclado: flechas mueven de a una décima de segundo.
      handle.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowRight' ? 0.1 : e.key === 'ArrowLeft' ? -0.1 : 0;
        if (!dir) return;
        e.preventDefault();
        if (side === 'l') sel.start = Math.max(0, Math.min(sel.start + dir, sel.end - 0.5));
        else sel.end = Math.min(sel.dur, Math.max(sel.end + dir, sel.start + 0.5));
        player.currentTime = side === 'l' ? sel.start : sel.end;
        paintTrim();
        paintStrip();
      });
    }

    discardBtn.onclick = () => { sel.keep = !sel.keep; paintTrim(); paintStrip(); };

    const ext = (b) => (/mp4/.test(b.type) ? 'mp4' : 'webm');
    const fileName = (b, suffix = '') => `${slug(s?.title || 'toma')}${suffix}-${stamp()}.${ext(b)}`;
    const toFile = (b, suffix) => new File([b], fileName(b, suffix), { type: b.type.split(';')[0] });

    function saveButtons(files) {
      const canShare = !!navigator.canShare?.({ files });
      return [
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            if (canShare) {
              try { await navigator.share({ files, title: s?.title }); saved = true; } catch (e) { if (e.name !== 'AbortError') files.forEach((f) => download(f, f.name)); else return; saved = true; }
            } else { files.forEach((f) => download(f, f.name)); saved = true; }
            paintActions();
          },
        }, canShare ? (files.length > 1 ? `Guardar las ${files.length} tomas en Fotos / Compartir` : 'Guardar en Fotos / Compartir') : files.length > 1 ? 'Descargar las tomas' : 'Descargar video'),
      ];
    }

    // Une las tomas que quedaron (o cada una por separado) y muestra el resultado para guardarlo.
    async function build(separate) {
      const k = kept();
      if (!k.length) { toast('Descartaste todas las tomas. Recuperá alguna para guardar.'); return; }
      // Una sola toma sin recortes: se guarda tal cual, sin volver a procesarla.
      const simple = separate ? k.every((it) => !trimmed(it)) : k.length === 1 && !trimmed(k[0]);
      if (simple) { showResult(k.map((it, i) => toFile(it.blob, separate && k.length > 1 ? `-toma${i + 1}` : ''))); return; }
      player.pause();
      renderer?.dispose();
      renderer = createRenderer(k[0].url); // dentro del toque: iOS lo exige
      const bar = h('i');
      const label = h('span', {}, 'Preparando…');
      actions.replaceChildren(
        h('div', { class: 'render' }, h('div', { class: 'render-bar' }, bar), label),
        h('p', { class: 'info' }, 'Armando tu video en el teléfono. Tarda lo mismo que dura el video: no cierres la app.'),
        h('button', { class: 'btn', onclick: () => renderer?.cancel() }, 'Cancelar'));
      requestWake();
      try {
        const jobs = separate ? k.map((it) => [it]) : [k];
        const total = jobs.length;
        const files = [];
        for (let j = 0; j < total; j++) {
          const blob = await renderer.run(jobs[j].map((it) => ({ url: it.url, start: it.start, end: it.end })), (f) => {
            const pctv = Math.round(((j + f) / total) * 100);
            bar.style.width = pctv + '%';
            label.textContent = `${total > 1 ? `Toma ${j + 1} de ${total} · ` : ''}${pctv}%`;
          });
          if (!blob) { toast('Cancelado.'); paintActions(); return; }
          files.push(toFile(blob, separate && total > 1 ? `-toma${j + 1}` : ''));
        }
        showResult(files);
      } catch (e) {
        logVoice('rec', `error al unir: ${e.message}`);
        toast('No pude armar el video: ' + e.message + ' Probá guardar las tomas por separado.', 7000);
        paintActions();
      } finally {
        renderer?.dispose();
        renderer = null;
      }
    }

    function showResult(files) {
      const first = files[0];
      const url = URL.createObjectURL(first);
      outUrls.push(url);
      result = files;
      previewing = false;
      trimBox.hidden = strip.hidden = summary.hidden = true;
      warn.replaceChildren();
      player.src = url;
      const size = files.reduce((a, f) => a + f.size, 0) / 1048576;
      actions.replaceChildren(...[
        h('p', { class: 'tk-done' }, files.length > 1 ? `✓ Listas ${files.length} tomas · ${size.toFixed(1)} MB` : `✓ Video listo · ${size.toFixed(1)} MB`),
        ...saveButtons(files),
        h('button', { class: 'btn', onclick: () => { select(sel); } }, 'Volver a editar'),
        doneBtn(),
        closeBtn()].filter(Boolean));
    }

    function doneBtn() {
      return s && !s.done ? h('button', { class: 'btn ok', onclick: (e) => { setDone(s, true); e.currentTarget.textContent = '✓ Guion marcado como hecho'; e.currentTarget.disabled = true; } }, 'Marcar guion como hecho') : null;
    }

    function closeBtn() {
      return h('button', {
        class: 'btn',
        onclick: async () => {
          if (saved || (await confirmSheet('No guardaste el video. ¿Descartar las tomas?', 'Descartar'))) close();
        },
      }, saved ? 'Cerrar' : 'Cerrar sin guardar');
    }

    function paintActions() {
      if (renderer || result) return;
      const k = kept();
      actions.replaceChildren(...[
        h('button', { class: 'btn primary', disabled: !k.length, onclick: () => build(false) }, k.length > 1 ? 'Unir y guardar video' : 'Guardar video'),
        k.length > 1 ? h('button', { class: 'btn', onclick: () => build(true) }, 'Guardar las tomas por separado') : null,
        doneBtn(),
        closeBtn()].filter(Boolean));
    }

    sh.append(
      h('h2', {}, items.length > 1 ? `Tus ${items.length} tomas` : 'Tu toma'),
      player, warn,
      items.length > 1 ? strip : null,
      summary,
      trimBox,
      actions);
    select(sel);
  }, {
    dismissable: false,
    onClose: () => {
      renderer?.dispose();
      items.forEach((it) => URL.revokeObjectURL(it.url));
      outUrls.forEach((u) => URL.revokeObjectURL(u));
    },
  });
}

async function requestWake() {
  try { P.wake?.release(); } catch { /* nada */ }
  P.wake = null;
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (currentView === 'prompter') P.wake = lock; else lock?.release();
  } catch { /* no soportado */ }
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
  { key: 'lead', label: 'Adelanto del texto al leer', type: 'seg', options: [[0, 'No'], [1, 'Poco'], [2, 'Normal'], [3, 'Mucho']] },
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

// En la compu la webcam está arriba, en el centro de la pantalla (no de la ventana): si la
// ventana de Edge/Chrome está corrida, el texto se corre con ella para quedar debajo de la cámara.
function cameraOffset() {
  if (!isDesktop() || document.fullscreenElement) return 0;
  // La pantalla y la ventana se miden sin zoom; la página, con el zoom del navegador (Ctrl +/-).
  const zoom = window.outerWidth / window.innerWidth;
  const winLeft = window.screenX - (screen.left ?? screen.availLeft ?? 0);
  // Datos raros (ventana más grande que la pantalla o fuera de ella): texto centrado.
  if (!(zoom > 0.25 && zoom < 5) || winLeft < -24 || winLeft + window.outerWidth > screen.width + 24) return 0;
  const camX = (screen.width / 2 - winLeft) / zoom;
  const room = Math.max(0, (window.innerWidth - $('#text-box').offsetWidth) / 2 - 8);
  return Math.round(Math.max(-room, Math.min(room, camX - window.innerWidth / 2)));
}

function placeUnderCamera() {
  $('#view-prompter').style.setProperty('--cam-x', cameraOffset() + 'px');
}

function relayout() {
  if (currentView !== 'prompter') return;
  layoutFrame();
  placeUnderCamera();
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
  $('#btn-import').addEventListener('click', () => pickExcel(currentNiche() || null));
  if (cloudEnabled) {
    $('#btn-account').hidden = false;
    $('#btn-account').innerHTML = ICONS.person;
    $('#btn-account').addEventListener('click', accountMenu);
  }
  $('#file-import').addEventListener('change', (e) => {
    const files = [...e.target.files];
    const target = importTarget;
    importTarget = null;
    e.target.value = '';
    if (files.length) importFiles(files, target);
  });

  // Editor
  for (const id of ['#ed-title', '#ed-cat', '#ed-text', '#ed-date']) $(id).addEventListener('input', edInput);
  $('#ed-date').addEventListener('change', edInput);
  $('#ed-back').replaceChildren(h('span', { class: 'back-ic', html: ICONS.back }), h('span', {}, 'Volver'));
  $('#ed-back').addEventListener('click', () => go(homeOf(getScript(editId))));
  $('#ed-status').addEventListener('click', () => { const s = getScript(editId); if (s) { setDone(s, !s.done); edStatus(); } });
  $('#ed-more').addEventListener('click', () => scriptMenu(editId, true));
  $('#ed-read').addEventListener('click', () => { persist(); readScript(editId); });

  // Teleprompter
  $('#pr-close').addEventListener('click', () => { if (P.recording || P.session) finishSession(); else go(homeOf(getScript(P.id))); });
  $('#pr-done').innerHTML = ICONS.check;
  $('#pr-done').addEventListener('click', finishSession);
  $('#pr-restart').addEventListener('click', restart);
  $('#pr-play').addEventListener('click', togglePlay);
  $('#pr-rec').addEventListener('click', onRecord);
  $('#pr-settings').addEventListener('click', openSettings);
  const fs = $('#pr-full');
  fs.hidden = !isDesktop() || !document.fullscreenEnabled;
  fs.innerHTML = ICONS.expand;
  fs.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    fs.innerHTML = on ? ICONS.shrink : ICONS.expand;
    fs.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa');
    requestAnimationFrame(relayout);
  });
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

  // Al salir de la app (o pasar a otra), se guarda ya lo que se estaba escribiendo.
  const flush = () => { if (currentView === 'editor') { clearTimeout(saveTimer); persist(); } };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    if (currentView !== 'prompter') return;
    if (document.visibilityState === 'hidden') {
      if (P.recording) pauseRecording(); // queda en pausa: al volver, seguís o tocás Listo
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
    else if ((e.key === 'f' || e.key === 'F') && isDesktop()) toggleFullscreen();
    else if (e.key === 'Escape' && !document.fullscreenElement) go(homeOf(getScript(P.id)));
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
if (me) startSync();
route();
if (urlAuth?.error) toast(urlAuth.error, 6000);
if (me && urlAuth?.type === 'recovery') askNewPassword();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
