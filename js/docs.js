// Documentos de texto (TXT, Word, PDF, RTF, HTML…) a guiones: lee el archivo y lo divide en
// guiones según cómo esté escrito (títulos "Guion 1", días "Lunes 19/10", "Tema: / Guion:",
// separadores "---", párrafos). Todo pasa en el dispositivo.

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ---------- Lectores ----------

// Texto con la codificación que tenga: UTF-8, UTF-16 o Windows-1252 (Bloc de notas viejo).
export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

// PDF con pdf.js (se carga solo cuando hace falta). Arma las líneas por posición, deja una
// línea en blanco entre párrafos y marca como título (#) la letra más grande que el cuerpo.
export async function readPDF(file) {
  const pdfjs = await import('./vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    let cur = null;
    for (const it of items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      const size = Math.abs(it.transform[3]) || it.height || 0;
      if (!cur || Math.abs(y - cur.y) > Math.max(2, size * 0.5)) {
        if (cur) lines.push(cur);
        cur = { y, size, text: '', page: p };
      } else if (cur.text && it.str && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) {
        // Mismo renglón, otro pedazo: un espacio si hay distancia entre ellos.
        cur.text += cur.x != null && it.transform[4] - cur.x > size * 0.15 ? ' ' : '';
      }
      cur.text += it.str;
      cur.size = Math.max(cur.size, it.str.trim() ? size : 0);
      cur.x = it.transform[4] + (it.width || 0);
      if (it.hasEOL) { lines.push(cur); cur = null; }
    }
    if (cur) lines.push(cur);
    page.cleanup();
  }
  await doc.destroy();
  const real = lines.filter((l) => l.text.trim());
  if (!real.length) throw new Error('el PDF no tiene texto (parece escaneado o una imagen). Exportalo desde el documento original.');
  // Números de página sueltos: afuera.
  const body = real.filter((l) => !/^\s*(p[aá]g(ina)?\.?|page)?\s*\d{1,4}\s*((de|of|\/)\s*\d{1,4})?\s*$/i.test(l.text));
  const sizes = body.map((l) => Math.round(l.size)).sort((a, b) => a - b);
  const normal = sizes[Math.floor(sizes.length / 2)] || 0;
  const gaps = [];
  for (let i = 1; i < body.length; i++) if (body[i].page === body[i - 1].page) gaps.push(Math.abs(body[i - 1].y - body[i].y));
  gaps.sort((a, b) => a - b);
  const step = gaps[Math.floor(gaps.length / 2)] || normal * 1.2;
  const out = [];
  body.forEach((l, i) => {
    const prev = body[i - 1];
    if (prev && prev.page === l.page && Math.abs(prev.y - l.y) > step * 1.45) out.push('');
    const t = l.text.replace(/\s+/g, ' ').trim();
    out.push(normal && l.size >= normal * 1.25 && t.length <= 90 ? '# ' + t : t);
  });
  return out.join('\n');
}

