// Lector mínimo de .xlsx, sin librerías: un .xlsx es un ZIP con XML adentro.
// Todo pasa en el dispositivo; el archivo no se sube a ningún lado.

async function unzip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nameLen = dv.getUint16(p + 28, true);
    files[dec.decode(new Uint8Array(buf, p + 46, nameLen))] = {
      method: dv.getUint16(p + 10, true),
      size: dv.getUint32(p + 20, true),
      offset: dv.getUint32(p + 42, true),
    };
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return async (name) => {
    const f = files[name];
    if (!f) return null;
    const start = f.offset + 30 + dv.getUint16(f.offset + 26, true) + dv.getUint16(f.offset + 28, true);
    const data = new Uint8Array(buf, start, f.size);
    if (f.method === 0) return dec.decode(data);
    if (f.method !== 8) throw new Error('Formato de compresión no soportado.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const textOf = (el) => [...el.getElementsByTagName('t')].map((t) => t.textContent).join('');

function colIndex(ref) {
  const m = ref && ref.match(/^[A-Z]+/i);
  if (!m) return -1;
  let n = 0;
  for (const ch of m[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// Atributo r:id aunque el archivo use otro prefijo para el espacio de nombres.
const relId = (el) => [...el.attributes].find((a) => a.localName === 'id' && a.name.includes(':'))?.value;

// Rutas dentro del ZIP: "worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml" o "../xl/...".
function resolve(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const out = base.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

async function relsOf(read, path) {
  const dir = path.split('/').slice(0, -1).join('/');
  const text = await read(`${dir ? dir + '/' : ''}_rels/${path.split('/').pop()}.rels`);
  const rels = {};
  if (!text) return rels;
  for (const r of xml(text).getElementsByTagName('Relationship')) {
    rels[r.getAttribute('Id')] = { path: resolve(path, r.getAttribute('Target')), type: r.getAttribute('Type') || '' };
  }
  return rels;
}

// ¿Qué hay adentro de un ZIP? Excel, Word o un archivo de Numbers/Pages.
export async function zipKind(file) {
  const read = await unzip(await file.arrayBuffer());
  if (await read('xl/workbook.xml') || /spreadsheetml/.test((await read('[Content_Types].xml')) || '')) return 'xlsx';
  if (await read('word/document.xml')) return 'docx';
  if (await read('Index/Document.iwa') || await read('Index.zip')) return 'iwork';
  return 'zip';
}

// Devuelve [{ name, rows: string[][] }] con todas las hojas del libro.
export async function readWorkbook(file) {
  const read = await unzip(await file.arrayBuffer());
  const root = await relsOf(read, '');
  const bookPath = Object.values(root).find((r) => /officeDocument$/.test(r.type))?.path || 'xl/workbook.xml';
  const bookXml = await read(bookPath);
  if (!bookXml) throw new Error('El archivo no es un Excel (.xlsx) válido.');
  const rels = await relsOf(read, bookPath);
  const sharedPath = Object.values(rels).find((r) => /sharedStrings$/.test(r.type))?.path || 'xl/sharedStrings.xml';
  const sharedXml = await read(sharedPath);
  const shared = sharedXml ? [...xml(sharedXml).getElementsByTagName('si')].map(textOf) : [];
  const sheets = [];
  for (const s of xml(bookXml).getElementsByTagName('sheet')) {
    const path = rels[relId(s)]?.path;
    const sheetXml = path && (await read(path));
    if (!sheetXml) continue;
    const rows = [];
    let rowNum = 0;
    for (const row of xml(sheetXml).getElementsByTagName('row')) {
      rowNum = Number(row.getAttribute('r')) || rowNum + 1;
      const cells = [];
      let col = -1;
      for (const c of row.getElementsByTagName('c')) {
        const at = colIndex(c.getAttribute('r'));
        col = at >= 0 ? at : col + 1;
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(c);
        else if (v != null) val = v;
        cells[col] = val;
      }
      rows[rowNum - 1] = cells;
    }
    sheets.push({ name: s.getAttribute('name') || `Hoja ${sheets.length + 1}`, rows });
  }
  return sheets;
}

// CSV / TSV (por ejemplo exportado de Google Sheets o Numbers).
export function readCSV(text, name) {
  text = text.replace(/^\uFEFF/, '');
  const first = text.split('\n', 1)[0];
  const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]);
  const sep = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name, rows }];
}

// Texto de un .docx, un párrafo por línea.
export async function readDocx(file) {
  const read = await unzip(await file.arrayBuffer());
  const doc = xml(await read('word/document.xml'));
  return [...doc.getElementsByTagName('w:p')].map((p) => {
    let out = '';
    for (const el of p.getElementsByTagName('*')) {
      if (el.tagName === 'w:t') out += el.textContent;
      else if (el.tagName === 'w:tab') out += ' ';
      else if (el.tagName === 'w:br') out += '\n';
    }
    return out;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- De hojas a guiones ----------
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const COLUMNS = {
  code: /^(codigo|cod|id|nro|numero|n°|#)$/,
  date: /^(fecha|dia de publicacion|publicacion|fecha de publicacion|date)$/,
  time: /^(horario|hora|time)$/,
  topic: /^(tema|titulo|title|nombre|idea)$/,
  hook: /^gancho/,
  status: /^(estado|status)$/,
  format: /^formato$/,
  plano: /^plano$/,
  duration: /^duracion/,
  keyword: /^palabra clave$/,
  notes: /^notas/,
};

// Columna del guion: cualquier encabezado que empiece así ("Guion", "Guiones", "Guión (lo que
// decís)", "Script"…). Si hay varias, gana la de mayor prioridad y, a igualdad, la de más texto.
const TEXT_HEADERS = [
  /^guion(es)?\b/,
  /^(script|scripts|libreto|locucion|parlamento|discurso|lo que (digo|decis))\b/,
  /^(texto|copy|contenido|cuerpo|desarrollo)\b/,
];
const LONG = 40; // un guion tiene al menos esto de texto

const clean = (s) => fold(s).replace(/\s+/g, ' ');
const len = (v) => String(v ?? '').trim().length;

// Cuánto texto hay en la columna i por debajo de la fila r.
function columnText(rows, r, i) {
  let total = 0;
  let long = 0;
  for (const row of rows.slice(r + 1)) {
    const n = len(row?.[i]);
    total += n;
    if (n >= LONG) long++;
  }
  return { total, long };
}

function headerCols(cells) {
  const cols = {};
  (cells || []).forEach((cell, i) => {
    const f = clean(cell);
    if (!f || f.length > 50) return;
    for (const [key, re] of Object.entries(COLUMNS)) if (cols[key] == null && re.test(f)) cols[key] = i;
  });
  return cols;
}

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = rows[r] || [];
    let best = null;
    cells.forEach((cell, i) => {
      const f = clean(cell);
      if (!f || f.length > 50) return;
      const prio = TEXT_HEADERS.findIndex((re) => re.test(f));
      if (prio < 0) return;
      const { total, long } = columnText(rows, r, i);
      // "Guiones" como encabezado corto basta; un título largo ("Guiones del 19 de octubre…")
      // solo cuenta si abajo hay guiones de verdad.
      if (!total || (!long && f.length > 20)) return;
      if (!best || prio < best.prio || (prio === best.prio && total > best.total)) best = { prio, total, i };
    });
    if (best) return { row: r, cols: { ...headerCols(cells), text: best.i } };
  }
  return null;
}

// Sin encabezado reconocible: la columna con textos largos es la del guion.
function guessHeader(rows) {
  const width = Math.max(0, ...rows.map((r) => r?.length || 0));
  let best = null;
  for (let i = 0; i < width; i++) {
    const { total, long } = columnText(rows, -1, i);
    if (long && (!best || total > best.total)) best = { i, total };
  }
  if (!best) return null;
  // La fila de arriba del primer guion se toma como encabezado (si existe).
  const row = rows.findIndex((r) => len(r?.[best.i]) >= LONG) - 1;
  return { row, cols: { ...headerCols(rows[row]), text: best.i } };
}

function excelDate(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n) && n > 20000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const m = String(v).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).slice(0, 10);
  // "Lunes 19 de octubre" / "19 de octubre de 2026"
  const w = fold(v).match(/(\d{1,2}) de (\p{L}+)(?: (?:de|del) (\d{4}))?/u);
  const mi = w ? MONTH_NAMES.findIndex((x) => w[2].startsWith(x)) : -1;
  if (mi >= 0) return `${w[3] || new Date().getFullYear()}-${String(mi + 1).padStart(2, '0')}-${w[1].padStart(2, '0')}`;
  return '';
}

const MONTH_NAMES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function excelTime(v) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (Number.isFinite(n) && n < 1) {
    const mins = Math.round(n * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = String(v).match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : String(v);
}

// "COURIER · Calendario" -> "Courier"
function lineName(sheetName) {
  const base = sheetName.split(/[·|\-–—]/)[0].trim() || sheetName.trim();
  return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
}

function firstWords(text) {
  const line = text.replace(/^\s*\d+[.)-]\s*/, '').split('\n')[0].trim();
  return line.length > 48 ? line.slice(0, 48).replace(/\s+\S*$/, '') + '…' : line || 'Guion';
}

const DONE = /publicad|hecho|grabad|listo|terminad|subid/i;

// Arma los guiones de todas las hojas que tengan una columna "Guion".
// Si hay hojas de "Calendario", se usan solo esas (las demás suelen ser resúmenes).
export function scriptsFromWorkbook(sheets) {
  let found = sheets.map((s) => ({ ...s, header: findHeader(s.rows) })).filter((s) => s.header);
  if (!found.length) {
    // Ninguna hoja tiene un encabezado "Guion": se busca la columna con textos largos.
    found = sheets.map((s) => ({ ...s, header: guessHeader(s.rows) })).filter((s) => s.header);
    const named = found.filter((s) => /gui[oó]n|script/i.test(s.name));
    if (named.length) found = named;
  }
  const calendars = found.filter((s) => /calendario/i.test(s.name));
  if (calendars.length) found = calendars;

  const out = [];
  for (const s of found) {
    const { row, cols } = s.header;
    const line = lineName(s.name);
    const get = (r, key) => (cols[key] == null ? '' : String(r[cols[key]] ?? '').trim());
    for (const r of s.rows.slice(row + 1)) {
      if (!r) continue;
      const text = get(r, 'text').replace(/\r\n?/g, '\n');
      if (!text) continue;
      const details = [
        ['Gancho en pantalla', get(r, 'hook')],
        ['Formato', get(r, 'format')],
        ['Plano', get(r, 'plano')],
        ['Duración', get(r, 'duration') && `${Math.round(Number(get(r, 'duration')) || 0) || get(r, 'duration')} s`],
        ['Palabra clave', get(r, 'keyword')],
        ['Notas', get(r, 'notes')],
      ].filter(([, v]) => v && v !== '—');
      out.push({
        sheet: s.name,
        line,
        code: get(r, 'code'),
        date: excelDate(r[cols.date]),
        time: excelTime(r[cols.time]),
        title: get(r, 'topic') || get(r, 'hook') || get(r, 'code') || firstWords(text),
        text,
        done: DONE.test(get(r, 'status')),
        details,
      });
    }
  }
  return out;
}
