// El ?v= de cada import hace que una versión nunca se mezcle con archivos viejos en caché.
import { loadScripts, saveScripts, loadSettings, saveSettings, defaultSettings, LAYOUT_KEYS, uid } from './store.js?v=1.4';
import { norm } from './matcher.js?v=1.4';
import { VoiceFollower, voiceSupported, voiceLog } from './voice.js?v=1.4';
import { openCamera, Recorder, pickMime } from './camera.js?v=1.4';

const VERSION = '1.4';

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
let activeCat = null;
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

function route() {
  const [, view, id] = (location.hash.slice(1) || '/').split('/');
  // Si se está grabando, no dejamos que un "atrás" corte la toma.
  if (currentView === 'prompter' && P.recording && !(view === 'read' && id === P.id)) {
    go('/read/' + P.id);
    stopRecording();
    return;
  }
  if (view === 'edit' && getScript(id)) return showEditor(id);
  if (view === 'read' && getScript(id)) return showPrompter(id);
  showLibrary();
}

function setView(name) {
  if (currentView === 'editor' && name !== 'editor') leaveEditor();
  if (currentView === 'prompter' && name !== 'prompter') closePrompter();
  while (openSheets.length) openSheets[openSheets.length - 1]();
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  currentView = name;
}

// ---------- Biblioteca ----------
function showLibrary() {
  setView('library');
  renderLibrary();
}

function renderLibrary() {
  $('#version').textContent = `Guion v${VERSION}` + (voiceSupported ? '' : ' · sin reconocimiento de voz en este navegador');
  const q = fold($('#search').value.trim());
  const cats = categories();
  if (activeCat && !cats.includes(activeCat)) activeCat = null;

  const chips = $('#chips');
  chips.hidden = !cats.length;
  chips.replaceChildren(...[null, ...cats].map((c) =>
    h('button', { class: 'chip' + (activeCat === c ? ' on' : ''), onclick: () => { activeCat = c; renderLibrary(); } }, c ?? 'Todos')));

  const list = scripts
    .filter((s) => (!activeCat || (s.category || '').trim() === activeCat) && (!q || fold(s.title + ' ' + s.text).includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  $('#script-list').replaceChildren(...list.map(card));

  const empty = $('#empty');
  empty.hidden = list.length > 0;
  empty.textContent = scripts.length ? 'No hay guiones que coincidan.' : 'Todavía no tenés guiones. Creá el primero.';
}

function card(s) {
  const w = countWords(s.text);
  return h('li', { class: 'card' },
    h('button', { class: 'card-main', onclick: () => go('/edit/' + s.id) },
      h('h3', {}, s.title || 'Sin título'),
      h('p', {}, s.text.trim().slice(0, 180) || 'Vacío'),
      h('span', { class: 'meta' }, [`${w} palabras`, fmtDuration(w), s.category].filter(Boolean).join(' · '))),
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
    {
      label: 'Duplicar',
      run: () => {
        const now = Date.now();
        const copy = { ...s, id: uid(), title: (s.title || 'Sin título') + ' (copia)', createdAt: now, updatedAt: now };
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
        if (fromEditor) { editId = null; go('/'); } else renderLibrary();
      },
    },
  ]);
}

function newScript() {
  const now = Date.now();
  const s = { id: uid(), title: '', category: activeCat || '', text: '', createdAt: now, updatedAt: now };
  scripts.unshift(s);
  persist();
  go('/edit/' + s.id);
}

async function importFiles(files) {
  for (const f of files) {
    const now = Date.now();
    const text = (await f.text()).replace(/\r\n?/g, '\n');
    scripts.unshift({ id: uid(), title: f.name.replace(/\.[^.]+$/, ''), category: activeCat || '', text, createdAt: now, updatedAt: now });
  }
  persist();
  renderLibrary();
  toast(files.length === 1 ? 'Guion importado' : `${files.length} guiones importados`);
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
  edStats();
  if (!s.title && !s.text) setTimeout(() => $('#ed-text').focus(), 60);
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
  rate: 0, lastMoveAt: 0, heardAny: false, watchdog: 0,
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
    toks.forEach((tok, k) => {
      const sp = document.createElement('span');
      sp.className = 'w';
      sp.textContent = tok;
      const n = norm(tok);
      if (n) { sp.dataset.i = P.words.length; P.words.push(n); P.els.push(sp); }
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

// Ritmo de lectura (palabras/seg) estimado a partir de los avances de la voz.
function trackRate(pos) {
  const now = performance.now();
  const dw = pos - P.pos;
  const dt = (now - P.lastMoveAt) / 1000;
  if (dw > 0 && dw <= 8 && dt > 0.05 && dt < 3) {
    const inst = Math.min(4.5, Math.max(1, dw / dt));
    P.rate = P.rate ? P.rate * 0.7 + inst * 0.3 : inst;
  } else if (dw < 0 || dw > 8) {
    P.rate = 0;
  }
  P.lastMoveAt = now;
}

function setPos(pos, fromUser = false) {
  if (fromUser) { P.rate = 0; P.lastMoveAt = 0; } else trackRate(pos);
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
      // El reconocimiento llega con ~0,5 s de demora: si venís leyendo a ritmo, el texto
      // se adelanta 1 palabra. No más: en una pausa no debe irse a la línea siguiente.
      let target = P.targetY;
      if (P.playing && P.rate && P.lastMoveAt) {
        const ahead = Math.min(1, Math.round(P.rate * Math.min(0.6, (t - P.lastMoveAt) / 1000)));
        if (ahead > 0) target = targetFor(P.pos + ahead);
      }
      const d = target - P.y;
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
  P.rate = 0;
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
  $('#ed-back').addEventListener('click', () => go('/'));
  $('#ed-more').addEventListener('click', () => scriptMenu(editId, true));
  $('#ed-read').addEventListener('click', () => { persist(); readScript(editId); });

  // Teleprompter
  $('#pr-close').addEventListener('click', () => { if (P.recording) stopRecording(); else go('/'); });
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
    else if (e.key === 'Escape') go('/');
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