// RTF (TextEdit, WordPad): se queda con el texto y descarta formatos, fuentes y colores.
export function readRTF(raw) {
  const skip = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|headerl|headerr|footerl|footerr|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|expandedcolortbl)$/;
  let out = '';
  const stack = [];
  let hidden = false;
  let uc = 1;
  let pendingSkip = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '{') { stack.push(hidden); continue; }
    if (ch === '}') { hidden = stack.pop() ?? false; continue; }
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === "'") {
        const code = parseInt(raw.substr(i + 2, 2), 16);
        i += 3;
        if (pendingSkip) { pendingSkip--; continue; }
        if (!hidden) out += new TextDecoder('windows-1252').decode(new Uint8Array([code]));
        continue;
      }
      if (next === '*') { hidden = true; i++; continue; }
      if (/[\\{}]/.test(next)) { if (!hidden) out += next; i++; continue; }
      if (next === '\n' || next === '\r') { if (!hidden) out += '\n'; i++; continue; }
      const m = raw.slice(i + 1, i + 40).match(/^([a-zA-Z]+)(-?\d+)? ?/);
      if (!m) { i++; continue; }
      i += m[0].length;
      const word = m[1];
      const arg = m[2] != null ? Number(m[2]) : null;
      if (skip.test(word)) hidden = true;
      else if (hidden) { /* nada */ } else if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += '\n';
      else if (word === 'tab') out += ' ';
      else if (word === 'uc') uc = arg ?? 1;
      else if (word === 'u') { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); pendingSkip = uc; }
      else if (word === 'emdash') out += '—';
      else if (word === 'endash') out += '–';
      else if (word === 'bullet') out += '•';
      else if (word === 'lquote' || word === 'rquote') out += "'";
      else if (word === 'ldblquote' || word === 'rdblquote') out += '"';
      continue;
    }
    if (ch === '\n' || ch === '\r') continue;
    if (pendingSkip) { pendingSkip--; continue; }
    if (!hidden) out += ch;
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// HTML (una página guardada, un Google Docs descargado como .html): títulos como "#".
export function readHTML(raw) {
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script, style, noscript, head').forEach((el) => el.remove());
  const out = [];
  const walk = (node, line) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { line.text += n.textContent.replace(/\s+/g, ' '); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') { out.push(line.text); line.text = ''; continue; }
      if (/^(p|div|li|h[1-6]|tr|section|article|blockquote|pre|hr|ul|ol|table)$/.test(tag)) {
        if (line.text.trim()) out.push(line.text);
        line.text = '';
        if (tag === 'hr') { out.push('---'); continue; }
        const inner = { text: '' };
        walk(n, inner);
        if (inner.text.trim()) out.push((/^h[1-6]$/.test(tag) ? '# ' : '') + inner.text.trim());
        if (/^(p|h[1-6])$/.test(tag)) out.push('');
      } else walk(n, line);
    }
  };
  const rest = { text: '' };
  walk(doc.body || doc, rest);
  if (rest.text.trim()) out.push(rest.text);
  return out.map((l) => l.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Fechas y horarios escritos a mano ----------

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const WD = '(?:domingo|lunes|martes|miercoles|jueves|viernes|sabado|dom|lun|mar|mie|jue|vie|sab)';
const MONTH_RE = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|ene|feb|mar|abr|may|jun|jul|ago|sep|sept|set|oct|nov|dic)';
const DATE_NUM = /(?<![\d:])(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?(?![\d:])/;
const DATE_ISO = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const DATE_WORDS = new RegExp(`\\b(\\d{1,2})\\s*(?:de\\s+)?(${MONTH_RE})\\.?(?:\\s*(?:de|del)?\\s*(\\d{4}))?\\b`);
const TIME = /(?<![\d/.-])(\d{1,2})(?:[:.](\d{2}))?\s*(hs|h|am|pm)\b|(?<![\d/.-])(\d{1,2}):(\d{2})(?![\d/])/;

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validDay = (m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31;

// Sin año: el de este año, salvo que haya pasado hace más de medio año (entonces el próximo).
function guessYear(m, d) {
  const now = new Date();
  const y = now.getFullYear();
  const then = new Date(y, m - 1, d);
  return now - then > 183 * 86400000 ? y + 1 : y;
}

export function findDate(text) {
  const f = fold(text);
  let m = f.match(DATE_ISO);
  if (m && validDay(+m[2], +m[3])) return { iso: iso(+m[1], +m[2], +m[3]), match: m[0] };
  m = f.match(DATE_WORDS);
  if (m) {
    const mi = MONTHS.findIndex((x) => m[2].startsWith(x === 'sep' ? 'se' : x));
    if (mi >= 0 && validDay(mi + 1, +m[1])) return { iso: iso(m[3] ? +m[3] : guessYear(mi + 1, +m[1]), mi + 1, +m[1]), match: m[0] };
  }
  m = f.match(DATE_NUM);
  if (m && validDay(+m[2], +m[1]) && (m[3] || f.includes('/') || /\d-\d/.test(m[0]))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : guessYear(+m[2], +m[1]);
    return { iso: iso(y, +m[2], +m[1]), match: m[0] };
  }
  return null;
}

export function findTime(text) {
  const m = fold(text).match(TIME);
  if (!m) return null;
  let h = Number(m[1] ?? m[4]);
  const min = Number(m[2] ?? m[5] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (h > 23 || min > 59) return null;
  return { time: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, match: m[0] };
}

// ---------- Cómo está escrito cada renglón ----------

const KEYWORD = '(?:guion(?:es)?|script|video|reel|tiktok|short|clip|pieza|post|publicacion|toma|episodio|capitulo|contenido)';
const HEAD_RE = new RegExp(`^(?:\\d{1,3}\\s*[.)-]\\s*)?${KEYWORD}\\s*(?:n(?:ro|o|°|º)?\\.?\\s*)?#?\\s*(\\d{1,4})\\b(.*)$`);
const CODE_RE = /^([A-Z]{1,4}-?\d{2,4})(?=$|[\s:·|–—\-.)])(.*)$/;
const NUM_RE = /^(\d{1,3})\s*[.)]\s+(.+)$/;
const SEP_RE = /^([-*_=~•·]\s*){3,}$/;

// Etiquetas "Algo: valor". `text`: lo que se dice; `spoken`: partes del guion con nombre;
// el resto son datos de producción.
const LABELS = [
  ['title', /^(titulo|tema|nombre|idea|asunto)$/],
  ['code', /^(codigo|cod|id)$/],
  ['date', /^(fecha|dia|fecha de publicacion|publicacion)$/],
  ['time', /^(hora|horario)$/],
  ['status', /^(estado|status)$/],
  ['text', /^(guion|script|texto|libreto|locucion|parlamento|voz en off|lo que (digo|decis|vas a decir))\b/],
  ['spoken', /^(gancho|hook|intro|introduccion|desarrollo|cuerpo|cierre|cta|llamado a la accion|remate)\b/],
  ['detail', /^(formato|plano|duracion|palabras? clave|notas?|hashtags?|caption|descripcion|copy|musica|b-?roll|animacion(es)?|edicion|objetivo|publico|plataforma|red social|nicho|linea)\b/],
];

const DONE = /publicad|hecho|grabad|listo|terminad|subid|✅/i;

// Saca adornos del principio y del final: "## ", "**", "> ", viñetas y emojis.
function strip(line) {
  let t = line.trim();
  let deco = false;
  const m = t.match(/^#{1,6}\s+/);
  if (m) { t = t.slice(m[0].length); deco = true; }
  if (/^\*\*.+\*\*:?$/.test(t) || /^__.+__$/.test(t)) { t = t.replace(/^(\*\*|__)|(\*\*|__)(?=:?$)/g, ''); deco = true; }
  t = t.replace(/^(?:[>•▪◦●○■□➤►▶→✅✔☑️🎬🎥📹📌👉🔹🔸⭐️\-–—*]|\p{Extended_Pictographic}|️)+\s*/u, '').trim();
  return { t, deco };
}

function labelOf(t) {
  const m = t.match(/^([^:：]{2,42})\s*[:：]\s*(.*)$/);
  if (!m) return null;
  const name = fold(m[1]).replace(/[*_]/g, '').replace(/\s*\(.*\)\s*/, ' ').replace(/\s+/g, ' ').trim();
  for (const [fk, re] of LABELS) if (re.test(name)) return { fk, label: m[1].replace(/[*_]/g, '').trim(), value: m[2].trim() };
  return null;
}

// Renglón que es solo un día: "Lunes", "LUNES 19/10", "19 de octubre de 2026", "Día 3 — 3 videos".
function dayOf(t) {
  if (t.length > 70) return null;
  const f = fold(t);
  const date = findDate(t);
  const num = f.match(/^(?:dia|jornada)\s*(\d{1,3})\b/);
  const wd = f.match(new RegExp(`^(${WD})\\b`));
  if (!date && !num && !wd) return null;
  let rest = f;
  if (date) rest = rest.replace(date.match, ' ');
  rest = rest.replace(/^(?:dia|jornada)\s*\d{1,3}\b/, ' ')
    .replace(new RegExp(`\\b${WD}\\b`, 'g'), ' ')
    .replace(/\b(de|del|el|semana|\d+\s*(videos?|guiones|reels|publicaciones))\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\s,.:;·|–—\-_/*#]+/g, '');
  if (rest.length > 2) return null;
  const weekday = wd ? WEEKDAYS.findIndex((w) => w.startsWith(wd[1].slice(0, 3))) : -1;
  return { date: date?.iso || '', num: num ? Number(num[1]) : 0, weekday };
}

// Lo que queda de un encabezado ("Video 3 – 09:00 – Cómo importar") como título.
function titleFrom(rest) {
  let t = rest;
  const d = findDate(t);
  if (d) t = t.replace(new RegExp(d.match.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ');
  const tm = findTime(t);
  if (tm) t = t.replace(new RegExp(tm.match.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ');
  t = t.replace(new RegExp(`\\b${WD}\\b`, 'ig'), (w) => (WEEKDAYS.some((x) => fold(w) === x.slice(0, fold(w).length)) ? ' ' : w));
  const parts = t.split(/\s[·|–—-]\s|\s*[·|]\s*|^\s*[:.)–—-]\s*|\(\s*\)/).map((p) => p.replace(/^[\s:.,–—\-()]+|[\s:,–—\-(]+$/g, '').trim()).filter((p) => p.length > 1);
  return parts.sort((a, b) => b.length - a.length)[0] || '';
}

function classify(raw, nicheNames) {
  if (SEP_RE.test(raw.trim())) return { kind: 'sep' };
  const { t, deco } = strip(raw);
  if (!t) return { kind: 'blank' };
  const f = fold(t);
  const head = f.match(HEAD_RE);
  if (head && t.length <= 140) return { kind: 'head', num: Number(head[1]), rest: t.slice(t.length - head[2].length), deco };
  const lab = labelOf(t);
  // "**Gancho**" solo en un renglón: una etiqueta cuyo valor viene abajo.
  const bare = !lab && deco && t.length <= 42 ? labelOf(t.replace(/:?$/, ':')) : null;
  if (lab || bare) return { kind: 'field', ...(lab || bare) };
  const niche = nicheNames.find((n) => fold(n) === f.replace(/^nicho\s*[:\-–]?\s*/, ''));
  if (niche && t.length <= 40) return { kind: 'niche', name: niche };
  const code = t.match(CODE_RE);
  if (code && t.length <= 140) return { kind: 'head', code: code[1], rest: code[2], deco };
  const day = dayOf(t);
  if (day) return { kind: 'day', ...day };
  if (/^semana\s*\d+\b/.test(f) && t.length <= 60) return { kind: 'skip' };
  const num = t.match(NUM_RE);
  if (num) return { kind: 'body', text: raw.trim(), num: Number(num[1]), numRest: num[2], deco };
  const caps = t.length <= 70 && /\p{Lu}{2}/u.test(t) && t === t.toUpperCase() && /\p{L}{3}/u.test(t);
  return { kind: 'body', text: deco ? t : raw.trim(), heading: deco || caps, headingText: t };
}

// ---------- De texto a guiones ----------

const firstWords = (text) => {
  const line = text.split('\n').find((l) => l.trim())?.trim() || '';
  return line.length > 48 ? line.slice(0, 48).replace(/\s+\S*$/, '') + '…' : line || 'Guion';
};

function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Divide el texto según `mode`:
//  'marks'  → encabezados, días, separadores y etiquetas repetidas
//  'blocks' → bloques separados por 2 o más renglones en blanco (además de lo anterior)
//  'paras'  → cada párrafo es un guion
//  'one'    → todo es un guion
function segment(lines, mode, opts) {
  const segs = [];
  const ctx = { line: opts.line, date: '', day: 0, weekday: -1 };
  let cur = null;
  let blanks = 0;
  const open = (from) => {
    cur = { line: ctx.line, date: ctx.date, day: ctx.day, head: null, fields: [], body: [], kinds: new Set(), from };
    segs.push(cur);
  };
  const close = () => { cur = null; };
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i];
    if (c.kind === 'blank') {
      blanks++;
      if (cur && cur.body.length) cur.body.push('');
      continue;
    }
    const gap = blanks;
    blanks = 0;
    if (mode === 'one') {
      if (!cur) open('one');
      if (c.kind === 'field') cur.fields.push(c); else if (c.kind !== 'sep') cur.body.push(c.text ?? c.raw);
      continue;
    }
    if (c.kind === 'niche') { ctx.line = c.name; close(); continue; }
    if (c.kind === 'skip') { if (mode !== 'paras') close(); continue; }
    if (c.kind === 'sep') { close(); continue; }
    if (c.kind === 'day') {
      // Un día con fecha manda; si no, "Día 3" o el día de la semana cuentan desde el primero.
      if (c.date) { ctx.date = c.date; ctx.day = 0; } else {
        ctx.date = '';
        if (c.num) ctx.day = c.num;
        else if (c.weekday >= 0 && ctx.weekday >= 0) ctx.day = (ctx.day || 1) + (((c.weekday - ctx.weekday + 6) % 7) + 1);
        else ctx.day = (ctx.day || 0) + 1;
      }
      ctx.weekday = c.weekday;
      close();
      continue;
    }
    if (c.kind === 'head' || (c.heading && opts.headings)) {
      open('head');
      cur.head = c;
      cur.kinds.add('head');
      continue;
    }
    if (c.kind === 'field') {
      // Una etiqueta que ya apareció en este guion ("Tema:" otra vez) empieza el siguiente.
      const repeated = cur && cur.kinds.has(c.fk) && !['detail', 'spoken'].includes(c.fk);
      if (!cur || repeated) open('field');
      cur.kinds.add(c.fk);
      cur.fields.push(c);
      continue;
    }
    // Cuerpo: en 'paras' cada renglón en blanco corta; en 'blocks', dos o más.
    const said = cur && (cur.body.some((l) => l.trim()) || cur.fields.some((f) => ['text', 'spoken'].includes(f.fk) && (f.value || f.more.length)));
    if (!cur || (said && ((mode === 'paras' && gap >= 1) || (mode === 'blocks' && gap >= 2)))) open('body');
    cur.body.push(c.text);
  }
  return segs;
}

