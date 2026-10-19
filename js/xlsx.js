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
  let n = 0;
  for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

// Devuelve [{ name, rows: string[][] }] con todas las hojas del libro.
export async function readWorkbook(file) {
  const read = await unzip(await file.arrayBuffer());
  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml ? [...xml(sharedXml).getElementsByTagName('si')].map(textOf) : [];
  const rels = {};
  for (const r of xml(await read('xl/_rels/workbook.xml.rels')).getElementsByTagName('Relationship')) {
    const target = r.getAttribute('Target').replace(/^\//, '');
    rels[r.getAttribute('Id')] = target.startsWith('xl/') ? target : 'xl/' + target;
  }
  const sheets = [];
  for (const s of xml(await read('xl/workbook.xml')).getElementsByTagName('sheet')) {
    const path = rels[s.getAttribute('r:id')];
    const sheetXml = path && (await read(path));
    if (!sheetXml) continue;
    const rows = [];
    for (const row of xml(sheetXml).getElementsByTagName('row')) {
      const cells = [];
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent;
        let val = '';
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(c);
        else if (v != null) val = v;
        cells[colIndex(c.getAttribute('r'))] = val;
      }
      rows[Number(row.getAttribute('r')) - 1] = cells;
    }
    sheets.push({ name: s.getAttribute('name'), rows });
  }
  return sheets;
}

// ---------- De hojas a guiones ----------
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

const COLUMNS = {
  text: /^guion( \(|$)/,
  code: /^codigo$/,
  date: /^fecha$/,
  time: /^(horario|hora)$/,
  topic: /^(tema|titulo)$/,
  hook: /^gancho/,
  status: /^estado$/,
  format: /^formato$/,
  plano: /^plano$/,
  duration: /^duracion/,
  keyword: /^palabra clave$/,
  notes: /^notas/,
};

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const cols = {};
    (rows[r] || []).forEach((cell, i) => {
      const f = fold(cell);
      if (!f || f.length > 50) return;
      for (const [key, re] of Object.entries(COLUMNS)) if (cols[key] == null && re.test(f)) cols[key] = i;
    });
    if (cols.text != null) return { row: r, cols };
  }
  return null;
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
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : '';
}

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

const DONE = /publicad|hecho|grabad|listo|terminad|subid/i;

// Arma los guiones de todas las hojas que tengan una columna "Guion".
// Si hay hojas de "Calendario", se usan solo esas (las demás suelen ser resúmenes).
export function scriptsFromWorkbook(sheets) {
  let found = sheets.map((s) => ({ ...s, header: findHeader(s.rows) })).filter((s) => s.header);
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
        line,
        code: get(r, 'code'),
        date: excelDate(r[cols.date]),
        time: excelTime(r[cols.time]),
        title: get(r, 'topic') || get(r, 'hook') || get(r, 'code') || 'Guion',
        text,
        done: DONE.test(get(r, 'status')),
        details,
      });
    }
  }
  return out;
}