function toRow(seg, i, opts) {
  const fields = {};
  const details = [];
  const textParts = [];
  const spoken = [];
  let hook = [];
  let body = seg.body.slice();
  // Las etiquetas pueden tener texto en los renglones siguientes (va al cuerpo de esa etiqueta).
  for (const f of seg.fields) {
    if (f.fk === 'text') textParts.push(f.value, ...(f.more || []));
    else if (f.fk === 'spoken') { spoken.push([f.label, [f.value, ...(f.more || [])].filter(Boolean).join('\n')]); if (/^(gancho|hook)/i.test(fold(f.label))) hook = [f.label, f.value]; }
    else if (f.fk === 'detail') details.push([f.label, [f.value, ...(f.more || [])].filter(Boolean).join(' ')]);
    else if (!fields[f.fk]) fields[f.fk] = f.value;
  }
  let title = '';
  let date = seg.date;
  let time = '';
  let code = '';
  if (seg.head) {
    const h = seg.head;
    const rest = h.rest ?? h.headingText ?? '';
    const d = findDate(rest);
    if (d) date = d.iso;
    const tm = findTime(rest);
    if (tm) time = tm.time;
    code = h.code || '';
    const t = h.isNumHead ? rest : titleFrom(rest);
    if (t && t.length <= 90) title = t;
    else if (t) body.unshift(t);
  }
  if (fields.date) { const d = findDate(fields.date); if (d) date = d.iso; }
  if (fields.time) { const tm = findTime(fields.time); if (tm) time = tm.time; }
  if (fields.code) code = fields.code;
  title = fields.title || title;
  // El texto: lo que viene después de "Guion:"; si no hay, las partes con nombre y el cuerpo.
  let text;
  if (textParts.some((x) => x.trim())) {
    text = [...textParts, ...body].join('\n');
    if (hook) details.unshift(hook);
  } else {
    text = [...spoken.map(([, v]) => v), ...body].join('\n');
  }
  text = text.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  // Un renglón destacado sin nada abajo era texto, no un título (salvo el título del documento).
  if (!text && seg.head?.heading && i > 0) { text = seg.head.headingText; title = ''; }
  if (!text) return null;
  const done = DONE.test(fields.status || '') || DONE.test(seg.head?.rest || '');
  return {
    sheet: opts.sheet,
    line: seg.line,
    code,
    date,
    day: date ? 0 : seg.day,
    time,
    title: (title || hook[1] || firstWords(text)).replace(/\s*(✅|✔️?|☑️?)\s*/gu, ' ').trim(),
    text,
    done,
    details: details.filter(([, v]) => v),
  };
}

// Junta los renglones que siguen a una etiqueta de texto ("Guion:") como su valor, hasta la
// próxima etiqueta, encabezado, día o separador.
function attachFieldText(lines) {
  let open = null;
  const out = [];
  for (const c of lines) {
    if (c.kind === 'field') {
      open = c.fk === 'text' || c.fk === 'spoken' || (c.fk === 'detail' && !c.value) ? c : null;
      c.more = [];
      out.push(c);
      continue;
    }
    if (open && (c.kind === 'body' || c.kind === 'blank')) {
      if (c.kind === 'blank' && open.fk === 'detail') { open = null; out.push(c); continue; }
      if (c.kind === 'body' && c.heading && !open.more.length && !open.value) { open.more.push(c.text); continue; }
      if (c.kind === 'body' && c.heading) { open = null; out.push(c); continue; }
      open.more.push(c.kind === 'blank' ? '' : c.text);
      continue;
    }
    open = null;
    out.push(c);
  }
  for (const c of out) if (c.more) while (c.more.length && !c.more[c.more.length - 1].trim()) c.more.pop();
  return out;
}

// Opciones de división de un texto, la más probable primero: [{ id, label, rows }].
export function splitScripts(text, { name = 'Documento', line = 'Documento', niches = [] } = {}) {
  const raw = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').replace(/\f/g, '\n');
  let lines = raw.split('\n').map((l) => ({ raw: l, ...classify(l, niches) }));

  // "1. …", "2. …": encabezados solo si van en orden (1, 2, 3…, y vuelven a 1 con cada día),
  // empiezan párrafo y no son una lista dentro de un guion.
  // Si ya hay encabezados "Guion 1", los números son listas dentro de cada guion.
  const nums = lines.filter((c) => c.kind === 'body' && c.num);
  let expect = 1;
  let seq = 0;
  for (const c of lines) {
    if (c.kind === 'day') expect = 1;
    if (c.kind !== 'body' || !c.num) continue;
    if (c.num === expect) { c.cand = true; expect = c.num + 1; seq++; }
  }
  if (lines.filter((c) => c.kind === 'head').length < 2 && seq >= 2 && seq >= nums.length * 0.8) {
    for (const c of lines) {
      if (!c.cand) continue;
      const r = c.numRest.trim();
      // Si lo que sigue al número parece texto dicho (largo, con comas o punto final), queda en el guion.
      const titleLike = r.length <= 60 && !/[.!?…,;]$/.test(r) && !/[,;]/.test(r);
      c.isNumHead = true;
      c.kind = 'head';
      c.rest = titleLike ? r : '';
      if (!titleLike) c.pre = r;
    }
  }
  lines = attachFieldText(lines);
  // Si un número no es título, su texto empieza el guion.
  lines = lines.flatMap((c) => (c.isNumHead && c.pre ? [c, { kind: 'body', text: c.pre }] : [c]));

  const heads = lines.filter((c) => c.kind === 'head').length;
  const headings = lines.filter((c) => c.kind === 'body' && c.heading).length;
  const opts = { sheet: name, line, headings: heads < 2 && headings >= 2 };

  const build = (mode) => {
    let segs = segment(lines, mode, opts);
    // Texto de presentación antes del primer guion ("Estos son los guiones de…"): afuera.
    if (mode !== 'one' && segs.length > 1 && segs[0].from === 'body' && segs.slice(1).some((s) => s.from !== 'body') && !segs[0].fields.length) segs = segs.slice(1);
    return segs.map((s, i) => toRow(s, i, opts)).filter(Boolean);
  };
  const variants = [
    { id: 'marks', label: 'Por títulos y días', rows: build('marks') },
    { id: 'blocks', label: 'Por bloques', rows: build('blocks') },
    { id: 'paras', label: 'Cada párrafo', rows: build('paras') },
    { id: 'one', label: 'Todo en uno', rows: build('one') },
  ];
  // Sacar las opciones repetidas (mismo resultado) y las vacías.
  const seen = new Set();
  const out = variants.filter((v) => {
    const sig = v.rows.map((r) => r.text.length).join(',');
    if (!v.rows.length || seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
  // La más probable: lo que marca el documento; si no marca nada, bloques; párrafos solo
  // si cada párrafo es largo como un guion.
  const by = (id) => out.find((v) => v.id === id);
  const median = (rows) => rows.map((r) => r.text.length).sort((a, b) => a - b)[Math.floor(rows.length / 2)] || 0;
  let best = by('marks');
  if (!best || best.rows.length < 2) best = by('blocks') && by('blocks').rows.length >= 2 ? by('blocks') : null;
  if (!best && by('paras') && median(by('paras').rows) >= 250) best = by('paras');
  if (!best) best = by('marks') || by('one') || out[0];
  return best ? [best, ...out.filter((v) => v !== best)] : [];
}

export { addDays };
